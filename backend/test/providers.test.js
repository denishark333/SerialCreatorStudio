import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepository } from '../src/repository.js';
import { createVault } from '../src/vault.js';
import { createStreams } from '../src/streams.js';
import { createYouTube, LIVE_WORKSPACE } from '../src/youtube.js';
import { clientAddress } from '../src/http/request.js';

const W = LIVE_WORKSPACE;
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const html = status => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => JSON.parse('<html>Bad gateway</html>'),
});

async function seeded(t, platform, tokens) {
  const dir = await mkdtemp(join(tmpdir(), 'serial-providers-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repository = await createRepository();
  const vault = await createVault(join(dir, 'key'));
  const slug = platform.toLowerCase();
  await repository.update(s => {
    s.channels.push({
      id: `${slug}-1`,
      workspaceId: W,
      platform,
      name: 'Canal',
      externalId: '12',
      connectionId: 'grant-1',
      uploadsPlaylistId: 'UU-1',
      dataSource: slug,
    });
    s.connections.push({
      id: 'grant-1',
      workspaceId: W,
      platform,
      status: 'connected',
      channelIds: [`${slug}-1`],
      scopes: [],
      encryptedTokens: vault.seal(tokens),
    });
  });
  return { repository, vault };
}

function streamsWith(repository, vault, fetcher) {
  const configs = { Twitch: { clientId: 'twitch-id', clientSecret: 'secret' } };
  return createStreams({ repository, vault, configs, fetcher });
}

test('Twitch: a refused refresh token marks the connection for reauthorization instead of a generic error', async t => {
  const { repository, vault } = await seeded(t, 'Twitch', { access_token: 'old', refresh_token: 'dead', expiresAt: 0 });
  const streams = streamsWith(repository, vault, async url =>
    new URL(url).pathname.endsWith('/token')
      ? json(400, { status: 400, message: 'Invalid refresh token' })
      : json(200, {}),
  );
  await assert.rejects(streams.sync(W, 'twitch-1'), error => error.code === 'PROVIDER_REAUTHORIZE');
  assert.equal(repository.read().connections[0].status, 'reauthorization_required');
});

test('Twitch: a temporary token endpoint outage is not mistaken for a revoked authorization', async t => {
  const { repository, vault } = await seeded(t, 'Twitch', { access_token: 'old', refresh_token: 'ok', expiresAt: 0 });
  const streams = streamsWith(repository, vault, async () => json(503, {}));
  await assert.rejects(streams.sync(W, 'twitch-1'), error => error.code === 'PROVIDER_API_ERROR');
  assert.equal(repository.read().connections[0].status, 'connected');
});

test('Twitch: HTML bodies (proxy/CDN errors) become clear provider errors, never a SyntaxError', async t => {
  const valid = { access_token: 'ok', refresh_token: 'ok', expiresAt: Date.now() + 3600000 };
  for (const [response, code] of [
    [html(502), 'PROVIDER_API_ERROR'],
    [html(200), 'PROVIDER_INVALID_RESPONSE'],
  ]) {
    const { repository, vault } = await seeded(t, 'Twitch', valid);
    const streams = streamsWith(repository, vault, async url =>
      new URL(url).pathname.endsWith('/validate') ? json(200, { client_id: 'twitch-id', user_id: '12' }) : response,
    );
    await assert.rejects(streams.sync(W, 'twitch-1'), error => error.code === code);
  }
});

test('YouTube: HTML bodies become clear provider errors, never a SyntaxError', async t => {
  for (const [response, code] of [
    [html(503), 'YOUTUBE_API_ERROR'],
    [html(200), 'YOUTUBE_INVALID_RESPONSE'],
  ]) {
    const { repository, vault } = await seeded(t, 'YouTube', { access_token: 'a', refresh_token: 'r' });
    const youtube = createYouTube({
      repository,
      vault,
      clientId: 'id',
      clientSecret: 'secret',
      fetcher: async () => response,
      oauthFactory: () => ({ setCredentials() {}, getAccessToken: async () => ({ token: 't' }), credentials: {} }),
    });
    await assert.rejects(
      youtube.runChannelTask(W, 'youtube-1', provider => provider.data('channels', { part: 'id' })),
      error => error.code === code,
    );
  }
});

test('client address: X-Real-IP is honored only with trustProxy and only from loopback', () => {
  const req = (remoteAddress, realIp) => ({
    socket: { remoteAddress },
    headers: realIp ? { 'x-real-ip': realIp } : {},
  });
  assert.equal(clientAddress(req('127.0.0.1', '203.0.113.9')), '127.0.0.1');
  assert.equal(clientAddress(req('127.0.0.1', '203.0.113.9'), true), '203.0.113.9');
  assert.equal(clientAddress(req('::ffff:127.0.0.1', '2001:db8::1'), true), '2001:db8::1');
  assert.equal(clientAddress(req('198.51.100.7', '203.0.113.9'), true), '198.51.100.7', 'direct clients cannot spoof');
  assert.equal(clientAddress(req('127.0.0.1', '<script>'), true), '127.0.0.1', 'malformed header is ignored');
  assert.equal(clientAddress(req('127.0.0.1'), true), '127.0.0.1');
});

test('client address: behind Cloudflare Tunnel, CF-Connecting-IP is used only when Nginx saw loopback', () => {
  const req = (remoteAddress, headers) => ({ socket: { remoteAddress }, headers });
  const tunnel = cf => req('127.0.0.1', { 'x-real-ip': '127.0.0.1', 'cf-connecting-ip': cf });
  assert.equal(clientAddress(tunnel('203.0.113.9'), true), '203.0.113.9');
  assert.equal(clientAddress(tunnel('2001:db8::1'), true), '2001:db8::1');
  assert.notEqual(
    clientAddress(tunnel('203.0.113.9'), true),
    clientAddress(tunnel('198.51.100.20'), true),
    'two visitors through the tunnel get separate rate-limit keys',
  );
  assert.equal(clientAddress(tunnel('<script>'), true), '127.0.0.1', 'malformed CF header is ignored');
  assert.equal(clientAddress(req('127.0.0.1', { 'x-real-ip': '::1' }), true), '::1', 'no CF header: loopback');
  assert.equal(
    clientAddress(req('127.0.0.1', { 'x-real-ip': '198.51.100.7', 'cf-connecting-ip': '203.0.113.9' }), true),
    '198.51.100.7',
    'direct visitors cannot choose CF-Connecting-IP',
  );
  assert.equal(clientAddress(tunnel('203.0.113.9')), '127.0.0.1', 'ignored without trustProxy');
});
