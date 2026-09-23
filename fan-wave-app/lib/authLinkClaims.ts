// One consumer per auth link (stability fix 8).
//
// Two code paths receive the same fansphere:// auth link: the global
// Linking handler in lib/supabase.ts (cold and warm starts) and the
// app/auth-callback route (which also handles PKCE token_hash links). Both
// used to call supabase.auth.setSession() with the tokens from the same
// fragment. If the link's access token was near expiry, that meant two
// refresh attempts with one refresh token; auth-js dedupes them only when
// they overlap in flight, and production rotates refresh tokens with a 10 s
// reuse window, past which GoTrue revokes the whole session family and
// every later /user call answers session_not_found.
//
// Whichever path runs first claims the token; the other sees the claim and
// only reflects the outcome. Tokens are never stored: only a short
// non-reversible hash of the access token, kept for a minute.

const CLAIM_TTL_MS = 60_000;
const claims = new Map<string, number>();

function fingerprint(token: string): string {
  let h = 5381;
  for (let i = 0; i < token.length; i++) h = ((h << 5) + h + token.charCodeAt(i)) | 0;
  return `${token.length}:${(h >>> 0).toString(36)}`;
}

/**
 * Returns true if the caller is the first to see this access token (and
 * should exchange it), false if another path already did.
 */
export function claimAuthLink(accessToken: string, now: () => number = Date.now): boolean {
  const t = now();
  for (const [key, at] of claims) {
    if (t - at > CLAIM_TTL_MS) claims.delete(key);
  }
  const key = fingerprint(accessToken);
  if (claims.has(key)) return false;
  claims.set(key, t);
  return true;
}

/** Test hook. */
export function _resetAuthLinkClaimsForTests(): void {
  claims.clear();
}
