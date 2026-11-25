import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../src/repository.js';
import { createYouTube } from '../src/youtube.js';
import { parallel } from '../src/async.js';

test('YouTube shares credential refresh, limits network concurrency and protects mutations during reads', async () => {
  const repository = await createRepository();
  await repository.update(s => {
    s.channels.push({
      id: 'yt-test',
      workspaceId: 'studio-live',
      connectionId: 'grant',
      externalId: 'test',
      dataSource: 'youtube',
    });
    s.connections.push({
      id: 'grant',
      workspaceId: 'studio-live',
      channelIds: ['yt-test'],
      scopes: [],
      encryptedTokens: { access_token: 'old' },
    });
  });
  let release;
  const gate = new Promise(r => (release = r));
  let refreshes = 0,
    active = 0,
    maximum = 0,
    calls = 0;
  const youtube = createYouTube({
    repository,
    vault: { seal: v => v, open: v => v },
    clientId: 'id',
    clientSecret: 'secret',
    oauthFactory: () => ({
      setCredentials(v) {
        this.credentials = v;
      },
      on() {},
      async getAccessToken() {
        refreshes++;
        await new Promise(setImmediate);
        return { token: 'access' };
      },
    }),
    fetcher: async () => {
      calls++;
      maximum = Math.max(maximum, ++active);
      await gate;
      active--;
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    },
  });
  const tasks = Array.from({ length: 10 }, () =>
    youtube.runChannelTask('studio-live', 'yt-test', p => p.data('channels', {}), { readOnly: true }),
  );
  for (let i = 0; i < 100 && calls < 6; i++) await new Promise(setImmediate);
  assert.equal(calls, 6);
  assert.equal(maximum, 6);
  assert.equal(refreshes, 1);
  await assert.rejects(
    youtube.runChannelTask('studio-live', 'yt-test', async () => {}),
    e => e.code === 'SYNC_IN_PROGRESS',
  );
  await assert.rejects(youtube.disconnect('studio-live', 'grant'), e => e.code === 'SYNC_IN_PROGRESS');
  release();
  await Promise.all(tasks);
  assert.equal(calls, 10);
  assert.equal(maximum, 6);
  await youtube.runChannelTask('studio-live', 'yt-test', async () => {});
});

test('parallel worker failure drains active operations before rejecting', async () => {
  let release;
  const gate = new Promise(r => (release = r)),
    calls = [];
  const result = parallel([0, 1, 2], 2, async n => {
    calls.push(n);
    if (n === 0) throw new Error('failed');
    await gate;
    calls.push('drained');
  });
  let settled = false;
  const checked = assert.rejects(result, /failed/).then(() => (settled = true));
  await new Promise(setImmediate);
  assert.equal(settled, false);
  assert.deepEqual(calls, [0, 1]);
  release();
  await checked;
  assert.deepEqual(calls, [0, 1, 'drained']);
});
