# Fan Sphere Incident Runbooks

## SLOs
- API response time: p50 < 200ms, p99 < 2s
- Realtime message delivery: < 500ms
- Uptime: 99.9% (max ~43 min downtime/month)
- Error rate: < 0.1% of requests

---

## 1. Database Connection Exhaustion

**Symptoms:** 503 errors, "too many connections" in Supabase logs, health check returns `unhealthy`

**Diagnosis:**
```sql
SELECT count(*) FROM pg_stat_activity;
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;
```

**Resolution:**
1. Check if connection pooling is enabled (Supabase Dashboard > Settings > Database > Connection Pooling)
2. If pooling is on, check for long-running queries: `SELECT pid, now() - pg_stat_activity.query_start AS duration, query FROM pg_stat_activity WHERE state != 'idle' ORDER BY duration DESC;`
3. Kill long-running queries: `SELECT pg_terminate_backend(pid);`
4. If persistent, increase `max_client_conn` in pooler settings
5. Check for subscription leaks — each Realtime channel holds a connection

**Prevention:** Monitor connection count in Grafana. Alert at 80% of max.

---

## 2. Realtime Subscription Limit

**Symptoms:** New users can't receive live updates, WebSocket connection errors in Sentry, existing subscribers work fine

**Diagnosis:**
- Check Supabase Dashboard > Realtime > Connected clients
- Check health-check endpoint `notificationQueue` metrics

**Resolution:**
1. Verify `useFocusEffect` subscriptions are cleaning up — check Sentry for unsubscribe errors
2. If at limit, temporarily disable realtime for non-critical screens (Groups, Discover already poll)
3. Contact Supabase support for connection limit increase
4. As last resort, switch all screens to polling (30s interval)

**Prevention:** Monitor connected client count. Alert at 70% of plan limit.

---

## 3. Notification Queue Backup

**Symptoms:** Users not receiving push notifications, `notification_queue` pending count growing, health check shows high `pending` count

**Diagnosis:**
```sql
SELECT status, count(*) FROM notification_queue GROUP BY status;
SELECT * FROM notification_queue WHERE status = 'dead' ORDER BY created_at DESC LIMIT 10;
```

**Resolution:**
1. Check if `process-notification-queue` edge function is running (Supabase Dashboard > Edge Functions > Invocations)
2. Check Expo Push API status: https://status.expo.dev/
3. If Expo is down, notifications will auto-retry (exponential backoff)
4. If dead letters are accumulating, check `error_message` column for pattern
5. To requeue dead letters: `UPDATE notification_queue SET status = 'pending', retry_count = 0, next_retry_at = NULL WHERE status = 'dead';`

**Prevention:** Alert when `dead` count > 50 or `pending` count > 1000.

---

## 4. ESPN API Outage (Game Schedule Sync)

**Symptoms:** Game schedules not updating, `sync-game-schedules` edge function returning errors

**Diagnosis:**
- Check `sync-game-schedules` invocation logs in Supabase Dashboard
- Test ESPN API manually: `curl https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`

**Resolution:**
1. The app gracefully degrades — cached game data continues to display
2. If outage is extended (>2 hours), manually update critical game scores via Supabase Dashboard
3. For World Cup specifically, consider adding a backup data source (football-data.org API)

**Prevention:** Circuit breaker on ESPN calls auto-stops hammering a down API. Monitor invocation errors.

---

## 5. App Crash Spike

**Symptoms:** Sentry error rate spike, user reports of blank screens or crashes

**Diagnosis:**
1. Open Sentry > Issues > Sort by frequency
2. Check if crash correlates with a recent deployment
3. Check component stack trace in Sentry error details

**Resolution:**
1. If deployment-related: roll back via EAS Update (`eas update --branch production --message "rollback"`)
2. If data-related: check for null/undefined in the crashing component's data source
3. `ScreenErrorBoundary` should catch render errors — if bypass, the error is in a hook or effect

**Prevention:** Run E2E tests (Maestro) before every production deploy. Monitor Sentry crash-free sessions rate.

---

## 6. Supabase Project Outage

**Symptoms:** All API calls failing, health check returns 503

**Diagnosis:**
- Check https://status.supabase.com/
- Check Supabase Dashboard for project status

**Resolution:**
1. App has offline fallback via `lib/cache.ts` — stale data displayed with offline banner
2. Offline action queue (`queueOfflineAction`) buffers writes
3. If extended outage, communicate via app's push notification backup (if tokens cached locally)
4. For total outage, post on social media channels

**Prevention:** Enable PITR (Point-in-Time Recovery) on Supabase. Test restore to staging monthly.

---

## Contact & Escalation

| Level | Timeframe | Action |
|-------|-----------|--------|
| L1 | 0-15 min | Check dashboards, run health check, review Sentry |
| L2 | 15-30 min | Apply runbook resolution steps |
| L3 | 30+ min | Escalate to Supabase support (Enterprise) or roll back deployment |
