import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../src/auth.js';
import { createRepository } from '../src/repository.js';
import { createStreams } from '../src/streams.js';
import { createYouTube, REQUIRED_YOUTUBE_SCOPES } from '../src/youtube.js';
import { createApp } from '../src/app.js';

test('independent platform identities get isolated studios; linked providers reuse a studio', async () => {
  const repository = await createRepository(),
    auth = createAuth({ repository });
  const a = auth.begin('Twitch', 'a'),
    b = auth.begin('Twitch', 'b');
  const wa = await auth.identify(a.id, null, 'Twitch', ['100']);
  const wb = await auth.identify(b.id, null, 'Twitch', ['200']);
  assert.notEqual(wa, wb);
  assert.notEqual(wa, 'studio-live');
  auth.complete(a.id, wa);
  auth.complete(b.id, wb);
  assert.throws(() => auth.poll(a.id, b.secret), /expirado/);
  const sa = auth.poll(a.id, a.secret),
    sb = auth.poll(b.id, b.secret);
  assert.equal(auth.session(sa.accessToken).workspaceId, wa);
  assert.equal(auth.session(sb.accessToken).workspaceId, wb);
  assert.throws(() => auth.poll(a.id, a.secret));
  await auth.identify(null, wa, 'Kick', ['300']);
  const again = auth.begin('Kick', 'a');
  assert.equal(await auth.identify(again.id, null, 'Kick', ['300']), wa);
  await assert.rejects(auth.identify(null, wb, 'Kick', ['300']), e => e.code === 'ACCOUNT_ALREADY_LINKED');
  auth.logout(sa.accessToken);
  assert.equal(auth.session(sa.accessToken), null);
});

test('HTTP sessions cannot enumerate, read, mutate or connect another user studio', async t => {
  const repository = await createRepository(),
    auth = createAuth({ repository });
  async function user(id) {
    const c = auth.begin('Twitch', id),
      w = await auth.identify(c.id, null, 'Twitch', [id]);
    auth.complete(c.id, w);
    return auth.poll(c.id, c.secret);
  }
  const a = await user('a'),
    b = await user('b');
  const app = createApp({ repository, auth, token: 'owner-secret' });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => app.close(r)));
  const base = 'http://127.0.0.1:' + app.address().port,
    headers = { Authorization: 'Bearer ' + a.accessToken };
  const list = await (await fetch(base + '/api/v1/workspaces', { headers })).json();
  assert.deepEqual(
    list.data.map(w => w.id),
    [a.workspaceId],
  );
  for (const [resource, method] of [
    ['channels', 'GET'],
    ['contents', 'GET'],
    ['analytics', 'GET'],
    ['community/comments', 'GET'],
    ['plans', 'POST'],
    ['connections/Twitch/authorize', 'POST'],
    ['sync', 'POST'],
  ]) {
    assert.equal(
      (await fetch(base + '/api/v1/workspaces/' + b.workspaceId + '/' + resource, { method, headers })).status,
      403,
    );
  }
  assert.equal((await fetch(base + '/api/v1/workspaces/studio-live/channels', { headers })).status, 403);
  assert.equal((await fetch(base + '/api/v1/workspaces/' + a.workspaceId + '/channels', { headers })).status, 200);
  await fetch(base + '/api/v1/auth/logout', { method: 'POST', headers });
  assert.equal((await fetch(base + '/api/v1/workspaces', { headers })).status, 401);
});

test('login challenge expiry, cancellation, rate limits and session expiry', async () => {
  let time = 0;
  const repository = await createRepository(),
    auth = createAuth({ repository, now: () => time });
  const c = auth.begin('Kick', 'a');
  auth.reject(c.id);
  assert.throws(() => auth.poll(c.id, c.secret), /cancelado/);
  const expired = auth.begin('Kick', 'b');
  time = 600001;
  assert.throws(() => auth.poll(expired.id, expired.secret), /expirado/);
  for (let i = 0; i < 10; i++) auth.begin('Kick', 'c');
  assert.throws(() => auth.begin('Kick', 'c'), /Aguarde/);
  const ready = auth.begin('Kick', 'd'),
    w = await auth.identify(ready.id, null, 'Kick', ['1']);
  auth.complete(ready.id, w);
  const session = auth.poll(ready.id, ready.secret);
  time += 43200001;
  assert.equal(auth.session(session.accessToken), null);
});

test('Twitch login verifies provider identity, stores its channel in private studio and supports reconnect', async () => {
  const repository = await createRepository(),
    auth = createAuth({ repository });
  const fetcher = async url => {
    const u = new URL(url);
    let result;
    if (u.pathname.endsWith('/token')) result = { access_token: 't', refresh_token: 'r', expires_in: 3600 };
    else if (u.pathname.endsWith('/users'))
      result = { data: [{ id: '123', display_name: 'Creator', login: 'creator' }] };
    else if (u.pathname.endsWith('/validate')) result = { client_id: 'client', user_id: '123' };
    else throw new Error(url);
    return { ok: true, status: 200, json: async () => result };
  };
  const streams = createStreams({
    repository,
    auth,
    vault: { seal: v => v, open: v => v },
    fetcher,
    configs: {
      Twitch: {
        clientId: 'client',
        clientSecret: 'secret',
        redirectUri: 'https://example.org/api/v1/oauth/twitch/callback',
      },
    },
  });
  async function login() {
    const challenge = auth.begin('Twitch', 'a'),
      ticket = new URL(streams.authorize(null, 'Twitch', challenge.id).authorizationUrl).searchParams.get('ticket'),
      start = streams.start('Twitch', ticket),
      state = new URL(start.url).searchParams.get('state');
    await streams.callback('Twitch', new URLSearchParams({ state, code: 'code' }), start.cookie);
    return auth.poll(challenge.id, challenge.secret);
  }
  const first = await login(),
    again = await login();
  assert.equal(first.workspaceId, again.workspaceId);
  const channels = repository.read().channels;
  assert.equal(channels.length, 1);
  assert.equal(channels[0].workspaceId, first.workspaceId);
  assert.match(channels[0].id, new RegExp('^' + first.workspaceId));
});

test('YouTube login discovers authenticated channel before binding private studio', async () => {
  const repository = await createRepository(),
    auth = createAuth({ repository });
  const youtube = createYouTube({
    repository,
    auth,
    vault: { seal: v => v, open: v => v },
    clientId: 'c',
    clientSecret: 's',
    redirectUri: 'https://example.org/api/v1/oauth/google/callback',
    fetcher: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          { id: 'channel', snippet: { title: 'Owner' }, statistics: { subscriberCount: '2' }, contentDetails: {} },
        ],
      }),
    }),
    oauthFactory: () => ({
      generateAuthUrl: params => 'https://google.example/?' + new URLSearchParams({ state: params.state }),
      getToken: async () => ({
        tokens: { access_token: 't', refresh_token: 'r', scope: REQUIRED_YOUTUBE_SCOPES.join(' ') },
      }),
    }),
  });
  const c = auth.begin('YouTube', 'a'),
    ticket = new URL(youtube.authorize(null, c.id).authorizationUrl).searchParams.get('ticket'),
    start = await youtube.start(ticket),
    state = new URL(start.url).searchParams.get('state');
  const callback = await youtube.callback(new URLSearchParams({ state, code: 'code' }), start.cookie);
  const session = auth.poll(c.id, c.secret);
  assert.equal(callback.workspaceId, session.workspaceId);
  assert.equal(repository.read().channels[0].workspaceId, session.workspaceId);
  assert.match(callback.location, /oauth\/complete/);
  assert.equal(session.primaryChannelId, 'yt-channel');
});

test('connection completion is one-use and never issues another login session', async () => {
  const repository = await createRepository(),
    auth = createAuth({ repository });
  await repository.update(s => s.workspaces.push({ id: 'studio-existing', kind: 'user' }));
  const flow = auth.begin('Kick', 'link', 'connection');
  assert.deepEqual(auth.poll(flow.id, flow.secret), { status: 'pending' });
  auth.complete(flow.id, 'studio-existing');
  const result = auth.poll(flow.id, flow.secret);
  assert.deepEqual(result, { status: 'connected', workspaceId: 'studio-existing' });
  assert.equal(result.accessToken, undefined);
  assert.throws(() => auth.poll(flow.id, flow.secret));
});

test('closed beta: a new studio needs an invite code; existing studios sign in without one', async () => {
  const repository = await createRepository(),
    auth = createAuth({ repository, inviteCodes: ['Amigos-2026', 'beta'] });
  assert.equal(auth.inviteRequired, true);
  // No code: refused, and the person polling sees why.
  const denied = auth.begin('Twitch', 'a');
  await assert.rejects(auth.identify(denied.id, null, 'Twitch', ['100']), e => e.code === 'INVITE_REQUIRED');
  assert.throws(
    () => auth.poll(denied.id, denied.secret),
    e => e.code === 'INVITE_REQUIRED' && /convite/.test(e.message),
  );
  assert.equal(repository.read().workspaces.filter(w => w.kind === 'user').length, 0);
  // Wrong code: refused. Valid code (case and spaces ignored): studio created.
  const wrong = auth.begin('Twitch', 'a', 'login', null, null, 'nope');
  await assert.rejects(auth.identify(wrong.id, null, 'Twitch', ['100']), e => e.code === 'INVITE_REQUIRED');
  const invited = auth.begin('Twitch', 'a', 'login', null, null, '  amigos-2026 ');
  const w = await auth.identify(invited.id, null, 'Twitch', ['100']);
  assert.ok(w.startsWith('studio-'));
  // Next login of the same account: no code needed.
  const back = auth.begin('Twitch', 'a');
  assert.equal(await auth.identify(back.id, null, 'Twitch', ['100']), w);
  // Open sign-up when no codes are configured.
  const open = createAuth({ repository: await createRepository() });
  assert.equal(open.inviteRequired, false);
  const free = open.begin('Kick', 'b');
  assert.ok((await open.identify(free.id, null, 'Kick', ['9'])).startsWith('studio-'));
});

test('a session in use is renewed with a new token, up to 7 days after the sign-in', async () => {
  let clock = Date.parse('2026-11-18T12:00:00Z');
  const repository = await createRepository(),
    auth = createAuth({ repository, now: () => clock });
  const flow = auth.begin('Twitch', 'a');
  const w = await auth.identify(flow.id, null, 'Twitch', ['100']);
  auth.complete(flow.id, w);
  let token = auth.poll(flow.id, flow.secret).accessToken;
  clock += 11 * 3600000;
  const renewed = await auth.refresh(token);
  assert.equal(renewed.expiresIn, 12 * 3600);
  assert.equal(auth.session(token), null, 'the old token stops working');
  assert.equal(auth.session(renewed.accessToken).workspaceId, w);
  // Persisted: survives an API restart.
  const restarted = createAuth({ repository, now: () => clock });
  assert.equal(restarted.session(renewed.accessToken).workspaceId, w);
  // Renewals never pass 7 days after the sign-in.
  token = renewed.accessToken;
  for (let i = 0; i < 20; i++) {
    clock += 11 * 3600000;
    try {
      token = (await auth.refresh(token)).accessToken;
    } catch (e) {
      assert.ok(['SESSION_MAX_AGE', 'UNAUTHORIZED'].includes(e.code));
      break;
    }
  }
  assert.ok(clock - Date.parse('2026-11-18T12:00:00Z') <= 8 * 24 * 3600000);
  assert.equal(auth.session(token), null);
  await assert.rejects(auth.refresh('unknown'), e => e.code === 'UNAUTHORIZED');
});
