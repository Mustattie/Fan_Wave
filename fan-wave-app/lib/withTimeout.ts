/**
 * Wraps a promise (or thenable — e.g. a Supabase PostgrestBuilder, which
 * is not a real Promise until you call `.then()` on it) with a timeout.
 * If it doesn't settle within `ms` milliseconds, the returned promise
 * rejects with an `Error` whose message starts with `Timeout after`.
 *
 * Accepts either the thenable directly or a thunk that returns one. The
 * thunk form lets callers keep `supabase.from(...)` fluent chains inline
 * without triggering the "'PostgrestBuilder' is not assignable to
 * 'Promise'" typescript error.
 */
export function withTimeout<T>(
  input: PromiseLike<T> | (() => PromiseLike<T>),
  ms: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    const thenable = typeof input === 'function' ? input() : input;
    Promise.resolve(thenable).then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
