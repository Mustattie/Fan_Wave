/**
 * tests/load/requirements.json is what scripts/load/preflight.mjs checks a
 * staging project for before a run. This test keeps it honest: every REST
 * table/view and every RPC a k6 script references must be listed, so a
 * script edit that starts hitting a new endpoint fails here instead of
 * failing on staging mid-run.
 */
import fs from 'fs';
import path from 'path';

const LOAD_DIR = path.join(__dirname, '..', 'tests', 'load');
const requirements = JSON.parse(fs.readFileSync(path.join(LOAD_DIR, 'requirements.json'), 'utf8'));
const scripts = fs.readdirSync(LOAD_DIR).filter((f) => f.endsWith('.js'));

function referenced(source: string) {
  const tables = new Set<string>();
  const rpcs = new Set<string>();
  for (const m of source.matchAll(/\$\{REST_URL\}\/([a-z_]+)/g)) {
    if (m[1] === 'rpc') continue;
    tables.add(m[1]);
  }
  for (const m of source.matchAll(/\$\{REST_URL\}\/rpc\/([a-z_]+)/g)) rpcs.add(m[1]);
  for (const m of source.matchAll(/rpc\(\s*REST_URL,\s*'([a-z_]+)'/g)) rpcs.add(m[1]);
  // embedded resources: teams!home_team_id(*), sports!sport_id(*)
  for (const m of source.matchAll(/:([a-z_]+)!/g)) tables.add(m[1]);
  return { tables, rpcs };
}

describe('load-test requirements manifest', () => {
  it('lists every scenario script', () => {
    expect(Object.keys(requirements.scripts).sort()).toEqual(scripts.sort());
  });

  it.each(scripts)('%s references only relations and RPCs the manifest lists', (file) => {
    const src = fs.readFileSync(path.join(LOAD_DIR, file), 'utf8');
    const { tables, rpcs } = referenced(src);
    const known = new Set([...Object.keys(requirements.tables), ...Object.keys(requirements.views)]);
    for (const t of tables) expect(known).toContain(t);
    for (const r of rpcs) expect(requirements.rpcs).toContain(r);
    const entry = requirements.scripts[file];
    const declared = new Set([...(entry.tables || []), ...(entry.views || [])]);
    for (const t of tables) expect(declared).toContain(t);
    for (const r of rpcs) expect(entry.rpcs || []).toContain(r);
  });

  it('pins the columns the queries filter or order on', () => {
    expect(requirements.tables.watch_parties).toEqual(expect.arrayContaining(['venue_metro', 'venue_city', 'starts_at']));
    expect(requirements.tables.games).toEqual(expect.arrayContaining(['scheduled_at', 'status']));
    expect(requirements.realtime_tables).toEqual(['games', 'messages']);
  });
});
