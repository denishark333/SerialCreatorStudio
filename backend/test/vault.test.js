import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVault } from '../src/vault.js';

test('vault: creates the key on first start and reopens sealed values with it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'serial-vault-'));
  try {
    const file = join(dir, 'keys', 'token.key');
    const sealed = (await createVault(file)).seal({ access: 'a' });
    assert.deepEqual((await createVault(file, { allowCreate: false })).open(sealed), { access: 'a' });
    assert.equal((await stat(file)).size, 32);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('vault: never creates a new key when sealed tokens already exist (wrong TOKEN_KEY_FILE)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'serial-vault-'));
  try {
    const file = join(dir, 'moved', 'token.key');
    await assert.rejects(createVault(file, { allowCreate: false }), /TOKEN_KEY_FILE/);
    await assert.rejects(stat(file), { code: 'ENOENT' }); // nothing was generated
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
