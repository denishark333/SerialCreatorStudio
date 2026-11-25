import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRepository } from '../src/repository.js';
import { createVault } from '../src/vault.js';
import { createStreams } from '../src/streams.js';
import { createReports } from '../src/reports.js';
import { createStudio } from '../src/studio.js';
import { createSynchronizer } from '../src/synchronizer.js';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'serial-streams-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repository = await createRepository(),
    vault = await createVault(join(dir, 'key'));
  const calls = [],
    tokenForms = [];
  let deny = false;
  const fetcher = async (url, o) => {
    const u = new URL(url);
    calls.push(u);
    let data;
    if (u.pathname.endsWith('/token')) {
      tokenForms.push(new URLSearchParams(o.body));
      data = { access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600 };
    } else if (u.pathname.endsWith('/validate')) {
      if (deny) return { ok: false, status: 401, json: async () => ({}) };
      data = { client_id: 'twitch-id', user_id: '12' };
    } else if (u.pathname === '/helix/users')
      data = {
        data: [
          { id: '12', display_name: 'Streamer', login: 'streamer', profile_image_url: 'https://example.org/a.png' },
        ],
      };
    else if (u.pathname === '/public/v1/users')
      data = { data: [{ user_id: 34, name: 'Kick Creator', profile_picture: 'https://example.org/b.png' }] };
    else if (u.pathname === '/public/v1/channels')
      data = {
        data: [
          {
            slug: 'creator',
            active_subscribers_count: 8,
            stream_title: 'Live Kick',
            stream: {
              is_live: true,
              viewer_count: 15,
              key: 'never-store-stream-key',
              start_time: '2026-11-13T12:00:00Z',
            },
          },
        ],
      };
    else if (u.pathname === '/helix/streams')
      data = { data: [{ viewer_count: 21, title: 'Live Twitch', started_at: '2026-11-13T12:00:00Z' }] };
    else if (u.pathname === '/helix/channels/followers') data = { total: 123 };
    else if (u.pathname === '/helix/subscriptions') data = { total: 7 };
    else if (u.pathname === '/helix/videos')
      data = {
        data: [
          {
            id: u.searchParams.has('after') ? 'v2' : 'v1',
            title: 'Actual VOD',
            created_at: '2026-11-12T12:00:00Z',
            duration: '1h2m3s',
            type: 'archive',
            view_count: 52,
            url: 'https://twitch.tv/videos/123',
          },
        ],
        pagination: u.searchParams.has('after') ? {} : { cursor: 'next' },
      };
    else if (u.pathname === '/helix/clips')
      data = {
        data: [
          {
            id: 'clip',
            title: 'Actual clip',
            created_at: '2026-11-12T12:00:00Z',
            duration: 30,
            view_count: 12,
            url: 'https://clips.twitch.tv/clip',
          },
        ],
      };
    else throw new Error('Unexpected ' + url);
    return { ok: true, status: 200, json: async () => data };
  };
  const configs = Object.fromEntries(
    ['Twitch', 'Kick'].map(p => [
      p,
      {
        clientId: p.toLowerCase() + '-id',
        clientSecret: 'private-secret',
        redirectUri: 'http://localhost:4000/api/v1/oauth/' + p.toLowerCase() + '/callback',
      },
    ]),
  );
  const streams = createStreams({ repository, vault, configs, fetcher });
  return {
    repository,
    vault,
    streams,
    calls,
    tokenForms,
    deny: () => {
      deny = true;
    },
  };
}
async function grant(s, p) {
  const ticket = new URL(s.authorize('studio-live', p).authorizationUrl).searchParams.get('ticket');
  const started = s.start(p, ticket);
  const params = new URL(started.url).searchParams;
  await s.callback(p, new URLSearchParams({ code: 'code', state: params.get('state') }), started.cookie.split(';')[0]);
  return { ticket, started, params };
}
test('fresh production repository has no fake content; migration preserves real records with backup', async t => {
  const s = await createRepository();
  assert.deepEqual(s.read().contents, []);
  assert.equal(s.read().workspaces[0].id, 'studio-live');
  const dir = await mkdtemp(join(tmpdir(), 'serial-migration-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'store.json'),
    old = s.read();
  old.workspaces.push({ id: 'studio-demo' });
  old.channels.push(
    { id: 'fake', workspaceId: 'studio-demo', dataSource: 'demo' },
    { id: 'real', workspaceId: 'studio-live', dataSource: 'youtube' },
  );
  old.contents.push(
    { id: 'fake-video', channelId: 'fake', workspaceId: 'studio-demo' },
    { id: 'real-video', channelId: 'real', workspaceId: 'studio-live' },
  );
  await writeFile(file, JSON.stringify(old));
  const migrated = await createRepository({ file });
  assert.deepEqual(
    migrated.read().contents.map(c => c.id),
    ['real-video'],
  );
  assert.equal(JSON.parse(await readFile(file + '.before-real-only.json', 'utf8')).contents.length, 2);
});
test('Kick uses PKCE, binds browser state, stores encrypted grants and only real supported data', async t => {
  const f = await fixture(t);
  const a = await grant(f.streams, 'Kick');
  const form = f.tokenForms[0];
  assert.equal(a.params.get('code_challenge_method'), 'S256');
  assert.equal(
    createHash('sha256').update(form.get('code_verifier')).digest('base64url'),
    a.params.get('code_challenge'),
  );
  assert.throws(() => f.streams.start('Kick', a.ticket), { code: 'INVALID_OAUTH_TICKET' });
  await assert.rejects(
    f.streams.callback('Kick', new URLSearchParams({ code: 'code', state: a.params.get('state') }), a.started.cookie),
    { code: 'INVALID_OAUTH_STATE' },
  );
  await f.streams.sync('studio-live', 'kick-34');
  const state = f.repository.read();
  assert.equal(state.channels[0].live.viewers, 15);
  assert.equal(state.channels[0].paidSubscribers, 8);
  assert.equal(state.channels[0].catalogStatus, 'unsupported');
  assert.equal(state.contents.length, 0);
  assert.ok(!JSON.stringify(state).includes('private-access'));
  assert.ok(!JSON.stringify(state).includes('never-store-stream-key'));
  assert.ok(!JSON.stringify(f.streams.status('studio-live')).includes('encryptedTokens'));
  const b = f.streams.start(
    'Kick',
    new URL(f.streams.authorize('studio-live', 'Kick').authorizationUrl).searchParams.get('ticket'),
  );
  await assert.rejects(
    f.streams.callback(
      'Kick',
      new URLSearchParams({ code: 'c', state: new URL(b.url).searchParams.get('state') }),
      'serial_kick_oauth=other',
    ),
    { code: 'INVALID_OAUTH_STATE' },
  );
});
test('Twitch refreshes tokens, validates identity, paginates VODs and upserts clips through global worker', async t => {
  const f = await fixture(t);
  await grant(f.streams, 'Twitch');
  await f.repository.update(s => {
    const c = s.connections[0],
      tokens = f.vault.open(c.encryptedTokens);
    tokens.expiresAt = 1;
    c.encryptedTokens = f.vault.seal(tokens);
  });
  const worker = createSynchronizer({
    repository: f.repository,
    streams: f.streams,
    studio: {},
    reports: {},
    youtube: {},
  });
  await worker.enqueue('studio-live', new URLSearchParams({ from: '2026-11-01', to: '2026-11-13' }));
  await worker.idle();
  assert.equal(worker.status('studio-live').latest.status, 'completed');
  let s = f.repository.read();
  assert.equal(s.contents.length, 3);
  assert.equal(s.contents.filter(c => c.format === 'VOD').length, 2);
  assert.equal(s.channels[0].followers, 123);
  assert.equal(s.channels[0].subscribers, null);
  assert.equal(s.channels[0].paidSubscribers, 7);
  assert.ok(f.tokenForms.some(v => v.get('grant_type') === 'refresh_token'));
  assert.ok(f.calls.some(v => v.pathname.endsWith('/validate')));
  await f.streams.sync('studio-live', 'twitch-12');
  assert.equal(f.repository.read().contents.length, 3);
  await f.streams.disconnect('studio-live', s.connections[0].id);
  assert.equal(f.repository.read().contents.length, 0);
  assert.equal(f.repository.read().connections.length, 0);
});
test('revoked Twitch grant is marked for reconnection and never imports fake data', async t => {
  const f = await fixture(t);
  await grant(f.streams, 'Twitch');
  f.deny();
  await assert.rejects(f.streams.sync('studio-live', 'twitch-12'), { code: 'PROVIDER_REAUTHORIZE' });
  assert.equal(f.repository.read().connections[0].status, 'reauthorization_required');
  assert.equal(f.repository.read().contents.length, 0);
});
test('full YouTube conversations paginate replies, detect owner and preserve answered status on resync', async () => {
  const repository = await createRepository();
  await repository.update(s =>
    s.channels.push({
      id: 'yt-a',
      workspaceId: 'studio-live',
      externalId: 'owner',
      platform: 'YouTube',
      dataSource: 'youtube',
    }),
  );
  const calls = [];
  let failReplies = false;
  const youtube = {
    runChannelTask: async (w, id, fn) =>
      fn({
        channel: repository.read().channels[0],
        scopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
        data: async (resource, p) => {
          calls.push({ resource, p });
          if (resource === 'commentThreads')
            return {
              items: [
                {
                  snippet: {
                    canReply: true,
                    totalReplyCount: 2,
                    topLevelComment: {
                      id: 'top',
                      snippet: {
                        videoId: 'vid',
                        authorDisplayName: 'Viewer',
                        textDisplay: 'Question?',
                        publishedAt: '2026-11-01T12:00:00Z',
                      },
                    },
                  },
                },
              ],
            };
          if (failReplies) throw new Error('temporary');
          return {
            items: [
              {
                id: p.pageToken ? 'owner-reply' : 'viewer-reply',
                snippet: {
                  textDisplay: 'Reply',
                  authorDisplayName: p.pageToken ? 'Creator' : 'Viewer',
                  authorChannelId: { value: p.pageToken ? 'owner' : 'viewer' },
                  publishedAt: '2026-11-02T12:00:00Z',
                },
              },
            ],
            ...(p.pageToken ? {} : { nextPageToken: 'next' }),
          };
        },
      }),
  };
  const reports = createReports({ repository, youtube }),
    studio = createStudio({ repository, youtube });
  await reports.syncComments('studio-live', 'yt-a');
  let row = repository.read().comments[0];
  assert.equal(row.replies.length, 2);
  assert.equal(row.replies[1].isOwner, true);
  assert.equal(studio.comments('studio-live', new URLSearchParams({ filter: 'answered' })).length, 1);
  assert.ok(
    calls.filter(c => c.resource === 'comments').every(c => c.p.parentId === 'top' && c.p.textFormat === 'plainText'),
  );
  await reports.syncComments('studio-live', 'yt-a');
  assert.equal(repository.read().comments[0].replies.length, 2);
  failReplies = true;
  await reports.syncComments('studio-live', 'yt-a');
  row = repository.read().comments[0];
  assert.equal(row.replies.length, 2);
  assert.equal(row.repliesSyncStatus, 'unavailable');
});
