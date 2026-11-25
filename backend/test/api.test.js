import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { testRepository as createRepository } from './fixtures/repository.js';
async function fixture(t, options = {}) {
  const repository = await createRepository(options);
  const server = createApp({ repository, token: 'test-owner-token', logger: { error: () => {} } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(
    () =>
      new Promise(r => {
        server.close(r);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', body, headers = {}) =>
    fetch(base + path, {
      method,
      headers: {
        Authorization: 'Bearer test-owner-token',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { repository, request, base };
}
const root = '/api/v1/workspaces/studio-demo';
test('owner auth, CORS and explicit integration status', async t => {
  const { request, base } = await fixture(t);
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + root + '/channels')).status, 401);
  assert.equal(
    (await request(root + '/channels', 'GET', undefined, { Origin: 'https://untrusted.example' })).status,
    403,
  );
  assert.equal(
    (await request(root + '/channels', 'OPTIONS', undefined, { Origin: 'http://localhost:5173' })).status,
    204,
  );
  const r = await request(root + '/connections/YouTube/authorize', 'POST');
  assert.equal(r.status, 501);
  assert.equal((await r.json()).error.code, 'CONNECTOR_NOT_IMPLEMENTED');
});
test('multiple channels, filtering, paging and workspace isolation', async t => {
  const { request } = await fixture(t);
  let payload = await (await request(root + '/channels?platform=YouTube')).json();
  assert.equal(payload.data.length, 2);
  payload = await (await request(root + '/contents?platform=YouTube&limit=1&page=2')).json();
  assert.equal(payload.data.length, 1);
  assert.equal(payload.pagination.total, 3);
  payload = await (await request(root + '/contents?channelId=youtube-cuts')).json();
  assert.equal(payload.data.length, 1);
  assert.equal((await request('/api/v1/workspaces/other/contents')).status, 404);
  assert.equal((await request(root + '/contents?channelId=foreign')).status, 404);
  assert.equal((await request(root + '/contents?platform=invalid')).status, 400);
  assert.equal((await request(root + '/contents?limit=0')).status, 400);
});
test('dated analytics, zero filling and missing financial values', async t => {
  const { request } = await fixture(t);
  const a = await (await request(root + '/analytics?from=2026-11-09&to=2026-11-11&channelId=youtube-cuts')).json();
  assert.equal(a.data.timeseries.length, 3);
  assert.equal(a.data.summary.views, 126500);
  assert.equal(a.data.summary.watchTimeMinutes, 177100);
  assert.equal(a.data.byPlatform.length, 1);
  const empty = await (await request(root + '/analytics?from=2026-01-01&to=2026-01-02')).json();
  assert.equal(empty.data.summary.views, 0);
  assert.equal(empty.data.summary.engagementRate, null);
  assert.equal((await request(root + '/analytics?from=2026-02-30')).status, 400);
  assert.equal((await request(root + '/analytics?from=2026-11-12&to=2026-11-01')).status, 400);
  const r = await (await request(root + '/revenue')).json();
  assert.equal(r.data.status, 'not_connected');
  assert.deepEqual(r.data.totals, []);
});
test('planning CRUD validates and survives repository restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'serial-api-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'store.json');
  const { request } = await fixture(t, { file });
  assert.equal(
    (
      await request(root + '/plans', 'POST', {
        title: 'Bad',
        channelId: 'foreign',
        format: 'Vídeo',
        date: '2026-11-20',
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(root + '/plans', 'POST', {
        title: 'Bad',
        channelId: 'youtube-main',
        format: 'Vídeo',
        date: '2026-11-20',
        workspaceId: 'other',
      })
    ).status,
    400,
  );
  const response = await request(root + '/plans', 'POST', {
    title: 'Novo conteúdo',
    channelId: 'youtube-cuts',
    format: 'Short',
    date: '2026-11-20',
  });
  assert.equal(response.status, 201);
  const { data: plan } = await response.json();
  assert.equal(plan.platform, 'YouTube');
  assert.equal(plan.stage, 'Ideia');
  assert.equal((await request(root + '/plans/' + plan.id, 'PATCH', { stage: 'Pronto' })).status, 200);
  const reopened = await createRepository({ file });
  assert.equal(reopened.read().plans.find(p => p.id === plan.id).stage, 'Pronto');
  const listed = await (await request(root + '/plans?from=2026-11-01&to=2026-11-30&channelId=youtube-cuts')).json();
  assert.ok(listed.data.some(p => p.id === plan.id));
  assert.equal((await request(root + '/plans/' + plan.id, 'DELETE')).status, 204);
  assert.equal((await request(root + '/plans/' + plan.id, 'PATCH', { stage: 'Ideia' })).status, 404);
});
test('a live can go to several channels at once (multistream); other formats stay on one', async t => {
  const { request, repository } = await fixture(t);
  const base = { title: 'Live de sábado', date: '2026-11-21', time: '20:00' };
  const created = await request(root + '/plans', 'POST', {
    ...base,
    format: 'Live',
    channelIds: ['twitch-main', 'youtube-main', 'kick-main'],
  });
  assert.equal(created.status, 201);
  const { data: live } = await created.json();
  assert.equal(live.channelId, 'twitch-main', 'the first channel is the primary one');
  assert.deepEqual(live.platforms, ['Twitch', 'YouTube', 'Kick']);
  // Listed when any of its channels is selected.
  const listed = await (await request(root + '/plans?from=2026-11-01&to=2026-11-30&channelId=kick-main')).json();
  assert.ok(listed.data.some(p => p.id === live.id));
  for (const body of [
    { ...base, format: 'Vídeo', channelIds: ['youtube-main', 'kick-main'] },
    { ...base, format: 'Live', channelIds: [] },
    { ...base, format: 'Live', channelIds: ['youtube-main', 'youtube-main'] },
    { ...base, format: 'Live', channelId: 'kick-main', channelIds: ['youtube-main'] },
  ])
    assert.equal((await request(root + '/plans', 'POST', body)).status, 400, JSON.stringify(body));
  assert.equal(
    (await request(root + '/plans', 'POST', { ...base, format: 'Live', channelIds: ['youtube-main', 'nope'] })).status,
    404,
  );
  // Turning it into a video keeps only the primary channel.
  const video = await (await request(root + '/plans/' + live.id, 'PATCH', { format: 'Vídeo' })).json();
  assert.deepEqual(video.data.channelIds, ['twitch-main']);
  assert.deepEqual(video.data.platforms, ['Twitch']);
  // Plans created before multistream (only channelId) still read as one channel.
  const old = repository.read().plans.find(p => !p.channelIds);
  if (old) {
    const all = await (await request(root + '/plans?from=2026-01-01&to=2026-12-31')).json();
    assert.deepEqual(all.data.find(p => p.id === old.id).channelIds, [old.channelId]);
  }
});
test('disconnecting a platform keeps the other channels of a multistream plan', async () => {
  const { detachPlanChannels } = await import('../src/model.js');
  const state = {
    channels: [
      { id: 'tw', platform: 'Twitch' },
      { id: 'yt', platform: 'YouTube' },
    ],
    plans: [
      { id: 'multi', workspaceId: 'w', channelId: 'tw', channelIds: ['tw', 'yt'], platform: 'Twitch' },
      { id: 'solo', workspaceId: 'w', channelId: 'tw', platform: 'Twitch' },
      { id: 'other', workspaceId: 'x', channelId: 'tw', platform: 'Twitch' },
    ],
  };
  detachPlanChannels(state, 'w', new Set(['tw']));
  assert.deepEqual(
    state.plans.map(p => [p.id, p.channelId, p.platform]),
    [
      ['multi', 'yt', 'YouTube'],
      ['other', 'tw', 'Twitch'],
    ],
  );
  assert.deepEqual(state.plans[0].platforms, ['YouTube']);
});
test('each format has its own production stages (a live is not recorded or edited)', async t => {
  const { request } = await fixture(t);
  const base = { title: 'Live de sexta', channelId: 'youtube-cuts', date: '2026-11-20' };
  assert.equal((await request(root + '/plans', 'POST', { ...base, format: 'Live', stage: 'Edição' })).status, 400);
  assert.equal((await request(root + '/plans', 'POST', { ...base, format: 'Clip', stage: 'Gravação' })).status, 400);
  const { data: video } = await (
    await request(root + '/plans', 'POST', { ...base, format: 'Vídeo', stage: 'Edição' })
  ).json();
  // Turning the video into a live moves it back to the nearest stage a live has.
  const live = await (await request(root + '/plans/' + video.id, 'PATCH', { format: 'Live' })).json();
  assert.equal(live.data.stage, 'Roteiro');
  const ready = await request(root + '/plans/' + video.id, 'PATCH', { stage: 'Pronto' });
  assert.equal(ready.status, 200);
  assert.equal((await request(root + '/plans/' + video.id, 'PATCH', { stage: 'Gravação' })).status, 400);
  assert.equal((await request(root + '/plans/' + video.id, 'PATCH', { stage: 'Publicado' })).status, 200);
});
test('plan details: schedule time, notes, brand deal and published video', async t => {
  const { request, repository } = await fixture(t);
  const video = repository.read().contents.find(c => c.channelId === 'youtube-cuts');
  await repository.update(s => {
    s.financial = [
      ...(s.financial ?? []),
      {
        id: 'deal-1',
        workspaceId: 'studio-demo',
        channelId: 'youtube-cuts',
        type: 'deal',
        title: 'Marca X',
        amountCents: 240000,
        currency: 'BRL',
        date: '2026-11-01',
        stage: 'Confirmado',
      },
    ];
  });
  const created = await request(root + '/plans', 'POST', {
    title: video.title.toUpperCase(),
    channelId: 'youtube-cuts',
    format: 'Short',
    date: '2026-11-20',
    stage: 'Gravação',
    time: '18:00',
    notes: '  Gravar de manhã  ',
    dealId: 'deal-1',
  });
  assert.equal(created.status, 201);
  const { data: plan } = await created.json();
  assert.equal(plan.time, '18:00');
  assert.equal(plan.notes, 'Gravar de manhã');
  assert.deepEqual(plan.deal, {
    id: 'deal-1',
    title: 'Marca X',
    amountCents: 240000,
    currency: 'BRL',
    stage: 'Confirmado',
  });
  assert.equal(plan.content, null, 'only ready/published plans are matched to a video');
  for (const body of [{ time: '24:00' }, { time: '7:00' }, { notes: 'x'.repeat(2001) }, { stage: 'Gravando' }])
    assert.equal((await request(root + '/plans/' + plan.id, 'PATCH', body)).status, 400, JSON.stringify(body));
  assert.equal((await request(root + '/plans/' + plan.id, 'PATCH', { dealId: 'nope' })).status, 404);
  const foreign = repository.read().contents.find(c => c.channelId !== 'youtube-cuts');
  assert.equal((await request(root + '/plans/' + plan.id, 'PATCH', { contentId: foreign.id })).status, 404);

  // Plans created before the video was published are matched by title (case/accents ignored) once published.
  await repository.update(s => {
    s.plans.find(p => p.id === plan.id).createdAt = '2026-01-01T00:00:00Z';
  });
  const published = await (await request(root + '/plans/' + plan.id, 'PATCH', { stage: 'Publicado' })).json();
  assert.equal(published.data.content.id, video.id);
  assert.equal(published.data.content.linked, 'auto');
  // An explicit link wins, can be cleared, and is dropped when the plan moves to another channel.
  const linked = await (await request(root + '/plans/' + plan.id, 'PATCH', { contentId: video.id, time: null })).json();
  assert.equal(linked.data.content.linked, 'manual');
  assert.equal(linked.data.time, null);
  const moved = await (await request(root + '/plans/' + plan.id, 'PATCH', { channelId: 'youtube-main' })).json();
  assert.equal(moved.data.contentId, null);
  const listed = await (await request(root + '/plans?from=2026-11-01&to=2026-11-30')).json();
  assert.equal(listed.data.find(p => p.id === plan.id).deal.title, 'Marca X');
});
test('concurrent writes preserve plans and local-only replies', async t => {
  const { request, repository } = await fixture(t);
  const before = repository.read().plans.length;
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      request(root + '/plans', 'POST', {
        title: 'Plano ' + i,
        channelId: 'kick-main',
        format: 'Live',
        date: '2026-11-25',
      }),
    ),
  );
  assert.equal(repository.read().plans.length, before + 8);
  const reply = await (await request(root + '/community/comments/1/replies', 'POST', { text: 'Obrigado!' })).json();
  assert.equal(reply.data.delivery, 'local_only');
  assert.equal((await request(root + '/community/comments/1', 'PATCH', { hearted: 'true' })).status, 400);
});
test('OpenAPI is published and malformed JSON is rejected', async t => {
  const { request, base } = await fixture(t);
  const spec = await (await request('/api/v1/openapi.json')).json();
  assert.equal(spec.openapi, '3.0.3');
  assert.ok(spec.paths[root.replace('studio-demo', '{workspaceId}') + '/contents']);
  const response = await fetch(base + root + '/plans', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-owner-token', 'Content-Type': 'application/json' },
    body: '{broken',
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_JSON');
});
