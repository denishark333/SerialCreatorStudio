import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuth } from '../src/auth.js';
import { createRepository } from '../src/repository.js';

async function login(auth, provider, externalId) {
  const flow = auth.begin(provider, externalId);
  const workspaceId = await auth.identify(flow.id, null, provider, [externalId]);
  auth.complete(flow.id, workspaceId);
  return auth.poll(flow.id, flow.secret);
}

test('sessions survive a restart, only token hashes are stored, logout and expiry are persisted', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'serial-sessions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'store.json');
  let time = Date.now();

  const first = await createRepository({ file });
  const auth = createAuth({ repository: first, now: () => time });
  const kept = await login(auth, 'Twitch', 'kept');
  const ended = await login(auth, 'Kick', 'ended');
  await auth.logout(ended.accessToken);

  const raw = await readFile(file, 'utf8');
  assert.ok(!raw.includes(kept.accessToken), 'raw access tokens must never be written to disk');
  assert.equal(JSON.parse(raw).authSessions.length, 1);

  const second = await createRepository({ file });
  const restarted = createAuth({ repository: second, now: () => time });
  assert.equal(restarted.session(kept.accessToken)?.workspaceId, kept.workspaceId);
  assert.equal(restarted.session(ended.accessToken), null);

  time += 12 * 3600000 + 1;
  assert.equal(restarted.session(kept.accessToken), null);
  // Expiry is persisted in the background; drain the write queue before the temp dir is removed.
  await second.update(() => {});
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).authSessions, []);
});

test('repository snapshot is read-only and reflects committed updates without copying', async () => {
  const repository = await createRepository();
  const before = repository.snapshot();
  assert.throws(() => before.channels.push({}), TypeError);
  await repository.update(s => {
    s.workspaces[0].name = 'Renomeado';
  });
  assert.equal(repository.snapshot().workspaces[0].name, 'Renomeado');
  assert.equal(repository.snapshot(), repository.snapshot());
  const copy = repository.read();
  copy.workspaces[0].name = 'Somente na cópia';
  assert.equal(repository.snapshot().workspaces[0].name, 'Renomeado');
});
