import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let count = 0;
function walk(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (path.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (result.status !== 0) {
        process.stderr.write(result.stderr);
        process.exit(1);
      }
      count++;
    }
  }
}
['src', 'tests', 'e2e', 'scripts'].forEach(walk);
console.log(`Syntax checked ${count} JavaScript files. No TypeScript typecheck applies.`);
