import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../src/auth.js';
import { createRepository } from '../src/repository.js';
import { createYouTube, REQUIRED_YOUTUBE_SCOPES } from '../src/youtube.js';

async function fixture() {
  const repository = await createRepository(),
    auth = createAuth({ repository });
  async function user(provider, id) {
    const c = auth.begin(provider, id),
      w = await auth.identify(c.id, null, provider, [id]);
    auth.complete(c.id, w);
    return auth.poll(c.id, c.secret);
  }
  const source = await user('YouTube', 'youtube-owner'),
    target = await user('Twitch', 'twitch-owner');
  await repository.update(s => {
    s.channels.push({
      id: 'yt-youtube-owner',
      workspaceId: source.workspaceId,
      platform: 'YouTube',
      externalId: 'youtube-owner',
      connectionId: 'source-grant',
      name: 'YouTube Owner',
      dataSource: 'youtube',
    });
    s.connections.push({
      id: 'source-grant',
      workspaceId: source.workspaceId,
      platform: 'YouTube',
      channelIds: ['yt-youtube-owner'],
      encryptedTokens: { refresh_token: 'old' },
    });
    s.channels.push({
      id: 'twitch-target',
      workspaceId: target.workspaceId,
      platform: 'Twitch',
      externalId: 'twitch-owner',
      connectionId: 'target-grant',
      name: 'Twitch Owner',
      dataSource: 'twitch',
    });
    for (const key of ['contents', 'comments', 'plans', 'playlists', 'financial', 'reports', 'videoReports', 'metrics'])
      s[key].push({
        id: key + '-record',
        workspaceId: source.workspaceId,
        channelId: 'yt-youtube-owner',
        value: 'preserve',
      });
  });
  const youtube = createYouTube({
    repository,
    auth,
    clientId: 'id',
    clientSecret: 'secret',
    vault: { open: v => v, seal: v => v },
    redirectUri: 'https://example.org/api/v1/oauth/google/callback',
    fetcher: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{ id: 'youtube-owner', snippet: { title: 'YouTube Owner' }, contentDetails: {}, statistics: {} }],
      }),
    }),
    oauthFactory: () => ({
      generateAuthUrl: params => 'https://google.example/?' + new URLSearchParams({ state: params.state }),
      getToken: async () => ({
        tokens: { access_token: 'access', refresh_token: 'fresh', scope: REQUIRED_YOUTUBE_SCOPES.join(' ') },
      }),
    }),
  });
  async function link() {
    const flow = auth.begin('YouTube', 'connection', 'connection', target.workspaceId),
      ticket = new URL(youtube.authorize(target.workspaceId, null, flow.id).authorizationUrl).searchParams.get(
        'ticket',
      ),
      start = await youtube.start(ticket),
      state = new URL(start.url).searchParams.get('state');
    const callback = await youtube.callback(new URLSearchParams({ state, code: 'code' }), start.cookie);
    return { flow, callback };
  }
  return { repository, auth, source, target, link };
}

test('fresh OAuth offers a merge review; confirmation preserves all data and unifies future logins', async () => {
  const { repository, auth, source, target, link } = await fixture();
  const { flow, callback } = await link();
  assert.equal(callback.mergePending, true);
  const review = auth.poll(flow.id, flow.secret);
  assert.equal(review.status, 'merge_required');
  assert.deepEqual(review.sourceChannels, [{ name: 'YouTube Owner', platform: 'YouTube' }]);
  assert.equal(review.counts.contents, 1);
  assert.equal(repository.read().channels.find(c => c.id === 'yt-youtube-owner').workspaceId, source.workspaceId);
  assert.equal(repository.read().connections.find(c => c.id === 'source-grant').encryptedTokens.refresh_token, 'fresh');
  await assert.rejects(auth.merge(source.workspaceId, flow.id, flow.secret, true), e => e.code === 'INVALID_MERGE');
  await assert.rejects(auth.merge(target.workspaceId, flow.id, 'wrong', true), e => e.code === 'INVALID_MERGE');
  await repository.update(s => s.syncJobs.push({ id: 'running', workspaceId: source.workspaceId, status: 'running' }));
  await assert.rejects(auth.merge(target.workspaceId, flow.id, flow.secret, true), e => e.code === 'MERGE_SYNC_BUSY');
  assert.equal(auth.poll(flow.id, flow.secret).status, 'merge_required');
  await repository.update(s => {
    s.syncJobs[0].status = 'completed';
    s.syncJobs.push({ id: 'queued', workspaceId: source.workspaceId, status: 'queued' });
  });
  await auth.merge(target.workspaceId, flow.id, flow.secret, true);
  const state = repository.read();
  for (const key of [
    'channels',
    'connections',
    'contents',
    'comments',
    'plans',
    'playlists',
    'financial',
    'reports',
    'videoReports',
    'metrics',
    'identities',
  ])
    assert.ok(
      state[key].every(v => v.workspaceId !== source.workspaceId),
      key,
    );
  assert.equal(state.connections.length, 1);
  assert.equal(state.connections[0].encryptedTokens.refresh_token, 'fresh');
  assert.equal(state.syncJobs.find(j => j.id === 'queued').status, 'cancelled');
  assert.equal(state.workspaces.find(w => w.id === source.workspaceId).mergedInto, target.workspaceId);
  assert.equal(auth.session(source.accessToken), null);
  assert.equal(auth.session(target.accessToken).workspaceId, target.workspaceId);
  const next = auth.begin('YouTube', 'login');
  assert.equal(await auth.identify(next.id, null, 'YouTube', ['youtube-owner']), target.workspaceId);
  const reconnect = await link();
  assert.equal(reconnect.callback.mergePending, false);
  assert.equal(auth.poll(reconnect.flow.id, reconnect.flow.secret).status, 'connected');
  assert.equal(repository.read().connections.length, 1);
  assert.equal(repository.read().workspaceMerges.length, 1);
});

test('cancelling a proven merge leaves studios, data and sessions separate', async () => {
  const { repository, auth, source, target, link } = await fixture(),
    { flow } = await link();
  assert.deepEqual(await auth.merge(target.workspaceId, flow.id, flow.secret, false), { status: 'cancelled' });
  assert.equal(repository.read().channels.find(c => c.id === 'yt-youtube-owner').workspaceId, source.workspaceId);
  assert.ok(auth.session(source.accessToken));
  assert.ok(auth.session(target.accessToken));
  assert.throws(() => auth.poll(flow.id, flow.secret));
});

test('a challenge without fresh provider proof or bound to another destination cannot merge studios', async () => {
  const { auth, source, target } = await fixture();
  const missing = auth.begin('YouTube', 'missing', 'connection', target.workspaceId);
  await assert.rejects(
    auth.merge(target.workspaceId, missing.id, missing.secret, true),
    e => e.code === 'INVALID_MERGE',
  );
  await assert.rejects(
    auth.identify(null, target.workspaceId, 'YouTube', ['youtube-owner']),
    e => e.code === 'ACCOUNT_ALREADY_LINKED',
  );
  const wrong = auth.begin('YouTube', 'wrong', 'connection', source.workspaceId);
  await assert.rejects(
    auth.identify(null, target.workspaceId, 'YouTube', ['youtube-owner'], wrong.id),
    e => e.code === 'ACCOUNT_ALREADY_LINKED',
  );
});
