let owner: string | null = null;
let accessToken: (() => Promise<string | null>) | null = null;
let locked = false;
export function configureAccount(id: string | null, token: (() => Promise<string | null>) | null) {
  owner = id; accessToken = token; locked = false;
}
export const accountKey = (key: string) => owner ? `${key}:${owner}` : key;
export const accountId = () => owner;
export function lockAccount() { locked = true; }
export function accountLocked() { return locked; }
export async function requestToken() {
  if (locked) throw new Error('Your account changed. Reload to continue safely.');
  if (!accessToken) return null;
  const token = await accessToken();
  if (!token) throw new Error('Your sign-in has expired. Sign in again to continue.');
  return token;
}
export function clearAccountDrafts(id: string) {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('flowlist-') && key.endsWith(`:${id}`)) localStorage.removeItem(key);
  }
}
