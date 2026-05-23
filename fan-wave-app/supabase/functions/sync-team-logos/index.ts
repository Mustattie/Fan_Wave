import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// sync-team-logos
//
// One-shot / low-frequency cron that backfills public.teams.logo_url from
// ESPN's per-league teams endpoint. Team rosters change rarely, logos
// rarer still, so this is meant to be invoked manually after a seed or
// scheduled at a low cadence (weekly is plenty).
//
// Auth + adapter base URL mirror sync-game-schedules so secret management
// stays unified (CRON_SHARED_SECRET).
// ---------------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SPORT_LEAGUE_MAP: Record<string, { sport: string; league: string }> = {
  nfl: { sport: "football", league: "nfl" },
  nba: { sport: "basketball", league: "nba" },
  mlb: { sport: "baseball", league: "mlb" },
  mls: { sport: "soccer", league: "usa.1" },
  nhl: { sport: "hockey", league: "nhl" },
};

const ALL_SPORTS = Object.keys(SPORT_LEAGUE_MAP);

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

interface ParsedTeamLogo {
  name: string;
  abbreviation: string | null;
  logoUrl: string | null;
}

function pickLogo(logos: any[] | undefined): string | null {
  if (!Array.isArray(logos) || logos.length === 0) return null;
  // ESPN tags one logo with rel ["full", "default"] — prefer that.
  const def = logos.find((l: any) =>
    Array.isArray(l?.rel) && l.rel.includes("default")
  );
  const chosen = def ?? logos[0];
  return typeof chosen?.href === "string" ? chosen.href : null;
}

async function fetchTeamLogos(sport: string): Promise<ParsedTeamLogo[]> {
  const mapping = SPORT_LEAGUE_MAP[sport];
  if (!mapping) return [];

  const url = `${ESPN_BASE}/${mapping.sport}/${mapping.league}/teams`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`ESPN teams fetch failed for ${sport}: ${res.status}`);
    return [];
  }
  const data = await res.json();
  // Response shape: sports[0].leagues[0].teams[].team
  const rawTeams = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const results: ParsedTeamLogo[] = [];
  for (const entry of rawTeams) {
    const t = entry?.team;
    if (!t) continue;
    const name = typeof t.displayName === "string" ? t.displayName : null;
    if (!name) continue;
    results.push({
      name,
      abbreviation: typeof t.abbreviation === "string" ? t.abbreviation : null,
      logoUrl: pickLogo(t.logos),
    });
  }
  return results;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const cronSecret = Deno.env.get("CRON_SHARED_SECRET");
    const authHeader = req.headers.get("authorization");
    if (!cronSecret || !authHeader || authHeader !== `Bearer ${cronSecret}`) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const sportParam = url.searchParams.get("sport");
    if (sportParam && !SPORT_LEAGUE_MAP[sportParam]) {
      return new Response(
        JSON.stringify({
          error:
            `Invalid sport: ${sportParam}. Valid: ${ALL_SPORTS.join(", ")}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const sports = sportParam ? [sportParam] : ALL_SPORTS;

    const breakdown: Record<
      string,
      { matched: number; updated: number; unmatched: string[] }
    > = {};
    let totalUpdated = 0;

    for (const sport of sports) {
      const teams = await fetchTeamLogos(sport);
      let matched = 0;
      let updated = 0;
      const unmatched: string[] = [];

      // Resolve league_id once per sport so the code-fallback lookup can
      // disambiguate teams whose 3-letter code might collide across leagues
      // (e.g. STL exists in MLB, NFL, NHL, MLS).
      const { data: leagueRow } = await supabase
        .from("leagues")
        .select("id")
        .ilike("name", sport)
        .maybeSingle();
      const leagueId: string | null = leagueRow?.id ?? null;

      for (const t of teams) {
        if (!t.logoUrl) continue;

        // Primary: match by ESPN's displayName against teams.name.
        // Works for ~95% of seeded teams (verbatim match).
        let { data: existing } = await supabase
          .from("teams")
          .select("id, logo_url")
          .eq("name", t.name)
          .maybeSingle();

        // Fallback: ESPN's abbreviation against teams.code, scoped to the
        // current league. Catches rename/suffix drift (LA Clippers vs
        // Los Angeles Clippers, Athletics vs Oakland Athletics, MLS "FC"
        // / "SC" variants) without an explicit alias table.
        if (!existing && t.abbreviation && leagueId) {
          const fallback = await supabase
            .from("teams")
            .select("id, logo_url")
            .eq("code", t.abbreviation)
            .eq("league_id", leagueId)
            .maybeSingle();
          existing = fallback.data ?? null;
        }

        if (!existing) {
          unmatched.push(`${t.name} (${t.abbreviation ?? "?"})`);
          continue;
        }
        matched++;
        if (existing.logo_url === t.logoUrl) continue;

        const { error: updErr } = await supabase
          .from("teams")
          .update({ logo_url: t.logoUrl })
          .eq("id", existing.id);

        if (updErr) continue;
        updated++;
      }

      breakdown[sport] = { matched, updated, unmatched };
      totalUpdated += updated;
    }

    return new Response(
      JSON.stringify({ success: true, totalUpdated, breakdown }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("sync-team-logos error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
