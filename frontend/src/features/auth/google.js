// PKCE is generated and verified by the Supabase SDK. This tab-local intent
// also keeps unsolicited callbacks from interrupting an existing sign-in.
const INTENT_KEY = 'flowlist-google-signin';
const views = ['#dashboard', '#goals', '#history'];
export const returnView = () => views.includes(location.hash) ? location.hash : '#dashboard';

export function captureGoogleCallback() {
  const url = new URL(location.href);
  if (url.searchParams.get('auth') !== 'google') return null;
  const fragment = new URLSearchParams(url.hash.slice(1));
  const callback = {
    code: url.searchParams.get('code'),
    error: url.searchParams.get('error') || fragment.get('error'),
  };
  // Remove one-use codes and provider errors before any app request or rendering.
  history.replaceState(null, '', '/');
  return callback;
}

export async function startGoogleSignIn(client) {
  sessionStorage.setItem(INTENT_KEY, JSON.stringify({startedAt:Date.now(), view:returnView()}));
  const {data, error} = await client.auth.signInWithOAuth({
    provider:'google',
    options:{redirectTo:`${location.origin}/?auth=google`, skipBrowserRedirect:true,
      scopes:'openid email profile', queryParams:{prompt:'select_account'}},
  });
  if (error || !data.url) {
    sessionStorage.removeItem(INTENT_KEY);
    throw new Error('Google sign-in could not start. Try again or use an email code.');
  }
  location.assign(data.url);
}

export async function finishGoogleSignIn(client, callback) {
  let intent;
  try { intent = JSON.parse(sessionStorage.getItem(INTENT_KEY) || 'null'); } catch { /* Treat invalid intent as expired. */ }
  sessionStorage.removeItem(INTENT_KEY);
  if (callback.error) {
    throw new Error(callback.error === 'access_denied'
      ? 'Google sign-in was canceled. Try again or use an email code.'
      : 'Google sign-in could not finish. Try again or use an email code.');
  }
  if (!callback.code || !intent || !Number.isFinite(intent.startedAt) ||
      Date.now() - intent.startedAt < 0 || Date.now() - intent.startedAt > 15 * 60 * 1000) {
    throw new Error('This sign-in attempt expired. Continue with Google again in this browser.');
  }
  const {data, error} = await client.auth.exchangeCodeForSession(callback.code);
  if (error || !data.session) {
    throw new Error('Google sign-in could not be verified. Continue with Google again in this browser, or use an email code.');
  }
  history.replaceState(null, '', `/${views.includes(intent.view) ? intent.view : '#dashboard'}`);
  return data.session;
}
