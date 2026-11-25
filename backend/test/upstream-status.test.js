import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

// Cloudflare replaces 502/504 responses from the origin with its own page (without CORS headers): the dashboard
// would only show "Backend indisponível" and hide the platform's reason. Platform failures use 424 instead.
test('the API never answers 502 or 504 (Cloudflare would hide the error message)', async () => {
  const dir = new URL('../src/', import.meta.url);
  const offenders = [];
  for (const name of await readdir(dir, { recursive: true })) {
    if (!name.endsWith('.js')) continue;
    const source = await readFile(new URL(name.split(/[\\/]/).join('/'), dir), 'utf8');
    for (const match of source.matchAll(/fail\(\s*(50[24])\b|\?\s*401\s*:\s*(50[24])\b|respond\.json\(\s*(50[24])\b/g))
      offenders.push(`${name}: ${match[0]}`);
  }
  assert.deepEqual(offenders, []);
});
