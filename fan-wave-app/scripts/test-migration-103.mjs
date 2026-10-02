#!/usr/bin/env node
/**
 * scripts/test-migration-103.mjs — proves migration 103 on a scratch Postgres.
 *
 * Nothing here touches Supabase. It boots a throw-away cluster with initdb,
 * then runs, in order:
 *   1. supabase/tests/103/fixture_schema.sql  (roles, auth.uid(), tables,
 *      tier helpers and the like/follow RPCs copied verbatim)
 *   2. the REAL 099, 073 and 102 migrations
 *   3. the REAL 103 — twice, to prove idempotency
 *   4. supabase/tests/103/test_103_rate_limit_ceilings.sql
 *   5. a concurrency race: 8 connections write as one user whose bucket
 *      is 5 short of the ceiling, 24 attempts, each holding its
 *      transaction open — exactly 5 may land (concurrency_worker.sql).
 *      With RACE_DEMO=1 the same race is first run against a copy of
 *      rate_limit_consume WITHOUT its advisory lock, to show the test
 *      catches the overshoot it is there for.
 *   6. the executable reversal blocks from 103's footer + a re-run of 099,
 *      then checks the pre-103 state is back
 *   7. 103 once more on top of the reversed state
 * and tears the cluster down.
 *
 * Needs initdb / pg_ctl / psql on PATH or in $PG_BIN (PostgreSQL 14+).
 * Optional: Python with pglast for a grammar check of the migration.
 *
 *   node scripts/test-migration-103.mjs
 *   PG_BIN="C:/Program Files/PostgreSQL/16/bin" node scripts/test-migration-103.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '..');
const MIG = path.join(app, 'supabase', 'migrations');
const TESTS = path.join(app, 'supabase', 'tests', '103');
const MIGRATION_103 = path.join(MIG, '103_rate_limit_server_ceilings.sql');

const exe = process.platform === 'win32' ? '.exe' : '';
function bin(name) {
  if (process.env.PG_BIN) {
    const p = path.join(process.env.PG_BIN, name + exe);
    if (existsSync(p)) return p;
  }
  return name; // rely on PATH
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    env: { ...process.env, PGCLIENTENCODING: 'UTF8', PGOPTIONS: '-c client_min_messages=notice', ...(opts.env || {}) },
    input: opts.input,
    // pg_ctl start hands its stdio to the postgres it launches; on Windows
    // the server then holds our stdout pipe open and spawnSync never
    // returns. The server log goes to -l instead.
    stdio: opts.detachedIo ? 'ignore' : 'pipe',
  });
  if (res.error) throw res.error;
  return res;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

const steps = [];
function ok(label, extra = '') { steps.push(`PASS  ${label}${extra ? ' — ' + extra : ''}`); console.log(`PASS  ${label}${extra ? ' — ' + extra : ''}`); }
function fail(label, output) {
  console.error(`FAIL  ${label}\n${output}`);
  throw new Error(`step failed: ${label}`);
}

/** Run one psql process asynchronously; resolves with {status, out}. */
function psqlAsync(args) {
  return new Promise((resolve) => {
    const child = spawn(bin('psql'), args, {
      env: { ...process.env, PGCLIENTENCODING: 'UTF8' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (status) => resolve({ status, out }));
  });
}

/** Pull the executable SQL between "-- NAME-BEGIN" and "-- NAME-END" comment markers. */
function reversalBlock(sql, name) {
  const re = new RegExp(`-- ${name}-BEGIN\\n([\\s\\S]*?)-- ${name}-END`);
  const m = sql.match(re);
  if (!m) throw new Error(`reversal block ${name} not found in 103`);
  return m[1].split('\n').map((l) => l.replace(/^-- ?/, '')).join('\n');
}

async function main() {
  // 0. optional grammar check. pglast parses the SQL and the PL/pgSQL
  //    bodies of ordinary functions; its libpg_query build cannot
  //    serialise trigger-function bodies (the TG_* datums come out as
  //    malformed JSON for every trigger function in this repo, 080/089/102
  //    included), so those are left to the scratch server below, which
  //    compiles every body on CREATE FUNCTION and again on first call.
  {
    const py = run('python', ['-c', [
      'import re, sys',
      'from pglast import parser, parse_plpgsql, split',
      'src = open(sys.argv[1], encoding="utf-8").read()',
      'stmts = parser.parse_sql(src)',
      'checked = skipped = 0',
      'for st in split(src):',
      '    if not re.match(r"\\s*CREATE (OR REPLACE )?FUNCTION", st, re.I): continue',
      '    if "RETURNS TRIGGER" in st.upper(): skipped += 1; continue',
      '    parse_plpgsql(st); checked += 1',
      'print("pglast ok: %d statements, %d function bodies parsed, %d trigger bodies left to the server" % (len(stmts), checked, skipped))',
    ].join('\n'), MIGRATION_103]);
    if (py.status === 0) ok('grammar (pglast)', py.stdout.trim());
    else console.log(`SKIP  grammar (pglast) — ${(py.stderr || py.stdout || '').trim().split('\n').pop()}`);
  }

  const dataDir = mkdtempSync(path.join(process.env.PG_TEST_DIR || tmpdir(), 'fw-mig103-'));
  const port = await freePort();
  const logFile = path.join(dataDir, 'postgres.log');
  const conn = ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres'];
  let started = false;

  const psql = (db, args, label) => {
    const res = run(bin('psql'), [...conn, '-d', db, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args]);
    if (res.status !== 0) fail(label, (res.stderr || '') + (res.stdout || ''));
    return res;
  };
  const psqlFile = (file, label) => psql('fw_test', ['-f', file], label || path.basename(file));
  const psqlSql = (sql, label) => psql('fw_test', ['-c', sql], label);
  /** Like psqlSql but returns only the tuple text (no header/footer). */
  const psqlValue = (sql, label) => psql('fw_test', ['-t', '-A', '-c', sql], label);

  try {
    // 1. cluster
    const init = run(bin('initdb'), ['-D', dataDir, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C', '-N']);
    if (init.status !== 0) fail('initdb', init.stderr + init.stdout);
    const start = run(bin('pg_ctl'), ['-D', dataDir, '-l', logFile, '-w', '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off`, 'start'], { detachedIo: true });
    if (start.status !== 0) fail('pg_ctl start', existsSync(logFile) ? readFileSync(logFile, 'utf8') : `pg_ctl exit ${start.status}`);
    started = true;
    psql('postgres', ['-c', 'CREATE DATABASE fw_test'], 'create database');
    ok('scratch cluster', `port ${port}`);

    // 2. fixture + real predecessors
    psqlFile(path.join(TESTS, 'fixture_schema.sql'));
    ok('fixture schema');
    psqlFile(path.join(MIG, '099_rate_limit_auth_uid.sql'));
    psqlFile(path.join(MIG, '073_rsvp_rpc_delete_on_cancel.sql'));
    psqlFile(path.join(MIG, '102_clip_quota_server_enforced.sql'));
    ok('real 099 + 073 + 102 applied on the fixture');

    // 3. 103, twice
    psqlFile(MIGRATION_103, '103 (first apply)');
    psqlFile(MIGRATION_103, '103 (second apply — idempotency)');
    ok('103 applied twice without error');

    // 4. behaviour
    const t = psqlFile(path.join(TESTS, 'test_103_rate_limit_ceilings.sql'), 'behaviour tests');
    const okLines = (t.stderr + t.stdout).split('\n').filter((l) => /ok: T\d+/.test(l)).map((l) => l.replace(/^.*?ok: /, '  ok: '));
    okLines.forEach((l) => console.log(l));
    ok('behaviour tests', `${okLines.length} blocks`);

    // 5. concurrency: 8 connections, one user 5 short of the 60/min
    //    messages ceiling, 24 attempts that each hold their transaction
    //    open for 250 ms. Exactly 5 may commit.
    const sql103 = readFileSync(MIGRATION_103, 'utf8');
    const race = async (label, expectExact) => {
      const setup = psqlValue(`
        WITH u AS (
          INSERT INTO public.users (auth_id, subscription_tier) VALUES (gen_random_uuid(), 'free') RETURNING auth_id
        ), r AS (
          INSERT INTO public.chat_rooms DEFAULT VALUES RETURNING id
        ), fill AS (
          INSERT INTO public.rate_limits (user_id, action)
          SELECT u.auth_id, 'messages_insert' FROM u, generate_series(1, 55)
        )
        SELECT u.auth_id || ' ' || r.id FROM u, r;`, `${label}: setup`);
      const [uid, room] = setup.stdout.trim().split(/\s+/);
      const workers = [];
      for (let i = 0; i < 8; i++) {
        workers.push(psqlAsync([...conn, '-d', 'fw_test', '-X', '-q', '-v', `uid=${uid}`, '-v', `room=${room}`, '-f', path.join(TESTS, 'concurrency_worker.sql')]));
      }
      await Promise.all(workers);
      const count = psqlValue(`SELECT (SELECT count(*) FROM public.messages WHERE user_id = '${uid}') || ' ' || (SELECT COALESCE(sum(count),0) FROM public.rate_limits WHERE user_id = '${uid}' AND action = 'messages_insert');`, `${label}: count`);
      const [landed, ledger] = count.stdout.trim().split(/\s+/).map(Number);
      if (expectExact) {
        if (landed !== 5 || ledger !== 60) fail(label, `expected exactly 5 rows / 60 ledger, got ${landed} rows / ${ledger} ledger — the ceiling was overshot`);
        ok(label, `24 concurrent attempts, 5 landed, ledger 60`);
      } else {
        console.log(`INFO  ${label}: ${landed} rows landed / ledger ${ledger} (ceiling 60 — ${landed > 5 ? 'OVERSHOT, as expected without the lock' : 'no overshoot observed this run'})`);
      }
      return landed;
    };
    if (process.env.RACE_DEMO) {
      // Same function body with the advisory lock removed: the race the test exists to catch.
      const consumeSrc = sql103.match(/CREATE OR REPLACE FUNCTION public\.rate_limit_consume\([\s\S]*?\n\$\$;/)[0];
      const unlocked = consumeSrc.replace(/\n\s*PERFORM pg_advisory_xact_lock\([^\n]*\n/, '\n');
      if (unlocked === consumeSrc) fail('race demo', 'could not strip the advisory lock from rate_limit_consume');
      psqlSql(unlocked, 'race demo: install unlocked consume');
      await race('race demo WITHOUT advisory lock', false);
      psqlFile(MIGRATION_103, 'race demo: restore 103');
    }
    await race('concurrency (advisory lock)', true);

    // 6. reversal: A, then 099 again, then B
    const revA = path.join(dataDir, 'reversal_a.sql');
    const revB = path.join(dataDir, 'reversal_b.sql');
    writeFileSync(revA, reversalBlock(sql103, 'REVERSAL-A'));
    writeFileSync(revB, reversalBlock(sql103, 'REVERSAL-B'));
    psqlFile(revA, 'reversal A (triggers + trigger-path functions)');
    psqlFile(path.join(MIG, '099_rate_limit_auth_uid.sql'), '099 re-applied after reversal A');
    psqlFile(revB, 'reversal B (ceiling + gc functions)');
    psqlSql(`
      DO $$
      DECLARE u UUID := gen_random_uuid(); n INT;
      BEGIN
        SELECT count(*) INTO n FROM pg_trigger WHERE tgname LIKE 'trg_rate_limit_%';
        ASSERT n = 0, format('%s rate-limit triggers survived reversal', n);
        ASSERT NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('rate_limit_ceiling','rate_limit_consume','rate_limit_gc','rate_limit_request_role','enforce_insert_rate_limit')), 'a 103 function survived reversal';
        -- 099 semantics are back: everyone gets clip_post 5/h
        INSERT INTO public.users (auth_id, subscription_tier) VALUES (u, 'home_team');
        PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
        FOR i IN 1..5 LOOP ASSERT public.check_rate_limit(u, 'clip_post', 5, 3600); END LOOP;
        ASSERT NOT public.check_rate_limit(u, 'clip_post', 5, 3600), 'post-reversal check_rate_limit is not the 099 body';
        -- and inserts are unlimited again (no trigger), as before 103
        PERFORM set_config('role', 'authenticated', true);
        FOR i IN 1..70 LOOP
          INSERT INTO public.messages (chat_room_id, user_id, content)
          VALUES ((SELECT id FROM public.chat_rooms LIMIT 1), u, 'post-reversal');
        END LOOP;
      END $$;`, 'post-reversal state check');
    ok('reversal restores the 099 state');

    // 7. re-apply on the reversed state
    psqlFile(MIGRATION_103, '103 (re-apply after reversal)');
    psqlSql(`DO $$ BEGIN ASSERT (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_rate_limit_%') = 8; END $$;`, 're-apply shape');
    ok('103 re-applies cleanly after reversal');

    console.log(`\nALL PASS (${steps.length} steps)`);
  } finally {
    if (started) run(bin('pg_ctl'), ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], { detachedIo: true });
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* scratch dir; leave it */ }
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
