export class ApiError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: options.signal ?? AbortSignal.timeout(20000) });
  } catch {
    throw new ApiError('Could not connect. Your input is still here; check the connection and try again.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = typeof body.detail === 'string' ? body.detail : Array.isArray(body.detail) ? body.detail.map((item: {msg: string}) => item.msg).join('; ') : 'Request failed. Please try again.';
    throw new ApiError(detail, response.status);
  }
  return response.status === 204 ? null as T : response.json();
}
export const timezoneQuery = () => `timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`;
