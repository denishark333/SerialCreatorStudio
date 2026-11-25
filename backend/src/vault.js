import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
/**
 * AES-256-GCM vault for provider tokens. The key file is created on first start.
 * `allowCreate: false` refuses to create a new key: used when the store already holds sealed tokens, so a wrong
 * TOKEN_KEY_FILE path fails loudly instead of silently making every saved connection unreadable.
 */
export async function createVault(file, { allowCreate = true } = {}) {
  let key;
  try {
    key = await readFile(file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (!allowCreate)
      throw new Error(
        `Chave de tokens não encontrada em ${file}. O banco já tem conexões criptografadas: aponte TOKEN_KEY_FILE para a chave existente (uma chave nova tornaria essas conexões ilegíveis).`,
      );
    await mkdir(dirname(file), { recursive: true });
    const generated = randomBytes(32);
    try {
      await writeFile(file, generated, { mode: 0o600, flag: 'wx' });
      key = generated;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      key = await readFile(file);
    }
  }
  if (key.length !== 32) throw new Error('Invalid token encryption key');
  return {
    seal(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([
        iv,
        cipher.update(JSON.stringify(value), 'utf8'),
        cipher.final(),
        cipher.getAuthTag(),
      ]).toString('base64');
    },
    open(value) {
      const b = Buffer.from(value, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
      decipher.setAuthTag(b.subarray(-16));
      return JSON.parse(Buffer.concat([decipher.update(b.subarray(12, -16)), decipher.final()]).toString('utf8'));
    },
  };
}
