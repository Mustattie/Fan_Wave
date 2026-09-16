/**
 * Where Supabase sends the browser after it verifies an auth email link.
 *
 * This is an https URL, not `fansphere://auth-callback`, and the distinction
 * is the whole point. Supabase verifies the token server-side and then 302s
 * the browser to whatever we pass here. A desktop browser cannot open a custom
 * scheme, so pointing it at `fansphere://` rendered a blank page and the
 * tester concluded — reasonably — that confirmation had failed. It had not:
 * `email_confirmed_at` is written before the redirect. Only the handoff broke.
 *
 * https://fansphere.org/auth/ is a page every browser can open (docs/auth/ in
 * this repo, served by GitHub Pages). It forwards the tokens to
 * `fansphere://auth-callback` on a phone, and on a computer it says plainly
 * that the account is confirmed and the last step happens on the phone.
 *
 * The app side is unchanged: app/auth-callback.tsx still receives the custom
 * scheme, because that is what the bridge page forwards to.
 *
 * This URL must stay in the project's Auth redirect allow-list (Supabase
 * dashboard → Authentication → URL Configuration, mirrored in
 * supabase/config.toml). Supabase silently falls back to the Site URL for any
 * redirect that is not listed, which would look exactly like this bug again.
 */
export const AUTH_REDIRECT_URL = 'https://fansphere.org/auth/';
