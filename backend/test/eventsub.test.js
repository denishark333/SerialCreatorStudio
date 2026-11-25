import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../src/repository.js';
import { createEventSub } from '../src/eventsub.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => (resolve = done));
  return { promise, resolve };
};

async function fixture(t) {
  let fail = false;
  const repository = await createRepository({
    storage: {
      load: async () => undefined,
      save: async () => {
        if (fail) throw new Error('Temporary storage outage');
      },
    },
  });
  await repository.update(s => {
    s.channels.push({
      id: 'channel',
      workspaceId: 'studio-live',
      platform: 'Twitch',
      externalId: '123',
      connectionId: 'grant',
    });
    s.connections.push({
      id: 'grant',
      platform: 'Twitch',
      status: 'connected',
      encryptedTokens: 'fixture',
      scopes: [],
    });
  });
  let socket;
  class Socket {
    constructor() {
      socket = this;
    }
    close() {}
  }
  const errors = [];
  const eventsub = createEventSub({
    repository,
    streams: { configured: () => true },
    WebSocketImpl: Socket,
    logger: { error: error => errors.push(error) },
    eventFlushMs: 3600000,
    flushMs: 3600000,
    reconcileMs: 3600000,
  });
  eventsub.start();
  t.after(() => eventsub.stop());
  const notify = id =>
    socket.onmessage({
      data: JSON.stringify({
        metadata: { message_type: 'notification', message_id: id },
        payload: { subscription: { type: 'channel.cheer' }, event: { bits: 25 } },
      }),
    });
  return { repository, eventsub, notify, errors, fail: value => (fail = value) };
}

test('EventSub retries repeated storage failures and deduplicates queued and persisted IDs', async t => {
  const f = await fixture(t);
  f.notify('a');
  f.notify('a');
  f.fail(true);
  await f.eventsub.flush();
  await f.eventsub.flush();
  assert.equal((f.repository.snapshot().streamEvents ?? []).length, 0);
  assert.equal(f.errors.length, 2);
  assert.equal(f.errors[1].pendingCount, 1);
  f.notify('b');
  f.fail(false);
  await f.eventsub.flush();
  f.notify('a');
  f.notify('b');
  await f.eventsub.flush();
  assert.deepEqual(
    f.repository.snapshot().streamEvents.map(e => e.id),
    ['evt-a', 'evt-b'],
  );
});

test('EventSub serializes overlapping flushes and retains arrivals during a failed write', async t => {
  const f = await fixture(t),
    entered = deferred(),
    release = deferred();
  const update = f.repository.update;
  let attempts = 0;
  f.repository.update = async fn => {
    attempts++;
    entered.resolve();
    await release.promise;
    throw new Error('Temporary storage outage');
  };
  f.notify('a');
  const first = f.eventsub.flush();
  await entered.promise;
  f.notify('b');
  f.notify('a');
  const second = f.eventsub.flush();
  assert.equal(attempts, 1);
  release.resolve();
  await Promise.all([first, second]);
  f.repository.update = update;
  await f.eventsub.flush();
  assert.deepEqual(
    f.repository.snapshot().streamEvents.map(e => e.id),
    ['evt-a', 'evt-b'],
  );
});

test('EventSub retry does not resurrect events after a channel is deleted or transferred', async t => {
  for (const remove of [true, false]) {
    const f = await fixture(t);
    f.notify('a');
    f.fail(true);
    await f.eventsub.flush();
    f.fail(false);
    await f.repository.update(s => {
      if (remove) s.channels = [];
      else s.channels[0].workspaceId = 'different-studio';
    });
    await f.eventsub.flush();
    assert.equal((f.repository.snapshot().streamEvents ?? []).length, 0);
  }
});

test('EventSub shutdown waits for the active write and drains events received meanwhile', async t => {
  const f = await fixture(t),
    entered = deferred(),
    release = deferred();
  const update = f.repository.update;
  let attempts = 0;
  f.repository.update = async fn => {
    if (++attempts === 1) {
      entered.resolve();
      await release.promise;
    }
    return update(fn);
  };
  f.notify('a');
  const writing = f.eventsub.flush();
  await entered.promise;
  f.notify('b');
  const stopping = f.eventsub.stop();
  release.resolve();
  await Promise.all([writing, stopping]);
  assert.deepEqual(
    f.repository.snapshot().streamEvents.map(e => e.id),
    ['evt-a', 'evt-b'],
  );
});
