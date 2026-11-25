// Runs Vitest from the canonical project path. On Windows a terminal may report the drive as "c:\" while Node
// resolves modules as "C:\"; Vitest then loads two copies of itself ("failed to find the runner").
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = realpathSync.native(fileURLToPath(new URL('..', import.meta.url)));
const bin = realpathSync.native(fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)));
const result = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
