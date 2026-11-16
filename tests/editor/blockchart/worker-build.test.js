import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
async function bundle(entry, alias = []) {
  const result = await build({
    configFile: false,
    logLevel: 'error',
    resolve: { alias },
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: { entry: path(entry), formats: ['es'], fileName: () => 'factory.js' },
    },
  });
  return (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
}
test('canonical module Worker factory bundles its domain entry without GUI imports', async () => {
  const output = await bundle('../../../src/editor/blockchart/services/worker-factory.js');
  const worker = output.filter((o) => o.type === 'asset' && o.fileName.endsWith('.js'));
  assert.equal(worker.length, 1);
  const code = String(worker[0].source);
  assert.match(code, /editorKey/);
  assert.match(code, /revision/);
  assert.ok(output.some((o) => o.type === 'chunk' && o.code.includes(worker[0].fileName)));
});
test('canonical inline Worker factory has no separately emitted worker file', async () => {
  const output = await bundle('../../../src/editor/blockchart/services/worker-factory.offline.js');
  assert.equal(output.filter((o) => o.type === 'asset').length, 0);
  assert.equal(output.filter((o) => o.type === 'chunk').length, 1);
  assert.match(output[0].code, /createObjectURL/);
});
test('offline resolution uses the canonical Blockchart factory', async () => {
  const output = await bundle('../../../src/editor/blockchart/services/layout.js', [
    {
      find: './worker-factory.js',
      replacement: path('../../../src/editor/blockchart/services/worker-factory.offline.js'),
    },
  ]);
  assert.equal(output.filter((o) => o.type === 'asset').length, 0);
  assert.match(output.find((o) => o.type === 'chunk').code, /createObjectURL/);
});
