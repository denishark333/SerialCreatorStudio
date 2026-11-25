// Syntax-checks every backend source file (recursively), so new modules are never forgotten.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../src/', import.meta.url);
const files = readdirSync(root, { recursive: true })
  .filter(name => name.endsWith('.js'))
  .map(name => join(root.pathname.replace(/^\/([A-Za-z]:)/, '$1'), name));

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed++;
}
console.log(`${files.length - failed}/${files.length} files OK`);
process.exit(failed ? 1 : 0);
