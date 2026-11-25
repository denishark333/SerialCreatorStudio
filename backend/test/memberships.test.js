import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../src/repository.js';
import { createMemberships, membershipFor, MEMBERS_SCOPE } from '../src/memberships.js';
import { createStudio } from '../src/studio.js';
async function setup(scope = true) {
  const repository = await createRepository();
  await repository.update(s => {
    s.workspaces.push({ id: 'a' }, { id: 'b' });
    s.channels.push(
      { id: 'a-channel', externalId: 'UC-A', workspaceId: 'a', platform: 'YouTube', connectionId: 'a-grant' },
      { id: 'b-channel', externalId: 'UC-B', workspaceId: 'b', platform: 'YouTube', connectionId: 'b-grant' },
    );
    s.connections.push({ id: 'a-grant', workspaceId: 'a', scopes: scope ? [MEMBERS_SCOPE] : [] });
    s.comments.push(
      {
        id: 'comment',
        workspaceId: 'a',
        channelId: 'a-channel',
        author: 'Shared name',
        authorChannelId: 'member-1',
        text: 'Hello',
        publishedAt: '2026-11-15',
      },
      {
        id: 'impostor',
        workspaceId: 'a',
        channelId: 'a-channel',
        author: 'Shared name',
        authorChannelId: 'different-id',
        text: 'Hi',
        publishedAt: '2026-11-15',
      },
    );
  });
  return repository;
}
const member = id => ({
  snippet: {
    creatorChannelId: 'UC-A',
    memberDetails: { channelId: id, displayName: 'Shared name' },
    membershipsDetails: {
      highestAccessibleLevel: 'gold',
      highestAccessibleLevelDisplayName: 'Gold',
      membershipsDuration: { memberSince: '2026-01-01T00:00:00Z', memberTotalDurationMonths: 10 },
    },
  },
});
test('complete membership snapshot joins comment authors by channel ID, not display name', async () => {
  const repository = await setup();
  let requests = 0;
  const youtube = {
    runChannelTask: async (w, id, fn) =>
      fn({
        data: async (resource, p) => {
          requests++;
          if (resource === 'membershipsLevels')
            return { items: [{ id: 'gold', snippet: { levelDetails: { displayName: 'Gold' } } }] };
          return p.pageToken
            ? { items: [member('member-2')] }
            : { items: [member('member-1')], nextPageToken: 'second' };
        },
      }),
  };
  const memberships = createMemberships({ repository, youtube });
  await memberships.sync('a', 'a-channel');
  const result = memberships.list('a', new URLSearchParams({ channelId: 'a-channel' }));
  assert.equal(requests, 3);
  assert.equal(result.total, 2);
  assert.equal(result.levels[0].count, 2);
  assert.equal(result.revenue.amount, null);
  const studio = createStudio({ repository, youtube });
  const comments = studio.comments('a', new URLSearchParams({ channelId: 'a-channel', filter: 'members' }));
  assert.deepEqual(
    comments.map(v => v.id),
    ['comment'],
  );
  assert.equal(membershipFor(repository.read(), 'a', 'a-channel', 'different-id').status, 'not_member');
  assert.equal(membershipFor(repository.read(), 'b', 'b-channel', 'member-1').status, 'unknown');
  assert.throws(() => memberships.list('b', new URLSearchParams({ channelId: 'a-channel' })), { status: 404 });
});
test('missing scope makes no provider requests and never reports zero members as a known total', async () => {
  const repository = await setup(false);
  const memberships = createMemberships({
    repository,
    youtube: {
      runChannelTask() {
        throw Error('must not request');
      },
    },
  });
  await memberships.sync('a', 'a-channel');
  const result = memberships.list('a', new URLSearchParams());
  assert.equal(result.total, null);
  assert.equal(result.coverage[0].status, 'permission_required');
  assert.equal(membershipFor(repository.read(), 'a', 'a-channel', 'member-1').status, 'unknown');
});
test('failed pagination preserves previous snapshot but marks membership unknown', async () => {
  const repository = await setup();
  await repository.update(s =>
    s.membershipSnapshots.push({
      workspaceId: 'a',
      channelId: 'a-channel',
      status: 'available',
      items: [{ externalId: 'old' }],
      levels: [],
    }),
  );
  const memberships = createMemberships({
    repository,
    youtube: {
      runChannelTask: async (w, id, fn) =>
        fn({ data: async () => ({ items: [member('member-1')], nextPageToken: 'repeating' }) }),
    },
  });
  await memberships.sync('a', 'a-channel');
  const snapshot = repository.read().membershipSnapshots[0];
  assert.equal(snapshot.status, 'unavailable');
  assert.equal(snapshot.items[0].externalId, 'old');
  assert.equal(memberships.list('a', new URLSearchParams()).total, null);
  assert.equal(membershipFor(repository.read(), 'a', 'a-channel', 'old').status, 'unknown');
});
test('a successful empty snapshot removes departed members and confirms zero', async () => {
  const repository = await setup();
  await repository.update(s =>
    s.membershipSnapshots.push({
      workspaceId: 'a',
      channelId: 'a-channel',
      status: 'available',
      items: [{ externalId: 'old' }],
      levels: [],
    }),
  );
  const memberships = createMemberships({
    repository,
    youtube: { runChannelTask: async (w, id, fn) => fn({ data: async () => ({ items: [] }) }) },
  });
  await memberships.sync('a', 'a-channel');
  assert.equal(memberships.list('a', new URLSearchParams()).total, 0);
  assert.equal(membershipFor(repository.read(), 'a', 'a-channel', 'old').status, 'not_member');
});
test('manual financial history includes future forecasts while default metric range remains limited', async () => {
  const repository = await setup();
  await repository.update(s =>
    s.financial.push(
      { id: 'old', workspaceId: 'a', channelId: 'a-channel', type: 'payout', date: '2025-01-01' },
      { id: 'future', workspaceId: 'a', channelId: 'a-channel', type: 'payout', date: '2027-01-01' },
      { id: 'other', workspaceId: 'b', channelId: 'b-channel', type: 'payout', date: '2027-01-01' },
    ),
  );
  const studio = createStudio({ repository, youtube: {} });
  assert.equal(
    studio.financial('a', new URLSearchParams({ from: '2026-01-01', to: '2026-01-03' }), 'payout').length,
    0,
  );
  assert.deepEqual(
    studio.financial('a', new URLSearchParams({ history: 'all', channelId: 'a-channel' }), 'payout').map(v => v.id),
    ['future', 'old'],
  );
});
