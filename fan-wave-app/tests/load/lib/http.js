/**
 * tests/load/lib/http.js — timed requests with the shared error taxonomy.
 *
 *   errors        Rate  — non-2xx that is NOT a rate-limit (counts toward the
 *                          <1 % gate)
 *   rate_limited  Rate  — 429, or 400/403 whose body mentions rate limiting
 *                          (migration 103 server ceilings raise P0001);
 *                          reported separately so a run that is throttled by
 *                          design is distinguishable from one that is failing
 *   <trend>       Trend — server-side duration of the named request
 */
import http from 'k6/http';
import { Rate, Counter } from 'k6/metrics';

export const errors = new Rate('errors');
export const rateLimited = new Rate('rate_limited');
export const bytesReceived = new Counter('payload_bytes');

const RATE_LIMIT_HINT = /rate.?limit|too many|throttl|over_request/i;

export function isRateLimited(res) {
  if (res.status === 429) return true;
  if ((res.status === 403 || res.status === 400) && RATE_LIMIT_HINT.test(String(res.body || ''))) {
    return true;
  }
  return false;
}

/** Record the outcome of a response; returns true when it is a 2xx. */
export function record(res, trend) {
  if (trend) trend.add(res.timings.duration);
  bytesReceived.add(res.body ? String(res.body).length : 0);
  if (res.status >= 200 && res.status < 300) {
    errors.add(0);
    rateLimited.add(0);
    return true;
  }
  if (isRateLimited(res)) {
    rateLimited.add(1);
    errors.add(0);
    return false;
  }
  errors.add(1);
  rateLimited.add(0);
  return false;
}

export function timedGet(url, headers, trend, name, tags = {}) {
  const res = http.get(url, { headers, tags: { name, ...tags } });
  record(res, trend);
  return res;
}

export function timedPost(url, body, headers, trend, name, tags = {}) {
  const res = http.post(url, typeof body === 'string' ? body : JSON.stringify(body), {
    headers,
    tags: { name, ...tags },
  });
  record(res, trend);
  return res;
}

export function rpc(restUrl, fn, args, headers, trend, tags = {}) {
  return timedPost(`${restUrl}/rpc/${fn}`, args, headers, trend, `rpc:${fn}`, tags);
}

/** Think time with ±jitter so VUs do not fall into lockstep. */
export function think(baseSeconds, jitterSeconds = baseSeconds / 2) {
  return baseSeconds + (Math.random() * 2 - 1) * jitterSeconds;
}
