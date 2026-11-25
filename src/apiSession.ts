/**
 * Current API session. Platform logins are kept in sessionStorage so a reload (F5) keeps the user signed in;
 * sessionStorage is per tab and cleared when the tab closes. The owner API_TOKEN (admin access, no expiry)
 * is deliberately never persisted: it stays in memory only.
 */
type Session = { token: string; workspaceId: string; expiresAt: number; primaryChannelId: string | null };

const STORAGE_KEY = 'serial-session';
const signedOut = (): Session => ({ token: '', workspaceId: 'studio-live', expiresAt: 0, primaryChannelId: null });

export const apiSession: Session = signedOut();

function store(value: Session | null) {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: the session still works for this page load.
  }
}

/** Platform login (expiring session token): persisted for reloads in this tab. */
export function startSession(value: Session) {
  Object.assign(apiSession, value);
  store(value.expiresAt > 0 ? value : null);
}

/** Owner API_TOKEN login: memory only. */
export function startAdminSession(token: string, workspaceId: string) {
  Object.assign(apiSession, { token, workspaceId, expiresAt: 0, primaryChannelId: null });
  store(null);
}

export function endSession() {
  Object.assign(apiSession, signedOut());
  store(null);
}

/** Restores a persisted, unexpired platform session. Returns true when the user is signed in. */
export function restoreSession(now = Date.now()): boolean {
  let saved: unknown = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    saved = null;
  }
  const v = saved as Partial<Session> | null;
  const valid =
    !!v &&
    typeof v.token === 'string' &&
    v.token.length > 0 &&
    typeof v.workspaceId === 'string' &&
    typeof v.expiresAt === 'number' &&
    v.expiresAt > now &&
    (v.primaryChannelId === null || typeof v.primaryChannelId === 'string');
  if (!valid) {
    store(null);
    return false;
  }
  Object.assign(apiSession, v);
  return true;
}

/**
 * Exchanges the platform session token for a new one (12 h, at most 7 days after signing in). Returns false when
 * the API refuses; the regular expiry check then ends the session.
 */
export async function refreshSession(apiBase: string): Promise<boolean> {
  if (!apiSession.token || !apiSession.expiresAt) return false;
  try {
    const r = await fetch(apiBase + '/api/v1/auth/refresh', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiSession.token },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return false;
    const { data } = await r.json();
    if (typeof data?.accessToken !== 'string' || typeof data?.expiresIn !== 'number') return false;
    startSession({ ...apiSession, token: data.accessToken, expiresAt: Date.now() + data.expiresIn * 1000 });
    return true;
  } catch {
    return false;
  }
}
