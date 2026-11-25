import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepository } from '../src/repository.js';
import { createAuth } from '../src/auth.js';
import { createApp } from '../src/app.js';

test('preferred platform is private per user studio, validated and persists after repository restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'serial-preferences-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'store.json'),
    repository = await createRepository({ file }),
    auth = createAuth({ repository });
  async function user(id) {
    const flow = auth.begin('Twitch', id),
      workspaceId = await auth.identify(flow.id, null, 'Twitch', [id]);
    auth.complete(flow.id, workspaceId);
    return auth.poll(flow.id, flow.secret);
  }
  const a = await user('a'),
    b = await user('b'),
    app = createApp({ repository, auth, token: 'owner' });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.close(resolve)));
  const base = 'http://127.0.0.1:' + app.address().port;
  async function request(user, w, method = 'GET', body) {
    return fetch(base + '/api/v1/workspaces/' + w + '/preferences', {
      method,
      headers: { Authorization: 'Bearer ' + user.accessToken, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  assert.equal((await (await request(a, a.workspaceId)).json()).data.platform, null);
  assert.equal((await request(a, a.workspaceId, 'PATCH', { platform: 'YouTube' })).status, 200);
  assert.equal((await request(b, b.workspaceId, 'PATCH', { platform: 'Twitch' })).status, 200);
  assert.equal((await request(a, b.workspaceId, 'PATCH', { platform: 'Kick' })).status, 403);
  assert.equal((await request(a, b.workspaceId)).status, 403);
  assert.equal((await request(a, a.workspaceId, 'PATCH', { platform: 'Other' })).status, 400);
  assert.equal(
    (await request(a, a.workspaceId, 'PATCH', { platform: 'Kick', workspaceId: b.workspaceId })).status,
    400,
  );
  assert.equal((await (await request(a, a.workspaceId)).json()).data.platform, 'YouTube');
  assert.equal((await (await request(b, b.workspaceId)).json()).data.platform, 'Twitch');
  const restored = await createRepository({ file });
  assert.equal(restored.read().workspaces.find(w => w.id === a.workspaceId).preferences.platform, 'YouTube');
  assert.equal(restored.read().workspaces.find(w => w.id === b.workspaceId).preferences.platform, 'Twitch');
});
