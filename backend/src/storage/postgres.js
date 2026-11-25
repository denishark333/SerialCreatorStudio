import { createHash } from 'node:crypto';
import pg from 'pg';

/**
 * PostgreSQL storage for the repository.
 *
 * Each item of each state collection is one row of `serial_records` (JSONB), ordered by `position`; values that
 * are not collections (e.g. schemaVersion) live in `serial_meta`. Every repository update is diffed against what
 * is already stored and only the changed rows are written, in one transaction: either the whole update is saved
 * or nothing is (and the in-memory state does not advance).
 *
 * The API keeps the state in memory and is the only writer: a session advisory lock refuses a second instance
 * on the same database.
 */
const SCHEMA = `
create table if not exists serial_meta (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists serial_records (
  collection text not null,
  key text not null,
  position double precision not null,
  workspace_id text,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, key)
);
create index if not exists serial_records_workspace on serial_records (workspace_id);
`;
const COLLECTIONS = '__collections';
const LOCK = "hashtext('serial-dashboard')";

const UPSERT = `
insert into serial_records (collection, key, position, workspace_id, data)
select collection, key, position, workspace_id, data
from jsonb_to_recordset($1::jsonb) as r(collection text, key text, position double precision, workspace_id text, data jsonb)
on conflict (collection, key) do update
set position = excluded.position, workspace_id = excluded.workspace_id, data = excluded.data, updated_at = now()`;
const DELETE = `
delete from serial_records s
using jsonb_to_recordset($1::jsonb) as r(collection text, key text)
where s.collection = r.collection and s.key = r.key`;
const UPSERT_META = `
insert into serial_meta (key, value)
select key, value from jsonb_to_recordset($1::jsonb) as r(key text, value jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now()`;

/** JSON with sorted object keys: JSONB does not keep key order, so comparisons and hashes must ignore it. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value)
    .filter(k => value[k] !== undefined && typeof value[k] !== 'function')
    .sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

/** Stable row key per item: its id, or a content hash for id-less items (duplicates get a #n suffix). */
function rowsOf(items) {
  const seen = new Map();
  return items.map(item => {
    const json = canonicalJson(item);
    const id = item && typeof item === 'object' ? item.id : undefined;
    const base =
      typeof id === 'string' || typeof id === 'number'
        ? 'id:' + id
        : 'h:' + createHash('sha256').update(json).digest('base64url').slice(0, 32);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const workspaceId = item && typeof item.workspaceId === 'string' ? item.workspaceId : null;
    return { key: n ? base + '#' + n : base, json, workspaceId };
  });
}

/**
 * Positions that keep the array order while touching as few rows as possible: stored items keep their position,
 * new ones go between their neighbours. Reordered collections are renumbered.
 */
function positionsOf(rows, stored) {
  const next = new Array(rows.length);
  let following = Infinity;
  for (let i = rows.length - 1; i >= 0; i--) {
    next[i] = following;
    const known = stored.get(rows[i].key);
    if (known) following = known.position;
  }
  const positions = [];
  let previous = -Infinity;
  for (let i = 0; i < rows.length; i++) {
    const known = stored.get(rows[i].key);
    let position;
    if (known) position = known.position;
    else if (previous === -Infinity) position = next[i] === Infinity ? 0 : next[i] - 1;
    else position = next[i] === Infinity ? previous + 1 : (previous + next[i]) / 2;
    if (!(position > previous) || !(position < next[i]) || !Number.isFinite(position))
      return rows.map((_, index) => index);
    positions.push(position);
    previous = position;
  }
  return positions;
}

const recordsJson = rows => '[' + rows.join(',') + ']';

export async function createPostgresStorage({
  connectionString,
  onFatal = error => console.error(error),
  logger = console,
}) {
  const pool = new pg.Pool({ connectionString, max: 4, application_name: 'serial-dashboard' });
  pool.on('error', error => logger.error('PostgreSQL (idle connection):', error.message));
  let lock;
  try {
    lock = await pool.connect();
    const { rows } = await lock.query(`select pg_try_advisory_lock(${LOCK}) as locked`);
    if (!rows[0].locked) throw new Error('Outra instância da API já está usando este banco PostgreSQL.');
    // Losing this connection releases the lock: stop instead of risking two writers.
    lock.on('error', error => onFatal(new Error('Conexão de bloqueio do PostgreSQL perdida: ' + error.message)));
    await lock.query(SCHEMA);
  } catch (error) {
    lock?.release(true);
    await pool.end();
    throw error;
  }

  /** What is in the database: collection → (row key → { json, position }); meta key → json. */
  let stored = new Map(),
    storedMeta = new Map();

  async function load() {
    const meta = await pool.query('select key, value from serial_meta');
    if (!meta.rows.length) return undefined;
    const state = {};
    storedMeta = new Map();
    for (const { key, value } of meta.rows) {
      if (key === COLLECTIONS) continue;
      state[key] = value;
      storedMeta.set(key, canonicalJson(value));
    }
    const names = meta.rows.find(r => r.key === COLLECTIONS)?.value ?? [];
    storedMeta.set(COLLECTIONS, canonicalJson(names));
    stored = new Map(names.map(name => [name, new Map()]));
    for (const name of names) state[name] = [];
    const records = await pool.query(
      'select collection, key, position, data from serial_records order by collection, position',
    );
    for (const { collection, key, position, data } of records.rows) {
      if (!stored.has(collection)) continue; // orphan rows of a removed collection
      state[collection].push(data);
      stored.get(collection).set(key, { json: canonicalJson(data), position });
    }
    return state;
  }

  async function save(next) {
    const upserts = [],
      deletes = [],
      metaUpserts = [],
      metaDeletes = [];
    const nextStored = new Map(),
      nextMeta = new Map();
    const names = Object.keys(next)
      .filter(k => Array.isArray(next[k]))
      .sort();
    for (const name of names) {
      const previous = stored.get(name) ?? new Map();
      const rows = rowsOf(next[name]);
      const positions = positionsOf(rows, previous);
      const current = new Map();
      rows.forEach((row, i) => {
        const position = positions[i];
        current.set(row.key, { json: row.json, position });
        const known = previous.get(row.key);
        if (!known || known.json !== row.json || known.position !== position)
          upserts.push(
            `{"collection":${JSON.stringify(name)},"key":${JSON.stringify(row.key)},"position":${position},"workspace_id":${JSON.stringify(row.workspaceId)},"data":${row.json}}`,
          );
      });
      for (const key of previous.keys()) if (!current.has(key)) deletes.push(JSON.stringify({ collection: name, key }));
      nextStored.set(name, current);
    }
    const removedCollections = [...stored.keys()].filter(name => !nextStored.has(name));
    for (const key of Object.keys(next)) {
      if (Array.isArray(next[key]) || next[key] === undefined) continue;
      nextMeta.set(key, canonicalJson(next[key]));
    }
    nextMeta.set(COLLECTIONS, canonicalJson(names));
    for (const [key, json] of nextMeta)
      if (storedMeta.get(key) !== json) metaUpserts.push(`{"key":${JSON.stringify(key)},"value":${json}}`);
    for (const key of storedMeta.keys()) if (!nextMeta.has(key)) metaDeletes.push(key);

    const changed =
      upserts.length + deletes.length + metaUpserts.length + metaDeletes.length + removedCollections.length;
    if (changed) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        if (upserts.length) await client.query(UPSERT, [recordsJson(upserts)]);
        if (deletes.length) await client.query(DELETE, [recordsJson(deletes)]);
        if (removedCollections.length)
          await client.query('delete from serial_records where collection = any($1)', [removedCollections]);
        if (metaUpserts.length) await client.query(UPSERT_META, [recordsJson(metaUpserts)]);
        if (metaDeletes.length) await client.query('delete from serial_meta where key = any($1)', [metaDeletes]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
    stored = nextStored;
    storedMeta = nextMeta;
    storage.lastWrite = { upserts: upserts.length, deletes: deletes.length + removedCollections.length };
  }

  const storage = {
    kind: 'postgres',
    lastWrite: null,
    load,
    save,
    async close() {
      lock.removeAllListeners('error');
      await lock.query(`select pg_advisory_unlock(${LOCK})`).catch(() => {});
      lock.release();
      await pool.end();
    },
  };
  return storage;
}
