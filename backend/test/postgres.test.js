import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { createRepository } from '../src/repository.js';
import { createJournalFile } from '../src/storage/file.js';
import { createPostgresStorage } from '../src/storage/postgres.js';
import { openRepository } from '../src/storage/open.js';
import { emptyState } from '../src/model.js';
import { deletionHash } from '../src/deletions.js';
import { startPostgres } from './support/postgres.js';

const server = await startPostgres().catch(error => {
  console.error('PostgreSQL de teste indisponível:', error.message);
  return null;
});

const seed = () => {
  const s = emptyState();
  s.channels.push({ id: 'c1', workspaceId: 'studio-live', name: 'Canal', platform: 'YouTube', dataSource: 'youtube' });
  s.contents.push(
    ...['a', 'b', 'c'].map((id, i) => ({ id, workspaceId: 'studio-live', channelId: 'c1', title: 'Vídeo ' + i })),
  );
  // id-less items, including two identical ones
  s.videoReports.push(
    { workspaceId: 'studio-live', videoId: 'a', views: 1 },
    { workspaceId: 'studio-live', videoId: 'a', views: 1 },
  );
  return s;
};

describe('PostgreSQL storage', { skip: !server && 'PostgreSQL de teste indisponível' }, () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'serial-pg-test-'));
  });
  after(async () => {
    await server?.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const open = async (url, options = {}) =>
    createRepository({
      storage: await createPostgresStorage({ connectionString: url }),
      journal: createJournalFile(join(dir, url.split('/').pop() + '.journal.json')),
      ...options,
    });

  test('a new database starts from `initial`, and a restart reads back exactly the same state', async () => {
    const url = await server.database();
    const first = await open(url, { initial: seed() });
    assert.equal(first.kind, 'postgres');
    await first.close();
    const second = await open(url);
    assert.deepEqual(second.read(), first.read());
    assert.deepEqual(
      second.read().videoReports.map(r => r.views),
      [1, 1],
    );
    await second.close();
  });

  test('only changed rows are written, in order, and the order survives a restart', async () => {
    const url = await server.database();
    const repo = await open(url, { initial: seed() });
    await repo.update(s => {
      s.contents.find(c => c.id === 'b').title = 'Editado';
    });
    await repo.update(s => {
      s.contents.unshift({ id: 'first', workspaceId: 'studio-live', channelId: 'c1', title: 'Novo no topo' });
      s.contents.splice(2, 0, { id: 'middle', workspaceId: 'studio-live', channelId: 'c1', title: 'No meio' });
      s.contents.push({ id: 'last', workspaceId: 'studio-live', channelId: 'c1', title: 'No fim' });
      s.contents = s.contents.filter(c => c.id !== 'c');
    });
    const order = repo.read().contents.map(c => c.id);
    assert.deepEqual(order, ['first', 'a', 'middle', 'b', 'last']);
    await repo.update(s => {
      s.contents.sort((x, y) => y.id.localeCompare(x.id)); // full reorder → renumbered
    });
    const reordered = repo.read().contents.map(c => c.id);
    await repo.close();
    const again = await open(url);
    assert.deepEqual(
      again.read().contents.map(c => c.id),
      reordered,
    );
    assert.equal(again.read().contents.find(c => c.id === 'b').title, 'Editado');
    await again.close();
  });

  test('an update touches only the rows that changed', async () => {
    const url = await server.database();
    const storage = await createPostgresStorage({ connectionString: url });
    const repo = await createRepository({ storage, initial: seed() });
    await repo.update(s => {
      s.contents[1].title = 'Só este';
    });
    assert.deepEqual(storage.lastWrite, { upserts: 1, deletes: 0 });
    await repo.update(s => {
      s.videoReports.pop();
    });
    assert.deepEqual(storage.lastWrite, { upserts: 0, deletes: 1 });
    await repo.update(() => {});
    assert.deepEqual(storage.lastWrite, { upserts: 0, deletes: 0 });
    await repo.close();
  });

  test('empty collections and non-collection values survive a restart', async () => {
    const url = await server.database();
    const repo = await open(url, { initial: emptyState() });
    await repo.update(s => {
      s.financial = [];
      s.settingsVersion = 3;
    });
    await repo.close();
    const again = await open(url);
    assert.deepEqual(again.read().plans, []);
    assert.deepEqual(again.read().financial, []);
    assert.equal(again.read().settingsVersion, 3);
    assert.equal(again.read().schemaVersion, 1);
    await again.close();
  });

  test('a failed write is rolled back and the in-memory state does not advance', async () => {
    const url = await server.database();
    const repo = await open(url, { initial: seed() });
    await assert.rejects(
      repo.update(s => {
        s.contents[0].title = 'ok';
        s.contents[1].title = 'invalid \u0000 for jsonb';
      }),
    );
    assert.equal(repo.read().contents[0].title, 'Vídeo 0');
    await repo.update(s => {
      s.contents[0].title = 'Depois da falha';
    });
    await repo.close();
    const again = await open(url);
    assert.deepEqual(
      again.read().contents.map(c => c.title),
      ['Depois da falha', 'Vídeo 1', 'Vídeo 2'],
    );
    await again.close();
  });

  test('a second API instance on the same database is refused', async () => {
    const url = await server.database();
    const first = await createPostgresStorage({ connectionString: url });
    await assert.rejects(createPostgresStorage({ connectionString: url }), /Outra instância/);
    await first.close();
    const next = await createPostgresStorage({ connectionString: url }); // lock released on close
    await next.close();
  });

  test('openRepository imports an existing store.json into an empty database once, keeping the file', async () => {
    const url = await server.database();
    const file = join(dir, 'store-import.json');
    const state = seed();
    await writeFile(file, JSON.stringify(state));
    const logs = [];
    const logger = { log: m => logs.push(m), error: m => logs.push(m) };
    const repo = await openRepository({ databaseUrl: url, dataFile: file, logger });
    assert.equal(repo.kind, 'postgres');
    assert.deepEqual(
      repo.read().contents.map(c => c.id),
      ['a', 'b', 'c'],
    );
    assert.match(logs.join('\n'), /importado/);
    await repo.update(s => {
      s.contents.pop();
    });
    await repo.close();
    assert.equal(JSON.parse(await readFile(file, 'utf8')).contents.length, 3, 'store.json is left untouched');
    // Second start: the database is used, the file is not imported again.
    const again = await openRepository({ databaseUrl: url, dataFile: file, logger });
    assert.equal(again.read().contents.length, 2);
    await again.close();
  });

  test('privacy erasures stay in the journal file and are re-applied over an older database backup', async () => {
    const url = await server.database();
    const journalFile = join(dir, 'erasure.journal.json');
    const initial = seed();
    initial.workspaces.push({ id: 'ws-erased', name: 'Outro estúdio', timezone: 'America/Sao_Paulo', kind: 'user' });
    initial.contents.push({ id: 'x1', workspaceId: 'ws-erased', channelId: 'cx', title: 'Dado pessoal' });
    const make = async () =>
      createRepository({
        storage: await createPostgresStorage({ connectionString: url }),
        journal: createJournalFile(journalFile),
        initial,
      });
    const repo = await make();
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const backup = (await client.query('select * from serial_records')).rows;
    await repo.update(s => {
      s.deletionJournal ??= [];
      s.deletionJournal.push({
        id: 'erase-1',
        workspaceHashes: [deletionHash('ws-erased')],
        deletedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      });
    });
    assert.equal(
      repo.read().contents.some(c => c.workspaceId === 'ws-erased'),
      false,
    );
    await repo.close();
    // Restore the database rows to the copy taken before the erasure.
    await client.query('delete from serial_records');
    for (const r of backup)
      await client.query(
        'insert into serial_records (collection, key, position, workspace_id, data) values ($1,$2,$3,$4,$5)',
        [r.collection, r.key, r.position, r.workspace_id, r.data],
      );
    assert.ok((await client.query("select 1 from serial_records where workspace_id = 'ws-erased'")).rowCount > 0);
    await client.end();
    const restored = await make();
    const state = restored.read();
    assert.equal(
      state.contents.some(c => c.workspaceId === 'ws-erased'),
      false,
      'erased data came back',
    );
    assert.equal(
      state.workspaces.some(w => w.id === 'ws-erased'),
      false,
    );
    assert.equal(state.contents.length, 3, 'other studios untouched');
    await restored.close();
  });
});
