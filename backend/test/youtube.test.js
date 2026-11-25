import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createYouTube, LIVE_WORKSPACE } from '../src/youtube.js';
import { testRepository as createRepository } from './fixtures/repository.js';
import { createVault } from '../src/vault.js';
import { createApp } from '../src/app.js';
function googleFactory() {
  return () => ({
    credentials: {},
    generateAuthUrl(params) {
      return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams(params);
    },
    async getToken() {
      return {
        tokens: {
          access_token: 'test-access',
          refresh_token: 'test-refresh',
          scope: 'https://www.googleapis.com/auth/youtube.readonly',
        },
      };
    },
    setCredentials(c) {
      this.credentials = c;
    },
    async getAccessToken() {
      this.credentials.access_token = 'renewed';
      return { token: 'renewed' };
    },
  });
}
async function fixture(t, { maxPages = 10 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'serial-google-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'store.json');
  const repository = await createRepository({ file });
  const vault = await createVault(join(dir, 'token.key'));
  const urls = [];
  const fetcher = async (url, options) => {
    urls.push(new URL(url));
    assert.ok(options.headers.Authorization.startsWith('Bearer '));
    const u = new URL(url);
    let result;
    if (u.pathname.endsWith('/channels'))
      result = {
        items: [
          {
            id: 'UC-real',
            snippet: { title: 'Meu canal' },
            statistics: { subscriberCount: '123' },
            contentDetails: { relatedPlaylists: { uploads: 'UU-real' } },
          },
        ],
      };
    else if (u.pathname.endsWith('/playlistItems'))
      result = {
        items: [{ contentDetails: { videoId: u.searchParams.get('pageToken') ? 'second' : 'first' } }],
        ...(u.searchParams.has('pageToken') ? {} : { nextPageToken: 'page2' }),
      };
    else
      result = {
        items: [
          {
            id: u.searchParams.get('id'),
            snippet: {
              title: 'Conteúdo real',
              publishedAt: '2026-11-01T12:00:00Z',
              thumbnails: { high: { url: 'https://i.ytimg.com/test.jpg' } },
            },
            statistics: { viewCount: '42', likeCount: '5' },
            contentDetails: { duration: 'PT1H2M3S' },
            status: { privacyStatus: 'private' },
          },
        ],
      };
    return { ok: true, status: 200, json: async () => result };
  };
  const youtube = createYouTube({
    repository,
    vault,
    clientId: 'test-id',
    clientSecret: 'test-secret',
    fetcher,
    oauthFactory: googleFactory(),
    maxPages,
  });
  return { dir, file, repository, vault, youtube, urls };
}
async function authorize(youtube) {
  const ticket = new URL(youtube.authorize(LIVE_WORKSPACE).authorizationUrl).searchParams.get('ticket');
  const started = await youtube.start(ticket);
  const state = new URL(started.url).searchParams.get('state');
  const params = new URLSearchParams({ state, code: 'test-code' });
  return { ticket, started, params, cookie: started.cookie.split(';')[0] };
}
test('vault encryption persists and rejects tampering', async t => {
  const f = await fixture(t);
  const encrypted = f.vault.seal({ refresh_token: 'sensitive' });
  assert.ok(!encrypted.includes('sensitive'));
  const reopen = await createVault(join(f.dir, 'token.key'));
  assert.equal(reopen.open(encrypted).refresh_token, 'sensitive');
  const b = Buffer.from(encrypted, 'base64');
  b[15] ^= 1;
  assert.throws(() => reopen.open(b.toString('base64')));
});
test('OAuth requires config and browser binding; ticket and state cannot replay', async t => {
  const f = await fixture(t);
  assert.throws(() => createYouTube({ repository: f.repository }).authorize(LIVE_WORKSPACE), {
    code: 'YOUTUBE_NOT_CONFIGURED',
  });
  const a = await authorize(f.youtube);
  const url = new URL(a.started.url);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(a.started.cookie.includes('HttpOnly; SameSite=Lax'));
  await assert.rejects(f.youtube.start(a.ticket), { code: 'INVALID_OAUTH_TICKET' });
  await assert.rejects(f.youtube.callback(a.params, 'serial_google_oauth=wrong'), { code: 'INVALID_OAUTH_STATE' });
  const result = await f.youtube.callback(a.params, a.cookie);
  assert.equal(result.location, 'http://localhost:5173/#/settings?youtube=connected');
  await assert.rejects(f.youtube.callback(a.params, a.cookie), { code: 'INVALID_OAUTH_STATE' });
  const raw = await readFile(f.file, 'utf8');
  assert.ok(!raw.includes('test-refresh'));
  const status = f.youtube.status(LIVE_WORKSPACE);
  assert.equal(status.items.length, 1);
  assert.ok(!JSON.stringify(status).includes('encryptedTokens'));
  assert.ok(!JSON.stringify(status).includes('test-access'));
});
test('sync pages, normalizes private catalog, upserts, refreshes credentials, keeps demo separate', async t => {
  const f = await fixture(t);
  const a = await authorize(f.youtube);
  await f.youtube.callback(a.params, a.cookie);
  let result = await f.youtube.sync(LIVE_WORKSPACE, 'yt-UC-real');
  assert.equal(result.imported, 2);
  assert.equal(result.complete, true);
  const state = f.repository.read();
  const real = state.contents.filter(c => c.workspaceId === LIVE_WORKSPACE);
  assert.equal(real.length, 2);
  assert.equal(real[0].status, 'Privado');
  assert.equal(real[0].duration, '1:02:03');
  assert.equal(real[0].retention, null);
  assert.equal(real[0].comments, null);
  assert.equal(real[0].formatClassification, 'shorts_unclassified');
  assert.equal(state.metrics.filter(m => m.workspaceId === LIVE_WORKSPACE).length, 0);
  assert.equal(state.contents.filter(c => c.workspaceId === 'studio-demo').length, 7);
  await f.youtube.sync(LIVE_WORKSPACE, 'yt-UC-real');
  assert.equal(f.repository.read().contents.filter(c => c.workspaceId === LIVE_WORKSPACE).length, 2);
  await assert.rejects(f.youtube.sync('studio-demo', 'yt-UC-real'), { code: 'CHANNEL_NOT_FOUND' });
  const saved = f.repository.read().connections[0];
  assert.equal(f.vault.open(saved.encryptedTokens).access_token, 'renewed');
  await f.youtube.disconnect(LIVE_WORKSPACE, saved.id);
  assert.equal(f.repository.read().contents.filter(c => c.workspaceId === LIVE_WORKSPACE).length, 0);
});
test('partial import resumes at saved cursor', async t => {
  const f = await fixture(t, { maxPages: 1 });
  const a = await authorize(f.youtube);
  await f.youtube.callback(a.params, a.cookie);
  assert.equal((await f.youtube.sync(LIVE_WORKSPACE, 'yt-UC-real')).complete, false);
  assert.equal(f.repository.read().channels.find(c => c.id === 'yt-UC-real').nextPageToken, 'page2');
  assert.equal((await f.youtube.sync(LIVE_WORKSPACE, 'yt-UC-real')).complete, true);
  assert.equal(f.repository.read().contents.filter(c => c.workspaceId === LIVE_WORKSPACE).length, 2);
});
test('HTTP callback works without owner bearer but requires state; live analytics never invents views', async t => {
  const f = await fixture(t);
  const app = createApp({ repository: f.repository, youtube: f.youtube, token: 'owner-test' });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  t.after(
    () =>
      new Promise(r => {
        app.close(r);
        app.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${app.address().port}`;
  let response = await fetch(base + '/api/v1/oauth/google/callback?state=bad&code=no');
  assert.equal(response.status, 400);
  const a = await authorize(f.youtube);
  response = await fetch(base + '/api/v1/oauth/google/callback?' + a.params, {
    headers: { Cookie: a.cookie },
    redirect: 'manual',
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'http://localhost:5173/#/settings?youtube=connected');
  await f.youtube.sync(LIVE_WORKSPACE, 'yt-UC-real');
  response = await fetch(base + '/api/v1/workspaces/studio-live/analytics', {
    headers: { Authorization: 'Bearer owner-test' },
  });
  const payload = await response.json();
  assert.equal(payload.meta.mode, 'live');
  assert.equal(payload.data.summary.views, null);
  assert.equal(payload.data.summary.watchTimeMinutes, null);
  assert.deepEqual(payload.data.timeseries, []);
  response = await fetch(base + '/api/v1/workspaces/studio-live/contents', {
    headers: { Authorization: 'Bearer owner-test' },
  });
  assert.equal((await response.json()).data[0].periodViews, null);
});

test('one consent requests catalog, analytics, revenue and comments together', async t => {
  const f = await fixture(t);
  const ticket = new URL(f.youtube.authorize(LIVE_WORKSPACE).authorizationUrl).searchParams.get('ticket');
  const started = await f.youtube.start(ticket);
  const scope = new URL(started.url).searchParams.get('scope');
  for (const name of [
    'youtube.readonly',
    'yt-analytics.readonly',
    'yt-analytics-monetary.readonly',
    'youtube.force-ssl',
  ])
    assert.ok(scope.includes('/' + name));
});
