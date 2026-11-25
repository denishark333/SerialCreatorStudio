import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.sessionStorage = {
  getItem: key => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: key => memory.delete(key),
};
const { apiSession, startSession, startAdminSession, endSession, restoreSession, refreshSession } =
  await import('../src/apiSession.ts');

const platform = { token: 'tok', workspaceId: 'studio-1', expiresAt: Date.now() + 3600000, primaryChannelId: 'yt-1' };

beforeEach(() => {
  memory.clear();
  endSession();
});

test('a platform login survives a reload (restore from sessionStorage)', () => {
  startSession(platform);
  endSessionInMemoryOnly();
  assert.equal(restoreSession(), true);
  assert.deepEqual({ ...apiSession }, platform);
});

test('logout clears the persisted session', () => {
  startSession(platform);
  endSession();
  assert.equal(restoreSession(), false);
  assert.equal(apiSession.token, '');
});

test('expired or malformed saved sessions are discarded', () => {
  startSession({ ...platform, expiresAt: Date.now() - 1 });
  endSessionInMemoryOnly();
  assert.equal(restoreSession(), false);
  assert.equal(memory.size, 0);
  memory.set('serial-session', '{not json');
  assert.equal(restoreSession(), false);
  memory.set('serial-session', JSON.stringify({ token: 5 }));
  assert.equal(restoreSession(), false);
});

test('the owner API_TOKEN is never written to storage', () => {
  startAdminSession('owner-secret-token', 'studio-live');
  assert.equal(apiSession.token, 'owner-secret-token');
  assert.equal(memory.size, 0);
  assert.equal(restoreSession(), false);
});

test('storage failures do not break signing in', () => {
  const original = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    },
  };
  try {
    startSession(platform);
    assert.equal(apiSession.token, 'tok');
    assert.equal(restoreSession(), false);
  } finally {
    globalThis.sessionStorage = original;
  }
});

/** Simulates a page reload: memory is reset, storage is kept. */
function endSessionInMemoryOnly() {
  Object.assign(apiSession, { token: '', workspaceId: 'studio-live', expiresAt: 0, primaryChannelId: null });
}

test('a renewed session replaces the token in memory and in storage; a refusal keeps the current one', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push([url, init.headers.Authorization]);
    return calls.length === 1
      ? new Response(JSON.stringify({ data: { accessToken: 'tok-2', expiresIn: 43200 } }), { status: 200 })
      : new Response(JSON.stringify({ error: { code: 'SESSION_MAX_AGE' } }), { status: 401 });
  });
  startSession(platform);
  assert.equal(await refreshSession('https://api.test'), true);
  assert.deepEqual(calls[0], ['https://api.test/api/v1/auth/refresh', 'Bearer tok']);
  assert.equal(apiSession.token, 'tok-2');
  assert.ok(apiSession.expiresAt > Date.now() + 11 * 3600000);
  endSessionInMemoryOnly();
  assert.equal(restoreSession(), true);
  assert.equal(apiSession.token, 'tok-2', 'the renewed token survives a reload');
  assert.equal(await refreshSession('https://api.test'), false);
  assert.equal(apiSession.token, 'tok-2');
});

test('the owner API_TOKEN session is never renewed', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  startAdminSession('owner-token', 'studio-live');
  assert.equal(await refreshSession('https://api.test'), false);
  assert.equal(fetchMock.mock.callCount(), 0);
});
