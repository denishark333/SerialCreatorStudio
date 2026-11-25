import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';

const run = promisify(execFile);
/** pg_ctl start leaves the server running with inherited handles: wait for pg_ctl's exit, not for its output. */
const detached = (file, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(file + ' exited with ' + code))));
  });

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });

/**
 * A real, throwaway PostgreSQL server for tests.
 * - PG_TEST_URL: use that server (a database URL with permission to create databases).
 * - otherwise: the binaries of the `embedded-postgres` dev dependency, started through pg_ctl (on Windows it drops
 *   administrator rights, which postgres itself refuses to run with).
 * Returns null when neither is available (production install without dev dependencies): tests are skipped.
 */
export async function startPostgres() {
  if (process.env.PG_TEST_URL) return external(process.env.PG_TEST_URL);
  let binaries;
  try {
    const os = process.platform === 'win32' ? 'windows' : process.platform;
    binaries = await import(`@embedded-postgres/${os}-${process.arch}`);
  } catch {
    return null;
  }
  const dir = await mkdtemp(join(tmpdir(), 'serial-pg-'));
  const data = join(dir, 'data');
  const port = await freePort();
  await run(binaries.initdb, ['-D', data, '-U', 'serial', '--auth=trust', '-E', 'UTF8', '--locale=C']);
  await detached(binaries.pg_ctl, [
    'start',
    '-w',
    '-D',
    data,
    '-l',
    join(dir, 'server.log'),
    '-o',
    `-p ${port} -h 127.0.0.1`,
  ]);
  const base = `postgres://serial@127.0.0.1:${port}`;
  const server = await external(base + '/postgres');
  return {
    ...server,
    async stop() {
      await server.stop().catch(() => {});
      await run(binaries.pg_ctl, ['stop', '-w', '-m', 'fast', '-D', data]).catch(() => {});
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

async function external(adminUrl) {
  let count = 0;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  return {
    /** A new empty database; returns its connection URL. */
    async database() {
      const name = `serial_test_${process.pid}_${++count}`;
      await admin.query(`create database ${name}`);
      const url = new URL(adminUrl);
      url.pathname = '/' + name;
      return url.toString();
    },
    async stop() {
      await admin.end();
    },
    admin,
  };
}
