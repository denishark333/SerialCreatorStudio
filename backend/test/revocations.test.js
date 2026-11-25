import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVault } from '../src/vault.js';
import { createRevoker } from '../src/revocations.js';

async function setup(t, respond = () => ({ ok: true, status: 200, json: async () => ({}) }), options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'serial-revoke-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const vault = await createVault(join(dir, 'key'));
  const calls = [];
  const fetcher = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, form: new URLSearchParams(init.body) });
    return respond(u);
  };
  const revoke = createRevoker({ vault, fetcher, ...options });
  const job = (platform, tokens) => ({ platform, encryptedTokens: vault.seal(tokens) });
  return { revoke, job, calls };
}
const reply = (status, body) => () => ({ ok: status < 300, status, json: async () => body });

test('YouTube revokes the refresh token (falling back to the access token)', async t => {
  const s = await setup(t);
  await s.revoke(s.job('YouTube', { refresh_token: 'r1', access_token: 'a1' }));
  await s.revoke(s.job('YouTube', { access_token: 'a2' }));
  assert.equal(s.calls[0].url.href, 'https://oauth2.googleapis.com/revoke');
  assert.deepEqual(
    s.calls.map(c => c.form.get('token')),
    ['r1', 'a2'],
  );
});

test('an already invalid token counts as revoked; other failures are retried by the caller', async t => {
  const invalid = await setup(t, reply(400, { error: 'invalid_token' }));
  await invalid.revoke(invalid.job('YouTube', { refresh_token: 'r' }));

  const outage = await setup(t, reply(500, {}));
  await assert.rejects(outage.revoke(outage.job('YouTube', { refresh_token: 'r' })), /REVOCATION_FAILED/);

  const htmlError = await setup(t, () => ({ ok: false, status: 502, json: async () => JSON.parse('<html>') }));
  await assert.rejects(htmlError.revoke(htmlError.job('YouTube', { refresh_token: 'r' })), /REVOCATION_FAILED/);
});

test('Twitch requires the client id and revokes the access token', async t => {
  const missing = await setup(t);
  await assert.rejects(missing.revoke(missing.job('Twitch', { access_token: 'a' })), /REVOCATION_NOT_CONFIGURED/);

  const s = await setup(t, undefined, { twitchClientId: 'twitch-id' });
  await s.revoke(s.job('Twitch', { access_token: 'a', refresh_token: 'r' }));
  assert.equal(s.calls[0].url.href, 'https://id.twitch.tv/oauth2/revoke');
  assert.equal(s.calls[0].form.get('client_id'), 'twitch-id');
  assert.equal(s.calls[0].form.get('token'), 'a');

  const gone = await setup(t, reply(400, { message: 'Invalid token' }), { twitchClientId: 'twitch-id' });
  await gone.revoke(gone.job('Twitch', { access_token: 'a' }));
});

test('Kick revokes both tokens with the matching type hint', async t => {
  const s = await setup(t);
  await s.revoke(s.job('Kick', { refresh_token: 'r', access_token: 'a' }));
  assert.deepEqual(
    s.calls.map(c => [c.url.searchParams.get('token'), c.url.searchParams.get('token_hint_type')]),
    [
      ['r', 'refresh_token'],
      ['a', 'access_token'],
    ],
  );
});

test('jobs without tokens are no-ops and unknown providers fail loudly', async t => {
  const s = await setup(t, undefined, { twitchClientId: 'twitch-id' });
  await s.revoke(s.job('YouTube', {}));
  await s.revoke(s.job('Twitch', {}));
  await s.revoke(s.job('Kick', {}));
  assert.equal(s.calls.length, 0);
  await assert.rejects(s.revoke(s.job('Other', { access_token: 'a' })), /UNKNOWN_PROVIDER/);
});
