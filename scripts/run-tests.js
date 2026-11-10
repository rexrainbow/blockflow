import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Keep ignored output/test-*.mjs diagnostics out of Node's automatic test discovery.
const root = fileURLToPath(new URL('../tests/', import.meta.url));
function testFiles(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? testFiles(path) : entry.name.endsWith('.test.js') ? [path] : [];
  });
}
const files = testFiles(root).sort();
if (!files.length) throw new Error('No test files found under tests/.');
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], {
  stdio: 'inherit',
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
