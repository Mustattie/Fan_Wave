#!/usr/bin/env node
/**
 * scripts/test-migration-108.mjs — proves migration 108 on a scratch Postgres.
 *
 * Nothing here touches Supabase. It boots a throw-away cluster with initdb
 * and runs, in order:
 *   1. supabase/tests/108/fixture_schema.sql  (roles, auth.uid(), chat_rooms
 *      + chat_room_members with prod's RLS policies, 008's SECURITY INVOKER
 *      recount trigger functions, one room owned by OWNER with OWNER as member)
 *   2. REPRODUCE: a non-owner joins as `authenticated` -> member_count stays
 *      1 while the rows say 2 (the prod defect; the step FAILS if the bug is
 *      NOT reproduced, so the fixture is proven to model prod)
 *   3. the REAL 108 (one transaction) -> the drifted room is reconciled
 *   4. BEHAVIOUR after 108: non-owner join -> counted; that user leaves ->
 *      counted; the owner-only update policy is untouched
 *   5. RACES after 108 (two psql sessions, each in its own transaction, the
 *      first holding its row lock for 3 s): join/join and join/leave must
 *      both end with member_count == row count. 008's recount would have
 *      written n+1 for join/join; the atomic delta cannot.
 *   6. 108 again -> idempotent (0 rooms reconciled, counts unchanged)
 *   7. the executable REVERSAL-BEGIN/END block from 108's footer -> a further
 *      non-owner join is NOT counted (proves the reversal is real), then 108
 *      once more on top of the reversed state -> reconciled
 * and tears the cluster down.
 *
 * Needs initdb / pg_ctl / psql on PATH or in $PG_BIN (PostgreSQL 14+).
 *   node scripts/test-migration-108.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '..');
const MIGRATION = path.join(app, 'supabase', 'migrations', '108_member_count_triggers_security_definer.sql');
const FIXTURE = path.join(app, 'supabase', 'tests', '108', 'fixture_schema.sql');

const exe = process.platform === 'win32' ? '.exe' : '';
function bin(name) {
  if (process.env.PG_BIN) {
    const p = path.join(process.env.PG_BIN, name + exe);
    if (existsSync(p)) return p;
  }
  return name;
}
const PGENV = { ...process.env, PGCLIENTENCODING: 'UTF8', PGOPTIONS: '-c client_min_messages=notice' };
function run(cmd, args, opts = {}) {
  // pg_ctl start hands its stdio to the postgres it launches; on Windows the
  // server then holds our stdout pipe open and spawnSync never returns, so
  // the start step runs with stdio ignored and the server log goes to -l.
  return spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, env: PGENV, stdio: opts.detachedIo ? 'ignore' : ['ignore', 'pipe', 'pipe'] });
}
/** One psql process, asynchronously; resolves with {status, out}. */
function psqlAsync(args) {
  return new Promise((resolve) => {
    const child = spawn(bin('psql'), args, { env: PGENV, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (status) => resolve({ status, out }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = [];
function ok(label, extra = '') { steps.push(label); console.log(`PASS  ${label}${extra ? ' — ' + extra : ''}`); }
function fail(label, output) { console.error(`FAIL  ${label}\n${output}`); throw new Error(`step failed: ${label}`); }
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}
/** The executable statements between "-- REVERSAL-BEGIN" and "-- REVERSAL-END", each "--   STATEMENT;". */
function reversalSql(sql) {
  const lines = sql.split(/\r?\n/);
  const a = lines.findIndex((l) => /^--\s*REVERSAL-BEGIN\b/.test(l));
  const b = lines.findIndex((l) => /^--\s*REVERSAL-END\b/.test(l));
  if (a < 0 || b < 0 || b <= a) fail('reversal block', 'REVERSAL-BEGIN / REVERSAL-END markers not found in order');
  const stmts = lines.slice(a + 1, b).map((l) => l.replace(/^--\s*/, '').trim()).filter((l) => l.endsWith(';'));
  if (stmts.length !== 4) fail('reversal block', `expected 4 statements, found ${stmts.length}`);
  return stmts.join('\n');
}

const USER_B = '22222222-2222-2222-2222-222222222222';
const USER_C = '33333333-3333-3333-3333-333333333333';
const USER_D = '44444444-4444-4444-4444-444444444444';
const USER_E = '55555555-5555-5555-5555-555555555555';
const USER_F = '66666666-6666-6666-6666-666666666666';
const ROOM = 'cf06ddf9-0000-0000-0000-000000000001';
const asUserBody = (uid, sql) => `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false); ${sql}`;
const asUser = (uid, sql) => `${asUserBody(uid, sql)}; RESET ROLE;`;
const join = (uid) => `INSERT INTO public.chat_room_members (chat_room_id, user_id) VALUES ('${ROOM}', '${uid}')`;
const leave = (uid) => `DELETE FROM public.chat_room_members WHERE chat_room_id = '${ROOM}' AND user_id = '${uid}'`;

async function main() {
  const port = await freePort();
  const dir = mkdtempSync(path.join(tmpdir(), 'fw108-'));
  const data = path.join(dir, 'data');
  const conn = ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres'];
  const psql = (db, args, label) => {
    const res = run(bin('psql'), [...conn, '-d', db, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args]);
    if (res.status !== 0) fail(label, (res.stderr || '') + (res.stdout || ''));
    return (res.stdout || '') + (res.stderr || '');
  };
  const sqlFile = (file, label) => psql('fw_test', ['-f', file], label || path.basename(file));
  const sqlRun = (sql, label) => psql('fw_test', ['-c', sql], label);
  const value = (sql, label) => psql('fw_test', ['-t', '-A', '-c', sql], label).trim();
  const count = (label) => Number(value(`SELECT member_count FROM public.chat_rooms WHERE id = '${ROOM}'`, label));
  const rows = (label) => Number(value(`SELECT count(*) FROM public.chat_room_members WHERE chat_room_id = '${ROOM}'`, label));
  const expect = (label, got, want) => { if (got !== want) fail(label, `expected ${want}, got ${got}`); ok(label, `${got}`); };
  const assertFunctionSecurity = (fnName, step) => {
    // owner is postgres
    const owner = value(`SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = to_regprocedure('public.${fnName}()')`, `${step}: ${fnName} owner`);
    expect(`${step}: ${fnName} owner`, owner, 'postgres');
    // prosecdef is true
    const prosecdef = value(`SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.${fnName}()')`, `${step}: ${fnName} prosecdef`);
    expect(`${step}: ${fnName} prosecdef`, prosecdef, 't');
    // proconfig has exactly 1 entry and it is exactly 'search_path=public, pg_temp'
    const configLen = value(`SELECT array_length(proconfig, 1) FROM pg_proc WHERE oid = to_regprocedure('public.${fnName}()')`, `${step}: ${fnName} proconfig length`);
    expect(`${step}: ${fnName} proconfig exactly 1 entry`, configLen, '1');
    const searchPath = value(`SELECT proconfig[1] FROM pg_proc WHERE oid = to_regprocedure('public.${fnName}()')`, `${step}: ${fnName} search_path`);
    expect(`${step}: ${fnName} search_path exact`, searchPath, 'search_path=public, pg_temp');
    // PUBLIC, anon, authenticated have no EXECUTE privilege (all should return false)
    const publicExec = value(`SELECT has_function_privilege('public', 'public.${fnName}()', 'EXECUTE')::text`, `${step}: ${fnName} PUBLIC EXECUTE`);
    expect(`${step}: ${fnName} PUBLIC no EXECUTE`, publicExec, 'false');
    const anonExec = value(`SELECT has_function_privilege('anon', 'public.${fnName}()', 'EXECUTE')::text`, `${step}: ${fnName} anon EXECUTE`);
    expect(`${step}: ${fnName} anon no EXECUTE`, anonExec, 'false');
    const authExec = value(`SELECT has_function_privilege('authenticated', 'public.${fnName}()', 'EXECUTE')::text`, `${step}: ${fnName} authenticated EXECUTE`);
    expect(`${step}: ${fnName} authenticated no EXECUTE`, authExec, 'false');
  };
  const assertTriggers = (step) => {
    // two triggers attached to public.chat_room_members, not internal
    const triggerCount = value(`SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.chat_room_members'::regclass AND NOT tgisinternal`, `${step}: trigger count`);
    expect(`${step}: exactly 2 triggers exist`, triggerCount, '2');
    // trg_chat_room_member_insert: enabled ('O'=enabled in origin/local mode), AFTER INSERT, FOR EACH ROW, calls increment_member_count
    const insertTrigger = value(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.chat_room_members'::regclass AND NOT tgisinternal AND tgname = 'trg_chat_room_member_insert'`, `${step}: insert trigger name`);
    expect(`${step}: insert trigger name`, insertTrigger, 'trg_chat_room_member_insert');
    const insertEnabled = value(`SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.chat_room_members'::regclass AND tgname = 'trg_chat_room_member_insert'`, `${step}: insert trigger enabled`);
    expect(`${step}: insert trigger enabled in origin/local mode`, insertEnabled, 'O');
    const insertType = value(`SELECT tgtype FROM pg_trigger WHERE tgrelid = 'public.chat_room_members'::regclass AND tgname = 'trg_chat_room_member_insert'`, `${step}: insert trigger type`);
    expect(`${step}: insert trigger type (row-level AFTER INSERT)`, insertType, '5');
    const insertFunc = value(`SELECT n.nspname || '.' || p.proname || '()' FROM pg_trigger t JOIN pg_proc p ON t.tgfoid = p.oid JOIN pg_namespace n ON p.pronamespace = n.oid WHERE t.tgrelid = 'public.chat_room_members'::regclass AND t.tgname = 'trg_chat_room_member_insert'`, `${step}: insert trigger function`);
    expect(`${step}: insert trigger calls increment_member_count`, insertFunc, 'public.increment_member_count()');
    // trg_chat_room_member_delete: enabled ('O'=enabled in origin/local mode), AFTER DELETE, FOR EACH ROW, calls decrement_member_count
    const deleteTrigger = value(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.chat_room_members'::regclass AND NOT tgisinternal AND tgname = 'trg_chat_room_member_delete'`, `${step}: delete trigger name`);
    expect(`${step}: delete trigger name`, deleteTrigger, 'trg_chat_room_member_delete');
    const deleteEnabled = value(`SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.chat_room_members'::regclass AND tgname = 'trg_chat_room_member_delete'`, `${step}: delete trigger enabled`);
    expect(`${step}: delete trigger enabled in origin/local mode`, deleteEnabled, 'O');
    const deleteType = value(`SELECT tgtype FROM pg_trigger WHERE tgrelid = 'public.chat_room_members'::regclass AND tgname = 'trg_chat_room_member_delete'`, `${step}: delete trigger type`);
    expect(`${step}: delete trigger type (row-level AFTER DELETE)`, deleteType, '9');
    const deleteFunc = value(`SELECT n.nspname || '.' || p.proname || '()' FROM pg_trigger t JOIN pg_proc p ON t.tgfoid = p.oid JOIN pg_namespace n ON p.pronamespace = n.oid WHERE t.tgrelid = 'public.chat_room_members'::regclass AND t.tgname = 'trg_chat_room_member_delete'`, `${step}: delete trigger function`);
    expect(`${step}: delete trigger calls decrement_member_count`, deleteFunc, 'public.decrement_member_count()');
  };
  const assertUpdatePolicy = (step) => {
    // chat_rooms_update policy exists, is UPDATE (polcmd='w'), and is owner-only
    const usingExpr = value(`SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'public.chat_rooms'::regclass AND polname = 'chat_rooms_update'`, `${step}: chat_rooms_update USING`);
    expect(`${step}: chat_rooms_update USING`, usingExpr, '(owner_id = auth.uid())');
    const withCheckExpr = value(`SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polrelid = 'public.chat_rooms'::regclass AND polname = 'chat_rooms_update'`, `${step}: chat_rooms_update WITH CHECK`);
    expect(`${step}: chat_rooms_update WITH CHECK`, withCheckExpr, '(owner_id = auth.uid())');
    const cmd = value(`SELECT polcmd FROM pg_policy WHERE polrelid = 'public.chat_rooms'::regclass AND polname = 'chat_rooms_update'`, `${step}: chat_rooms_update polcmd`);
    expect(`${step}: chat_rooms_update polcmd (UPDATE)`, cmd, 'w');
    // role set is exactly {authenticated}
    const roleList = value(`SELECT array_agg(r.rolname ORDER BY r.rolname)::text FROM pg_policy p JOIN pg_roles r ON r.oid = ANY(p.polroles) WHERE p.polrelid = 'public.chat_rooms'::regclass AND p.polname = 'chat_rooms_update'`, `${step}: chat_rooms_update roles`);
    expect(`${step}: chat_rooms_update role set exactly {authenticated}`, roleList, '{authenticated}');
  };
  // Two sessions: A writes and holds its row lock for `holdMs`; B starts after
  // `delayMs`, blocks on the room row until A commits, then commits itself.
  const race = async (label, a, b, holdMs = 3000, delayMs = 800) => {
    const base = [...conn, '-d', 'fw_test', '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-c'];
    const pA = psqlAsync([...base, `BEGIN; ${asUserBody(a.uid, a.sql)}; SELECT pg_sleep(${holdMs / 1000}); COMMIT;`]);
    await sleep(delayMs);
    const pB = psqlAsync([...base, `BEGIN; ${asUserBody(b.uid, b.sql)}; COMMIT;`]);
    const [rA, rB] = await Promise.all([pA, pB]);
    if (rA.status !== 0) fail(`${label}: session A`, rA.out);
    if (rB.status !== 0) fail(`${label}: session B`, rB.out);
    const c = count(`${label}: count`); const r = rows(`${label}: rows`);
    if (c !== r) fail(label, `member_count ${c} but ${r} membership rows — drift under concurrency`);
    ok(label, `member_count ${c} == rows ${r}`);
  };

  let started = false;
  try {
    // 1. cluster
    const logFile = path.join(dir, 'pg.log');
    const init = run(bin('initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C', '-N']);
    if (init.status !== 0) fail('initdb', init.stderr + init.stdout);
    const start = run(bin('pg_ctl'), ['-D', data, '-l', logFile, '-w', '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off`, 'start'], { detachedIo: true });
    if (start.status !== 0) fail('pg_ctl start', existsSync(logFile) ? readFileSync(logFile, 'utf8') : `pg_ctl exit ${start.status}`);
    started = true;
    psql('postgres', ['-c', 'CREATE DATABASE fw_test'], 'createdb');
    ok('cluster', `port ${port}`);

    // 2. fixture + reproduce the defect
    sqlFile(FIXTURE, 'fixture');
    sqlRun(asUser(USER_B, join(USER_B)), 'user B joins (pre-108)');
    expect('pre-108: membership rows', rows('rows'), 2);
    expect('pre-108: member_count stays stale (defect reproduced)', count('count'), 1);
    expect('pre-108: increment_member_count is SECURITY INVOKER', value(`SELECT prosecdef FROM pg_proc WHERE proname = 'increment_member_count'`, 'prosecdef pre'), 'f');

    // 3. the real 108 (the file carries its own BEGIN/COMMIT)
    const out = sqlFile(MIGRATION, '108 apply');
    const m = out.match(/reconciled member_count on (\d+) room/);
    expect('108: reconciled rooms reported', m ? Number(m[1]) : -1, 1);
    expect('108: drifted room reconciled', count('count'), 2);
    // Exact security and trigger assertions post-apply
    assertFunctionSecurity('increment_member_count', '108');
    assertFunctionSecurity('decrement_member_count', '108');
    assertTriggers('108');
    assertUpdatePolicy('108');

    // 4. behaviour after 108, as authenticated non-owners
    sqlRun(asUser(USER_C, join(USER_C)), 'user C joins');
    expect('post-108: non-owner join counted', count('count'), 3);
    sqlRun(asUser(USER_C, leave(USER_C)), 'user C leaves');
    expect('post-108: non-owner leave counted', count('count'), 2);
    expect('post-108: chat_rooms_update policy untouched', value(`SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'public.chat_rooms'::regclass AND polname = 'chat_rooms_update'`, 'policy'), '(owner_id = auth.uid())');

    // 5. races after 108
    await race('race join/join', { uid: USER_C, sql: join(USER_C) }, { uid: USER_D, sql: join(USER_D) });
    expect('race join/join: rows', rows('rows'), 4);
    await race('race join/leave', { uid: USER_E, sql: join(USER_E) }, { uid: USER_D, sql: leave(USER_D) });
    expect('race join/leave: rows', rows('rows'), 4);

    // 6. idempotent
    const again = sqlFile(MIGRATION, '108 re-apply');
    const m2 = again.match(/reconciled member_count on (\d+) room/);
    expect('108 twice: nothing to reconcile', m2 ? Number(m2[1]) : -1, 0);
    expect('108 twice: count unchanged', count('count'), 4);

    // 7. reversal, then re-apply
    const revFile = path.join(dir, 'reversal.sql'); writeFileSync(revFile, reversalSql(readFileSync(MIGRATION, 'utf8')));
    sqlFile(revFile, 'reversal');
    expect('reversal: back to SECURITY INVOKER', value(`SELECT prosecdef FROM pg_proc WHERE proname = 'increment_member_count'`, 'prosecdef rev'), 'f');
    sqlRun(asUser(USER_F, join(USER_F)), 'user F joins (reversed)');
    expect('reversal: defect is back (join not counted)', count('count'), 4);
    expect('reversal: rows say 5', rows('rows'), 5);
    sqlFile(MIGRATION, '108 on reversed state');
    expect('re-apply after reversal: reconciled', count('count'), 5);
    // After re-apply following reversal, reassert all security/privilege/trigger invariants
    assertFunctionSecurity('increment_member_count', 'after-reversal-reapply');
    assertFunctionSecurity('decrement_member_count', 'after-reversal-reapply');
    assertTriggers('after-reversal-reapply');
    assertUpdatePolicy('after-reversal-reapply');

    console.log(`\nALL PASS (${steps.length} steps)`);
  } finally {
    if (started) run(bin('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { detachedIo: true });
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
