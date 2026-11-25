import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../src/repository.js';
import { createAuth } from '../src/auth.js';
import { createPrivacy } from '../src/privacy.js';
import { createRevoker } from '../src/revocations.js';
import { pruneImportedData } from '../src/retention.js';
import { createApp } from '../src/app.js';
import { LEGAL_VERSION } from '../src/legal.js';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const DAY = 86400000;
test('disconnecting the last connection removes the now-inaccessible personal workspace too', async () => {
  const x = await setup();
  const privacy = createPrivacy({ ...x, revoke: async () => {} });
  await privacy.erase(x.a.workspaceId, 'grant-a');
  await privacy.work();
  assert.equal(
    x.repository.read().workspaces.some(w => w.id === x.a.workspaceId),
    false,
  );
  assert.ok(x.repository.read().workspaces.some(w => w.id === x.b.workspaceId));
});
test('restoring an old store does not requeue a revocation already confirmed in the independent journal', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'serial-revoked-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'store.json'),
    repository = await createRepository({ file });
  await repository.update(s => {
    s.workspaces.push({ id: 'private-user', kind: 'user' });
    s.connections.push({
      id: 'grant',
      workspaceId: 'private-user',
      platform: 'YouTube',
      channelIds: [],
      encryptedTokens: 'sealed',
    });
  });
  let succeed = false;
  const privacy = createPrivacy({
    repository,
    revoke: async () => {
      if (!succeed) throw Error('offline');
    },
  });
  await privacy.erase('private-user');
  await privacy.work();
  const backup = await readFile(file, 'utf8');
  succeed = true;
  await repository.update(s => {
    s.pendingRevocations[0].nextAttemptAt = 0;
  });
  await privacy.work();
  assert.equal(repository.read().pendingRevocations.length, 0);
  await writeFile(file, backup);
  const restored = await createRepository({ file });
  assert.equal(restored.read().pendingRevocations.length, 0);
  assert.equal((await readFile(file + '.privacy-journal.json', 'utf8')).includes('sealed'), false);
});
test('independent deletion journal prevents restoring deleted studio data from an older store backup', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'serial-erasure-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'store.json'),
    repository = await createRepository({ file });
  await repository.update(s => {
    s.workspaces.push({ id: 'private-user', kind: 'user' });
    s.plans.push({ workspaceId: 'private-user', title: 'Private plan' });
  });
  const backup = await readFile(file, 'utf8');
  const privacy = createPrivacy({ repository });
  await privacy.erase('private-user');
  await writeFile(file, backup);
  const restored = await createRepository({ file });
  assert.equal(
    restored.read().workspaces.some(v => v.id === 'private-user'),
    false,
  );
  assert.equal(restored.read().plans.length, 0);
  const journal = await readFile(file + '.privacy-journal.json', 'utf8');
  assert.equal(journal.includes('private-user'), false);
  assert.equal(journal.includes('Private plan'), false);
});
async function setup() {
  const repository = await createRepository();
  let time = Date.now();
  const auth = createAuth({ repository, now: () => time });
  async function user(externalId) {
    const flow = auth.begin('YouTube', externalId),
      w = await auth.identify(flow.id, null, 'YouTube', [externalId]);
    auth.complete(flow.id, w);
    return auth.poll(flow.id, flow.secret);
  }
  const a = await user('A'),
    b = await user('B');
  await repository.update(s => {
    s.channels.push(
      { id: 'a-channel', workspaceId: a.workspaceId, externalId: 'A', platform: 'YouTube', connectionId: 'grant-a' },
      { id: 'b-channel', workspaceId: b.workspaceId, externalId: 'B', platform: 'YouTube', connectionId: 'grant-b' },
    );
    s.connections.push(
      {
        id: 'grant-a',
        workspaceId: a.workspaceId,
        platform: 'YouTube',
        channelIds: ['a-channel'],
        encryptedTokens: 'encrypted-a',
      },
      {
        id: 'grant-b',
        workspaceId: b.workspaceId,
        platform: 'YouTube',
        channelIds: ['b-channel'],
        encryptedTokens: 'encrypted-b',
      },
    );
    for (const key of [
      'contents',
      'comments',
      'reports',
      'videoReports',
      'playlists',
      'financial',
      'plans',
      'membershipSnapshots',
      'legalConsents',
    ]) {
      s[key] ??= [];
      s[key].push(
        { id: key + '-a', workspaceId: a.workspaceId, channelId: 'a-channel' },
        { id: key + '-b', workspaceId: b.workspaceId, channelId: 'b-channel' },
      );
    }
  });
  return { repository, auth, a, b, user, advance: ms => (time += ms), now: () => time };
}
test('erase removes all studio collections and merged aliases, invalidates every session, preserves another user', async () => {
  const x = await setup(),
    second = await x.user('A'),
    old = x.auth.begin('YouTube', 'old-flow');
  await x.repository.update(s => {
    s.workspaces.push({ id: 'alias', mergedInto: x.a.workspaceId, kind: 'merged' });
    s.plans.push({ workspaceId: 'alias', title: 'Merged plan' });
    s.workspaceMerges = [{ source: 'alias', target: x.a.workspaceId }];
  });
  const privacy = createPrivacy({
    ...x,
    revoke: async () => {
      throw Error('provider down');
    },
  });
  assert.equal(privacy.preview(x.a.workspaceId).mergedStudios, 1);
  const result = await privacy.erase(x.a.workspaceId);
  await privacy.work();
  assert.equal(result.deleted, true);
  const state = x.repository.read();
  assert.equal(
    state.workspaces.some(w => ['alias', x.a.workspaceId].includes(w.id)),
    false,
  );
  for (const [key, rows] of Object.entries(state))
    if (Array.isArray(rows))
      assert.equal(
        rows.some(row => row.workspaceId === x.a.workspaceId || row.workspaceId === 'alias'),
        false,
        key,
      );
  assert.equal(state.connections[0].workspaceId, x.b.workspaceId);
  assert.equal(x.auth.session(x.a.accessToken), null);
  assert.equal(x.auth.session(second.accessToken), null);
  assert.ok(x.auth.session(x.b.accessToken));
  assert.equal(state.pendingRevocations[0].encryptedTokens, 'encrypted-a');
  assert.equal(JSON.stringify(state.pendingRevocations).includes('a-channel'), false);
  await assert.rejects(x.auth.identify(old.id, null, 'YouTube', ['A']), { code: 'LOGIN_EXPIRED' });
  x.advance(1);
  const newUser = await x.user('A');
  assert.notEqual(newUser.workspaceId, x.a.workspaceId);
});
test('deletion is blocked while a request, sync or provider operation is active', async () => {
  const x = await setup(),
    privacy = createPrivacy({ ...x });
  const leave = privacy.enter(x.a.workspaceId);
  await assert.rejects(privacy.erase(x.a.workspaceId), { code: 'WORKSPACE_BUSY' });
  leave();
  await x.repository.update(s => s.syncJobs.push({ workspaceId: x.a.workspaceId, status: 'running' }));
  await assert.rejects(privacy.erase(x.a.workspaceId), { code: 'WORKSPACE_BUSY' });
  assert.ok(x.repository.read().connections.find(v => v.id === 'grant-a'));
});
test('disconnect removes channel data, plans, financial entries and identity without deleting other studio channels', async () => {
  const x = await setup();
  await x.repository.update(s => {
    s.channels.push({ id: 'keep', workspaceId: x.a.workspaceId, externalId: 'KEEP', platform: 'Kick' });
    s.plans.push({ workspaceId: x.a.workspaceId, channelId: 'keep', id: 'keep-plan' });
  });
  const privacy = createPrivacy({ ...x, revoke: async () => {} });
  await privacy.erase(x.a.workspaceId, 'grant-a');
  await privacy.work();
  const state = x.repository.read();
  assert.ok(state.workspaces.find(v => v.id === x.a.workspaceId));
  assert.ok(state.plans.find(v => v.id === 'keep-plan'));
  assert.equal(
    state.financial.some(v => v.channelId === 'a-channel'),
    false,
  );
  assert.equal(
    state.identities.some(v => v.externalId === 'A'),
    false,
  );
  assert.equal(state.pendingRevocations.length, 0);
});
test('revocation retry survives worker recreation and drops expired credentials', async () => {
  const x = await setup();
  let attempts = 0;
  const privacy = createPrivacy({
    ...x,
    revoke: async () => {
      attempts++;
      throw Error('token-not-to-log');
    },
  });
  await privacy.erase(x.a.workspaceId);
  await privacy.work();
  assert.equal(attempts, 1);
  assert.equal(x.repository.read().pendingRevocations.length, 1);
  x.advance(7 * DAY);
  await createPrivacy({
    ...x,
    revoke: async () => {
      throw Error('must not send expired credentials');
    },
  }).work();
  assert.equal(x.repository.read().pendingRevocations.length, 0);
});
test('Google revocation uses encrypted refresh token in POST body and treats already revoked token correctly', async () => {
  let called = 0;
  const revoke = createRevoker({
    vault: { open: () => ({ access_token: 'access', refresh_token: 'private-refresh' }) },
    fetcher: async (url, options) => {
      called++;
      assert.equal(String(url), 'https://oauth2.googleapis.com/revoke');
      assert.equal(options.method, 'POST');
      assert.equal(options.body.get('token'), 'private-refresh');
      return { ok: false, status: 400, json: async () => ({ error: 'invalid_token' }) };
    },
  });
  await revoke({ platform: 'YouTube', encryptedTokens: 'sealed' });
  assert.equal(called, 1);
});
test('retention removes old imports but preserves refreshed data and user-created plans/finances', async () => {
  const repository = await createRepository(),
    now = Date.now(),
    old = new Date(now - 31 * DAY).toISOString(),
    fresh = new Date(now).toISOString();
  await repository.update(s => {
    s.contents = [
      { id: 'old', lastSyncedAt: old },
      { id: 'fresh', lastSyncedAt: fresh },
    ];
    s.videoReports = [{ fetchedAt: old }];
    s.comments = [{ lastSyncedAt: old }];
    s.plans = [{ date: '2020-01-01' }];
    s.financial = [{ date: '2020-01-01', source: 'manual' }];
  });
  await pruneImportedData(repository, now);
  assert.deepEqual(
    repository.read().contents.map(v => v.id),
    ['fresh'],
  );
  assert.equal(repository.read().videoReports.length, 0);
  assert.equal(repository.read().plans.length, 1);
  assert.equal(repository.read().financial.length, 1);
});
test('privacy HTTP routes enforce studio ownership, personal session and typed confirmation; legal routes remain public', async t => {
  const x = await setup(),
    server = createApp({ ...x, token: 'owner', revoke: async () => {} });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(token, w, confirmation) {
    return fetch(base + '/api/v1/workspaces/' + w + '/privacy', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation }),
    });
  }
  assert.equal((await request(x.b.accessToken, x.a.workspaceId, 'EXCLUIR')).status, 403);
  assert.equal((await request('owner', x.a.workspaceId, 'EXCLUIR')).status, 403);
  assert.equal((await request(x.a.accessToken, x.a.workspaceId, 'NO')).status, 400);
  assert.equal((await request(x.a.accessToken, x.a.workspaceId, 'EXCLUIR')).status, 200);
  assert.equal(
    (await fetch(base + '/api/v1/workspaces', { headers: { Authorization: 'Bearer ' + x.a.accessToken } })).status,
    401,
  );
  const page = await fetch(base + '/api/v1/legal/privacy');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /contato.serialhealer@gmail.com/);
  assert.ok(page.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));
});
test('production login requires the current policy versions before creating OAuth flow', async t => {
  const repository = await createRepository(),
    auth = createAuth({ repository }),
    server = createApp({
      repository,
      auth,
      requireConsent: true,
      youtube: { authorize: () => ({ authorizationUrl: 'https://accounts.google.com/' }) },
    });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const url = 'http://127.0.0.1:' + server.address().port + '/api/v1/auth/login/google';
  const post = value =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ privacyVersion: LEGAL_VERSION, termsVersion: LEGAL_VERSION })).status, 200);
});
