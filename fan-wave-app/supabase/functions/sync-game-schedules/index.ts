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
// Sport / league mappings used by the ESPN adapter
// ---------------------------------------------------------------------------
const SPORT_LEAGUE_MAP: Record<string, { sport: string; league: string }> = {
  nfl: { sport: "football", league: "nfl" },
  nba: { sport: "basketball", league: "nba" },
  mlb: { sport: "baseball", league: "mlb" },
  mls: { sport: "soccer", league: "usa.1" },
  nhl: { sport: "hockey", league: "nhl" },
};

const ALL_SPORTS = Object.keys(SPORT_LEAGUE_MAP);

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------
interface ParsedGame {
  espnId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
  scheduledAt: string;
  status: string;
  league: string;
  // Live-game extras for in-progress / final games. period is the
  // current quarter/period/inning (1-indexed). displayClock is ESPN's
  // formatted clock string ("8:42", "Top 3rd", "HT"). linescores hold
  // the per-period running scores so the UI can show a breakdown.
  period: number | null;
  displayClock: string | null;
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

        const statusType = comp.status?.type?.name ?? "scheduled";
        const isHalftime = statusType === "STATUS_HALFTIME";
        let normalizedStatus = "scheduled";
        if (statusType === "STATUS_IN_PROGRESS" || isHalftime) {
          normalizedStatus = "in";
        } else if (
          statusType === "STATUS_FINAL" ||
          statusType === "STATUS_FULL_TIME"
        ) {
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
        const flattenLinescores = (t: any): number[] | null => {
          const arr = t?.linescores;
          if (!Array.isArray(arr) || arr.length === 0) return null;
          return arr
            .map((ls: any) => {
              const v = Number(ls?.value);
              return Number.isFinite(v) ? v : 0;
            });
        };

        results.push({
          espnId: event.id,
          homeTeam: homeTeamData.team?.displayName ?? "Unknown",
          awayTeam: awayTeamData.team?.displayName ?? "Unknown",
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

    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + days);

    const dateRange = `${now.toISOString().slice(0, 10).replace(/-/g, "")}-${end.toISOString().slice(0, 10).replace(/-/g, "")}`;

    const url = `${this.baseUrl}/${mapping.sport}/${mapping.league}/scoreboard?dates=${dateRange}`;

    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`ESPN fetch failed for ${sport}: ${res.status}`);
      return [];
    }

    const data = await res.json();
    return this.parseEvents(data.events ?? [], sport);
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
    // ---- Authentication: require a shared secret distinct from the
    // service-role JWT. We had to decouple because the project's
    // SUPABASE_SERVICE_ROLE_KEY env (auto-injected, immutable per-deploy)
    // diverged from the Dashboard's currently-displayed service-role key
    // (looks like a JWT rotation happened) — cron callers couldn't match
    // it. Using a custom CRON_SHARED_SECRET we set via `supabase secrets
    // set` lets us guarantee both sides hold the same value. ----
    const cronSecret = Deno.env.get("CRON_SHARED_SECRET");
    const authHeader = req.headers.get("authorization");
    if (!cronSecret || !authHeader || authHeader !== `Bearer ${cronSecret}`) {
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
    const syncResults: Record<string, number> = {};
    let totalSynced = 0;

    for (const sport of sports) {
      const games = await provider.getUpcomingGames(sport, daysParam);
      if (games.length === 0) {
        syncResults[sport] = 0;
        continue;
      }

      // events.league_id → leagues.id (events has no `league` text column),
      // and events has no created_at — order by start_date instead.
      let eventId: string | null = null;
      const { data: leagueRow } = await supabase
        .from("leagues")
        .select("id")
        .ilike("name", sport)
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

      const teamNames = new Set<string>();
      for (const g of games) {
        teamNames.add(g.homeTeam);
        teamNames.add(g.awayTeam);
      }

      const { data: teamRows } = await supabase
        .from("teams")
        .select("id, name")
        .in("name", [...teamNames]);

      const teamMap = new Map<string, string>();
      for (const row of teamRows ?? []) {
        teamMap.set(row.name, row.id);
      }

      let sportCount = 0;

      for (const game of games) {
        const homeTeamId = teamMap.get(game.homeTeam) ?? null;
        const awayTeamId = teamMap.get(game.awayTeam) ?? null;

        if (!homeTeamId || !awayTeamId) {
          continue;
        }

        const scheduledDate = game.scheduledAt.slice(0, 10);

        let query = supabase
          .from("games")
          .select("id, metadata")
          .eq("home_team_id", homeTeamId)
          .eq("away_team_id", awayTeamId)
          .gte("scheduled_at", `${scheduledDate}T00:00:00Z`)
          .lte("scheduled_at", `${scheduledDate}T23:59:59Z`);

        if (eventId) {
          query = query.eq("event_id", eventId);
        }

        const { data: existing } = await query.maybeSingle();

        // Merge ESPN live-game fields into metadata WITHOUT clobbering
        // pre-existing WC seed data (group, match_number, home/away
        // placeholders from migration 006). On insert, existing.metadata
        // is null → defaults to {}.
        const mergedMetadata = {
          ...(existing?.metadata && typeof existing.metadata === "object"
            ? existing.metadata
            : {}),
          espn_id: game.espnId,
          period: game.period,
          display_clock: game.displayClock,
          home_linescore: game.homeLinescore,
          away_linescore: game.awayLinescore,
          is_halftime: game.isHalftime,
        };

        // games schema: venue_name (not venue); no espn_id / league columns
        // exist — drop them. dedup uses home/away/date so espn_id isn't
        // needed for matching.
        const gameRow: Record<string, unknown> = {
          home_team_id: homeTeamId,
          away_team_id: awayTeamId,
          home_score: game.homeScore,
          away_score: game.awayScore,
          venue_name: game.venue,
          scheduled_at: game.scheduledAt,
          status: game.status,
          metadata: mergedMetadata,
          ...(eventId ? { event_id: eventId } : {}),
        };

        if (existing?.id) {
          const { error } = await supabase
            .from("games")
            .update(gameRow)
            .eq("id", existing.id);

          if (error) continue;
        } else {
          const { error } = await supabase.from("games").insert(gameRow);

          if (error) continue;
        }

        sportCount++;
      }

      syncResults[sport] = sportCount;
      totalSynced += sportCount;
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
