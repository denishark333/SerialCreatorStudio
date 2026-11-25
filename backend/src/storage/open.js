import { resolve } from 'node:path';
import { createRepository } from '../repository.js';
import { createJournalFile, readJsonFile } from './file.js';
import { createPostgresStorage } from './postgres.js';

/**
 * Opens the repository the API runs on.
 * - `databaseUrl` (DATABASE_URL): PostgreSQL. On the first start with an empty database, an existing `dataFile`
 *   (the previous store.json) is imported once; the file itself is left untouched as a backup.
 * - otherwise: the JSON `dataFile`.
 * The privacy deletion journal is always a file: `journalFile`, default `<dataFile>.privacy-journal.json`
 * (the same file the JSON storage already uses, so switching to PostgreSQL keeps every recorded erasure).
 */
export async function openRepository({ databaseUrl, dataFile, journalFile, onFatal, logger = console }) {
  const file = resolve(dataFile);
  if (!databaseUrl) return createRepository({ file });
  const storage = await createPostgresStorage({ connectionString: databaseUrl, onFatal, logger });
  try {
    const load = storage.load;
    storage.load = async () => {
      const state = await load();
      if (state) return state;
      const legacy = await readJsonFile(file);
      if (legacy) logger.log(`PostgreSQL vazio: dados importados de ${file} (o arquivo foi mantido como backup).`);
      return legacy;
    };
    return await createRepository({
      storage,
      journal: createJournalFile(resolve(journalFile ?? file + '.privacy-journal.json')),
    });
  } catch (error) {
    await storage.close().catch(() => {});
    throw error;
  }
}
