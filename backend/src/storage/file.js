import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

async function writeAtomically(file, text) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file + '.tmp', text, { mode: 0o600 });
  await rename(file + '.tmp', file);
}

/** Reads a JSON file; undefined when it does not exist. */
export async function readJsonFile(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  }
}

/** Whole state in one JSON file (development, tests and installs without DATABASE_URL). */
export function createFileStorage(filename) {
  return {
    kind: 'file',
    load: () => readJsonFile(filename),
    /** One-time copy taken before the legacy demo data is removed. */
    async backup(state) {
      try {
        await writeFile(filename + '.before-real-only.json', JSON.stringify(state, null, 2), {
          mode: 0o600,
          flag: 'wx',
        });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    },
    save: next => writeAtomically(filename, JSON.stringify(next, null, 2)),
  };
}

/**
 * Privacy deletion journal, always kept in its own file (also with PostgreSQL): restoring an older store or
 * database backup re-applies these erasures on start, so deleted personal data never comes back.
 */
export function createJournalFile(file) {
  return {
    async load() {
      const entries = await readJsonFile(file);
      if (entries !== undefined && !Array.isArray(entries)) throw new Error('Invalid deletion journal');
      return entries;
    },
    save: serialized => writeAtomically(file, serialized),
  };
}
