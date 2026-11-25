import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createApp } from '../src/app.js';
import { createRepository } from '../src/repository.js';
import { oauthReturn } from '../src/oauth-return.js';
test('production rejects missing owner token even on loopback behind nginx', () => {
  const r = spawnSync(process.execPath, ['src/server.js'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '4000', API_TOKEN: '' },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /API_TOKEN/);
});
test('desktop OAuth completion stays on backend; protected routes still require bearer', async t => {
  assert.equal(oauthReturn('desktop', 'kick', 'connected'), '/api/v1/oauth/complete?provider=kick&status=connected');
  assert.equal(
    oauthReturn('http://localhost:5173', 'youtube', 'connected'),
    'http://localhost:5173/#/settings?youtube=connected',
  );
  const server = createApp({ repository: await createRepository(), token: 'test-owner' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const done = await fetch(base + '/api/v1/oauth/complete?provider=<script>');
  assert.equal(done.status, 200);
  assert.match(done.headers.get('content-type'), /text\/html/);
  const html = await done.text();
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /window.close/);
  assert.match(html, /backdrop-filter/);
  const nonce = done.headers.get('content-security-policy').match(/script-src 'nonce-([^']+)'/)[1];
  assert.ok(html.includes('script nonce="' + nonce + '"'));
  assert.ok(html.includes('style nonce="' + nonce + '"'));
  assert.equal((await fetch(base + '/api/v1/workspaces')).status, 401);
  assert.equal(
    (await fetch(base + '/api/v1/workspaces', { headers: { Authorization: 'Bearer test-owner' } })).status,
    200,
  );
});
