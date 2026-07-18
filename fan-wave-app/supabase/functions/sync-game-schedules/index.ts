import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Sport / league mappings used by the ESPN adapter.
//
// `sport` + `league` form the ESPN scoreboard path:
//   https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard
// `leagueName` is the value matched against `public.leagues.name` (ILIKE)
// when stamping `event_id` on synced game rows. Used to be the same as the
// sport key, but that broke for Soccer Cup whose league row is named
// "Soccer Cup" (post migration 048 rebrand) while the sport key is
// "worldcup" — so we now look up by leagueName explicitly.
// ---------------------------------------------------------------------------
const SPORT_LEAGUE_MAP: Record<
  string,
  { sport: string; league: string; leagueName: string }
> = {
  nfl: { sport: "football", league: "nfl", leagueName: "NFL" },
  nba: { sport: "basketball", league: "nba", leagueName: "NBA" },
  mlb: { sport: "baseball", league: "mlb", leagueName: "MLB" },
  mls: { sport: "soccer", league: "usa.1", leagueName: "MLS" },
  nhl: { sport: "hockey", league: "nhl", leagueName: "NHL" },
  // v9.1: College Football. FBS has ~134 programs -- too many to hand-seed
  // and volatile as programs move conferences, so team rows are auto-created
  // on first sight via the ON CONFLICT (league_id, name) upsert path below.
  // Depends on migration 069 having created the "College Football" league.
  cfb: { sport: "football", league: "college-football", leagueName: "College Football" },
  // 2026 World Cup → Soccer Cup (rebranded migration 048). ESPN exposes
  // it under `soccer/fifa.world`. The leagueName aligns with what
  // migration 006/048 seeded so the events join still resolves.
  worldcup: { sport: "soccer", league: "fifa.world", leagueName: "Soccer Cup" },
};

const ALL_SPORTS = Object.keys(SPORT_LEAGUE_MAP);

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------
interface ParsedTeam {
  name: string;
  code: string | null;
  city: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  alternateColor: string | null;
}

interface ParsedGame {
  espnId: string;
  homeTeam: ParsedTeam;
  awayTeam: ParsedTeam;
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
  scheduledAt: string;
  status: string;
  league: string;
  // Live-game extras for in-progress / final games. period is the
  // current quarter/period/inning (1-indexed). displayClock is ESPN's
  // formatted clock string ("8:42" for sports with a clock; "0:00" for
  // MLB which has no clock). detail is the human-readable status
  // ("Top 2nd", "Bottom 5th", "End of 3rd Inning") — meaningful for MLB
  // where displayClock is useless. linescores hold per-period running
  // scores so the UI can show a breakdown.
  period: number | null;
  displayClock: string | null;
  detail: string | null;
  homeLinescore: number[] | null;
  awayLinescore: number[] | null;
  isHalftime: boolean;
}

interface SportsDataProvider {
  getUpcomingGames(sport: string, days: number): Promise<ParsedGame[]>;
  getLiveScores(sport: string): Promise<ParsedGame[]>;
}

// ---------------------------------------------------------------------------
// ESPN Adapter
// ---------------------------------------------------------------------------
class ESPNAdapter implements SportsDataProvider {
  private baseUrl = "https://site.api.espn.com/apis/site/v2/sports";

  private parseEvents(events: any[], sport: string): ParsedGame[] {
    const results: ParsedGame[] = [];

    for (const event of events) {
      try {
        const comp = event.competitions?.[0];
        if (!comp) continue;

        const teams = comp.competitors ?? [];
        const homeTeamData = teams.find((t: any) => t.homeAway === "home");
        const awayTeamData = teams.find((t: any) => t.homeAway === "away");

        if (!homeTeamData || !awayTeamData) continue;

        // ESPN reports status via BOTH `type.name` (like STATUS_IN_PROGRESS,
        // STATUS_HALFTIME, STATUS_END_PERIOD, STATUS_OVERTIME, STATUS_FINAL)
        // AND `type.state`, a normalized bucket: 'pre' | 'in' | 'post'.
        // Earlier code string-matched on `name` and only recognized
        // IN_PROGRESS + HALFTIME + FINAL + FULL_TIME — every other in-play
        // state (OT, end-of-period, penalty shootout, etc.) fell through
        // to "scheduled". The Brazil vs Japan v8.9 UAT card showed "2-1"
        // with no LIVE badge because ESPN was reporting STATUS_END_PERIOD
        // between full time and OT: our sync wrote the score correctly but
        // left status='scheduled', so the WCSchedule card rendered as
        // upcoming. Trusting `state` catches every intermediate case.
        const statusType = comp.status?.type?.name ?? "scheduled";
        const statusState = comp.status?.type?.state ?? "pre";
        const isHalftime = statusType === "STATUS_HALFTIME";
        let normalizedStatus = "scheduled";
        if (statusState === "in" || isHalftime) {
          normalizedStatus = "in";
        } else if (statusState === "post") {
          normalizedStatus = "post";
        }

        // ESPN exposes current period + clock + per-period linescores.
        // Capture for the UI to render quarter / half-time / final
        // breakdowns. linescores is an array of { value: number } per
        // period in order; flatten to plain numbers.
        const periodRaw = Number(comp.status?.period);
        const period = Number.isFinite(periodRaw) && periodRaw > 0 ? periodRaw : null;
        const displayClock = typeof comp.status?.displayClock === "string"
          ? comp.status.displayClock
          : null;
        // status.type.detail is "Top 2nd" / "Bottom 5th" for MLB,
        // "End of 1st Quarter" for NFL, etc. — the most user-friendly
        // single-string description of the current state. Capture it so
        // the UI can show meaningful labels for sports without a clock.
        const detail = typeof comp.status?.type?.detail === "string"
          ? comp.status.type.detail
          : typeof comp.status?.type?.shortDetail === "string"
            ? comp.status.type.shortDetail
            : null;
        const flattenLinescores = (t: any): number[] | null => {
          const arr = t?.linescores;
          if (!Array.isArray(arr) || arr.length === 0) return null;
          return arr
            .map((ls: any) => {
              const v = Number(ls?.value);
              return Number.isFinite(v) ? v : 0;
            });
        };

        // ESPN team payload: { id, displayName, abbreviation, location,
        // logo (string) | logos[{href}], color (hex, no #), alternateColor }.
        // Some sports (CFB) return `logos` array; others (NFL) return a
        // single `logo` string. Prefer the darker-background variant when
        // logos[] carries multiple entries -- our app renders on a dark
        // surface via TeamBadge.
        const teamOf = (t: any): ParsedTeam => {
          const team = t?.team ?? {};
          const logoStr = typeof team.logo === "string" ? team.logo : null;
          const logoFromArr = Array.isArray(team.logos)
            ? (team.logos.find((l: any) => Array.isArray(l?.rel) && l.rel.includes("dark"))?.href
                ?? team.logos[0]?.href
                ?? null)
            : null;
          return {
            name: team.displayName ?? "Unknown",
            code: team.abbreviation ?? null,
            city: team.location ?? null,
            logoUrl: logoStr ?? logoFromArr,
            primaryColor: team.color ? `#${String(team.color).replace(/^#/, "")}` : null,
            alternateColor: team.alternateColor ? `#${String(team.alternateColor).replace(/^#/, "")}` : null,
          };
        };

        results.push({
          espnId: event.id,
          homeTeam: teamOf(homeTeamData),
          awayTeam: teamOf(awayTeamData),
          homeScore:
            normalizedStatus !== "scheduled"
              ? Number(homeTeamData.score ?? 0)
              : null,
          awayScore:
            normalizedStatus !== "scheduled"
              ? Number(awayTeamData.score ?? 0)
              : null,
          venue: comp.venue?.fullName ?? null,
          scheduledAt: event.date ?? new Date().toISOString(),
          status: normalizedStatus,
          league: sport,
          period,
          displayClock,
          detail,
          homeLinescore: flattenLinescores(homeTeamData),
          awayLinescore: flattenLinescores(awayTeamData),
          isHalftime,
        });
      } catch {
        continue;
      }
    }

    return results;
  }

  async getUpcomingGames(sport: string, days: number): Promise<ParsedGame[]> {
    const mapping = SPORT_LEAGUE_MAP[sport];
    if (!mapping) return [];

    // Walk the window day-by-day. ESPN's scoreboard endpoint accepts a
    // multi-day `dates=YYYYMMDD-YYYYMMDD` range but caps the number of
    // events it returns per call (observed ~25 for soccer/fifa.world on
    // 2026-06-25 — only 3 of June 25's 4 group-stage matches landed in
    // the DB, and June 24 was empty entirely). Single-day requests are
    // not capped, so iterating per day guarantees we collect every
    // fixture. Dedupe by espnId at the end so a game that ESPN echoes
    // across two calendar days (rare time-zone edge cases) only lands
    // once in the upsert pass downstream.
    //
    // Back-window is `-1` day for the usual finished-yesterday catch-up.
    // Caller controls forward window via `days`; clamp upstream.
    const now = new Date();
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 1);
    const end = new Date(now);
    end.setUTCDate(end.getUTCDate() + days);

    const byEspnId = new Map<string, ParsedGame>();
    const cursor = new Date(start);
    while (cursor <= end) {
      const yyyymmdd = cursor.toISOString().slice(0, 10).replace(/-/g, "");
      const url = `${this.baseUrl}/${mapping.sport}/${mapping.league}/scoreboard?dates=${yyyymmdd}`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.warn(`ESPN fetch failed for ${sport} @ ${yyyymmdd}: ${res.status}`);
        } else {
          const data = await res.json();
          for (const game of this.parseEvents(data.events ?? [], sport)) {
            byEspnId.set(game.espnId, game);
          }
        }
      } catch (e) {
        console.warn(`ESPN fetch threw for ${sport} @ ${yyyymmdd}:`, e);
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return Array.from(byEspnId.values());
  }

  async getLiveScores(sport: string): Promise<ParsedGame[]> {
    const mapping = SPORT_LEAGUE_MAP[sport];
    if (!mapping) return [];

    const url = `${this.baseUrl}/${mapping.sport}/${mapping.league}/scoreboard`;

    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`ESPN live fetch failed for ${sport}: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const events = data.events ?? [];
    const allGames = this.parseEvents(events, sport);

    return allGames.filter((g) => g.status === "in");
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ---- Authentication: accept either CRON_SHARED_SECRET (the explicit
    // shared bearer that survives JWT rotations) OR the auto-injected
    // SUPABASE_SERVICE_ROLE_KEY (the bearer pg_cron actually sends via
    // vault in migration 058). The prod operational state on 2026-06-17:
    // CRON_SHARED_SECRET was either never set or fell out of sync with
    // the vault, and every cron call had been 401'ing for ~8 days post-
    // prod-cutover. Accepting both bearers stops the bleed regardless of
    // which side the operator chooses to keep aligned. Whichever pair
    // matches first wins; both empty is still 401.
    const cronSecret = Deno.env.get("CRON_SHARED_SECRET") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authHeader = req.headers.get("authorization") ?? "";
    const ok =
      (cronSecret.length > 0 && authHeader === `Bearer ${cronSecret}`) ||
      (serviceKey.length > 0 && authHeader === `Bearer ${serviceKey}`);
    if (!ok) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ---- Supabase client uses the auto-injected service-role key for DB
    // writes (bypasses RLS) — orthogonal to the auth check above. ----
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ---- Query params with validation ----
    const url = new URL(req.url);
    const sportParam = url.searchParams.get("sport");
    const daysParam = Math.min(Math.max(Number(url.searchParams.get("days") ?? "7"), 1), 30);

    if (sportParam && !SPORT_LEAGUE_MAP[sportParam]) {
      return new Response(
        JSON.stringify({ error: `Invalid sport: ${sportParam}. Valid: ${ALL_SPORTS.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sports = sportParam ? [sportParam] : ALL_SPORTS;

    const provider: SportsDataProvider = new ESPNAdapter();
    const syncResults: Record<
      string,
      { upserted: number; unmatched_teams: string[]; errors: string[] }
    > = {};
    let totalSynced = 0;

    for (const sport of sports) {
      const games = await provider.getUpcomingGames(sport, daysParam);
      const result = { upserted: 0, unmatched_teams: [] as string[], errors: [] as string[] };
      if (games.length === 0) {
        syncResults[sport] = result;
        continue;
      }

      // Active event id for this league (still set on the row for joins/
      // analytics; no longer used for row matching — espn_id is the key).
      // Lookup uses leagueName (not the sport key) so the Soccer Cup row
      // (name="Soccer Cup", key="worldcup") resolves correctly.
      let eventId: string | null = null;
      const leagueLookupName = SPORT_LEAGUE_MAP[sport]?.leagueName ?? sport;
      const { data: leagueRow } = await supabase
        .from("leagues")
        .select("id")
        .ilike("name", leagueLookupName)
        .maybeSingle();
      if (leagueRow?.id) {
        const { data: activeEvent } = await supabase
          .from("events")
          .select("id")
          .eq("league_id", leagueRow.id)
          .eq("is_active", true)
          .order("start_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        eventId = activeEvent?.id ?? null;
      }

      // Gather unique teams from the game payload. We dedupe on name so a
      // team appearing in multiple games only gets one upsert attempt.
      const teamsByName = new Map<string, ParsedTeam>();
      for (const g of games) {
        if (!teamsByName.has(g.homeTeam.name)) teamsByName.set(g.homeTeam.name, g.homeTeam);
        if (!teamsByName.has(g.awayTeam.name)) teamsByName.set(g.awayTeam.name, g.awayTeam);
      }
      const teamNames = [...teamsByName.keys()];

      // Prefer a league-scoped lookup so same-named teams across leagues
      // (rare but possible for CFB program names -- "Miami" the FL program
      // vs "Miami" as a city label) can't cross-pollinate. Fall back to
      // global name lookup for backward compat with legacy sports whose
      // league_id may not resolve (WC seed rows etc.).
      const teamMap = new Map<string, string>();
      if (leagueRow?.id) {
        const { data: scopedRows } = await supabase
          .from("teams")
          .select("id, name")
          .eq("league_id", leagueRow.id)
          .in("name", teamNames);
        for (const row of scopedRows ?? []) {
          teamMap.set(row.name, row.id);
        }
      }
      if (teamMap.size < teamNames.length) {
        const remaining = teamNames.filter((n) => !teamMap.has(n));
        const { data: globalRows } = await supabase
          .from("teams")
          .select("id, name")
          .in("name", remaining);
        for (const row of globalRows ?? []) {
          teamMap.set(row.name, row.id);
        }
      }

      // Auto-upsert any team still unmatched, but only when we resolved a
      // league_id -- without it we don't know where to place the row. This
      // is the CFB (and future new-sport) on-ramp: the first sync sees the
      // team, creates it with ESPN's badge + colors, subsequent syncs hit
      // the cache.
      if (leagueRow?.id) {
        const missing: ParsedTeam[] = [];
        for (const [name, parsed] of teamsByName) {
          if (!teamMap.has(name)) missing.push(parsed);
        }
        if (missing.length > 0) {
          const rows = missing.map((t) => ({
            league_id: leagueRow.id,
            name: t.name,
            code: t.code,
            city: t.city,
            logo_url: t.logoUrl,
            colors: {
              primary: t.primaryColor,
              secondary: t.alternateColor,
            },
          }));
          const { data: upserted, error: upsertErr } = await supabase
            .from("teams")
            .upsert(rows, { onConflict: "league_id,name" })
            .select("id, name");
          if (upsertErr) {
            result.errors.push(`team upsert: ${upsertErr.message}`);
          } else {
            for (const row of upserted ?? []) {
              teamMap.set(row.name, row.id);
            }
          }
        }
      }

      // Batch-fetch existing metadata for all the games we're about to
      // upsert so we can merge ESPN keys onto any pre-existing data
      // (WC seed rows etc.) without clobbering. One query instead of N.
      const espnIds = games.map((g) => g.espnId);
      const { data: existingRows } = await supabase
        .from("games")
        .select("espn_id, metadata")
        .in("espn_id", espnIds);

      const existingMeta = new Map<string, Record<string, unknown>>();
      for (const row of existingRows ?? []) {
        if (row.espn_id) {
          existingMeta.set(
            row.espn_id,
            (row.metadata && typeof row.metadata === "object")
              ? row.metadata as Record<string, unknown>
              : {},
          );
        }
      }

      for (const game of games) {
        const homeTeamId = teamMap.get(game.homeTeam.name) ?? null;
        const awayTeamId = teamMap.get(game.awayTeam.name) ?? null;

        if (!homeTeamId || !awayTeamId) {
          result.unmatched_teams.push(
            `${game.homeTeam.name} vs ${game.awayTeam.name} (${game.espnId})`,
          );
          continue;
        }

        const mergedMetadata = {
          ...(existingMeta.get(game.espnId) ?? {}),
          espn_id: game.espnId,
          period: game.period,
          display_clock: game.displayClock,
          detail: game.detail,
          home_linescore: game.homeLinescore,
          away_linescore: game.awayLinescore,
          is_halftime: game.isHalftime,
        };

        // v9.0.1: WC games are soccer games. Fold the ESPN "worldcup"
        // sport key into the app's canonical 'soccer' bucket so Game Day
        // / Home render them under ⚽ Soccer with a "Soccer Cup" league
        // label carrying the tournament identity. Other sport keys stay
        // untouched — they already match constants/Sports.ts ids
        // (nfl/nba/mlb/mls/nhl). Existing sport_id='worldcup' rows are
        // backfilled to 'soccer' via a one-shot UPDATE.
        const sportIdForRow = sport === "worldcup" ? "soccer" : sport;

        const gameRow: Record<string, unknown> = {
          espn_id: game.espnId,
          home_team_id: homeTeamId,
          away_team_id: awayTeamId,
          home_score: game.homeScore,
          away_score: game.awayScore,
          venue_name: game.venue,
          scheduled_at: game.scheduledAt,
          status: game.status,
          sport_id: sportIdForRow,
          metadata: mergedMetadata,
          ...(eventId ? { event_id: eventId } : {}),
        };

        // Single atomic upsert keyed on espn_id (UNIQUE constraint from
        // migration 044). Replaces the old SELECT-then-INSERT/UPDATE which
        // could silently fail and create duplicates when the multi-column
        // match query missed.
        const { error } = await supabase
          .from("games")
          .upsert(gameRow, { onConflict: "espn_id" });

        if (error) {
          result.errors.push(`${game.espnId}: ${error.message}`);
          continue;
        }
        result.upserted++;
      }

      syncResults[sport] = result;
      totalSynced += result.upserted;
    }

    return new Response(
      JSON.stringify({
        success: true,
        totalSynced,
        breakdown: syncResults,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
