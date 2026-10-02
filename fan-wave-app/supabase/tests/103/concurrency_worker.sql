-- One concurrent writer for the migration 103 race test. The runner
-- starts several of these at once against the same user (psql vars :uid
-- and :room), each in its own connection.
--
-- Every attempt is a transaction that inserts one message and then holds
-- the transaction open for a moment before committing. With no
-- serialisation, every concurrent transaction reads the same committed
-- count, passes, and the user overshoots the ceiling. With the
-- transaction-scoped advisory lock in rate_limit_consume, the waiters
-- queue behind the sleep and see each committed row before counting.
--
-- ON_ERROR_STOP is off on purpose: a refused insert (PT429) aborts that
-- transaction, the remaining statements of the attempt error with
-- "current transaction is aborted", COMMIT rolls back, and the next
-- attempt starts clean. The runner counts outcomes in the tables.

\set ON_ERROR_STOP off
\set QUIET on

BEGIN;
SELECT set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', :'uid'), true);
SELECT set_config('role', 'authenticated', true);
INSERT INTO public.messages (chat_room_id, user_id, content) VALUES (:'room', :'uid', 'race 1');
SELECT pg_sleep(0.25);
COMMIT;

BEGIN;
SELECT set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', :'uid'), true);
SELECT set_config('role', 'authenticated', true);
INSERT INTO public.messages (chat_room_id, user_id, content) VALUES (:'room', :'uid', 'race 2');
SELECT pg_sleep(0.25);
COMMIT;

BEGIN;
SELECT set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', :'uid'), true);
SELECT set_config('role', 'authenticated', true);
INSERT INTO public.messages (chat_room_id, user_id, content) VALUES (:'room', :'uid', 'race 3');
SELECT pg_sleep(0.25);
COMMIT;
