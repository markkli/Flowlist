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
    errorCode: url.searchParams.get('error_code') || fragment.get('error_code'),
    // Older Auth versions may omit error_code. Match this known reason only;
    // never render arbitrary provider descriptions in the app.
    signupDisabled: [url.searchParams.get('error_description'), fragment.get('error_description')]
      .some(value => value?.trim().toLowerCase() === 'signups not allowed for this instance'),
  };
  // Remove one-use codes and provider errors before any app request or rendering.
  history.replaceState(null, '', '/');
  return callback;
}

export async function startGoogleSignIn(client, { emailEnabled = false } = {}) {
  sessionStorage.setItem(INTENT_KEY, JSON.stringify({startedAt:Date.now(), view:returnView()}));
  const {data, error} = await client.auth.signInWithOAuth({
    provider:'google',
    options:{redirectTo:`${location.origin}/?auth=google`, skipBrowserRedirect:true,
      scopes:'openid email profile', queryParams:{prompt:'select_account'}},
  });
  if (error || !data.url) {
    sessionStorage.removeItem(INTENT_KEY);
    throw new Error(`Google sign-in could not start. ${emailEnabled ? 'Try again or use an email code.' : 'Please try again.'}`);
  }
  location.assign(data.url);
}

export async function finishGoogleSignIn(client, callback, { emailEnabled = false } = {}) {
  let intent;
  try { intent = JSON.parse(sessionStorage.getItem(INTENT_KEY) || 'null'); } catch { /* Treat invalid intent as expired. */ }
  sessionStorage.removeItem(INTENT_KEY);
  if (callback.errorCode === 'signup_disabled' || callback.signupDisabled) {
    throw new Error('New accounts are currently disabled. If you deleted your account, you need a new invitation before signing in again. Contact the beta owner.');
  }
  if (callback.error || callback.errorCode) {
    // access_denied can mean cancellation OR a provider/account restriction.
    const explanation = callback.error === 'access_denied'
      ? 'Google sign-in was not completed. It may have been canceled or blocked.'
      : 'Google sign-in could not finish.';
    throw new Error(`${explanation} ${emailEnabled ? 'Try again or use an email code.' : 'Try again. If it keeps happening, contact the beta owner.'}`);
  }
  if (!callback.code || !intent || !Number.isFinite(intent.startedAt) ||
      Date.now() - intent.startedAt < 0 || Date.now() - intent.startedAt > 15 * 60 * 1000) {
    throw new Error('This sign-in attempt expired. Continue with Google again in this browser.');
  }
  const {data, error} = await client.auth.exchangeCodeForSession(callback.code);
  if (error || !data.session) {
    throw new Error(`Google sign-in could not be verified. ${emailEnabled ? 'Continue with Google again in this browser, or use an email code.' : 'Continue with Google again in this browser.'}`);
  }
  history.replaceState(null, '', `/${views.includes(intent.view) ? intent.view : '#dashboard'}`);
  return data.session;
}
