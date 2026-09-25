/**
 * Decide whether an ESPN-derived games row would actually change the stored
 * row. Skipping no-op upserts matters because every UPDATE on public.games
 * fans out as a Realtime event to every connected client.
 *
 * Plain TypeScript: no Deno imports/globals (shared with Jest).
 */

const IGNORED_KEYS = new Set(["updated_at", "created_at", "last_synced_at"]);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Stable-key-order JSON so `{a,b}` and `{b,a}` serialise identically. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return value === undefined ? "null" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function normaliseScalar(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "string" && ISO_DATE_RE.test(v)) {
    // Postgres echoes timestamptz as "2026-09-25T20:00:00+00:00" while ESPN
    // sends "2026-09-25T20:00Z"; compare instants, not spellings.
    const ms = Date.parse(v);
    if (!Number.isNaN(ms)) return `@${ms}`;
  }
  return v;
}

function valueEqual(a: unknown, b: unknown): boolean {
  const na = normaliseScalar(a);
  const nb = normaliseScalar(b);
  if (na === nb) return true;
  if (na === null || nb === null) return false;
  if (typeof na === "object" || typeof nb === "object") {
    return stableStringify(na) === stableStringify(nb);
  }
  return false;
}

/**
 * True when `next` differs from `existing` on any key `next` writes
 * (timestamps in IGNORED_KEYS excluded). An undefined `existing` is always a
 * change (row does not exist yet).
 */
export function gameChanged(
  existing: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): boolean {
  if (!existing) return true;
  for (const key of Object.keys(next)) {
    if (IGNORED_KEYS.has(key)) continue;
    if (!valueEqual(existing[key], next[key])) return true;
  }
  return false;
}
