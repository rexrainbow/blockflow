import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

for (const offline of [false, true])
  test(`Flowchart ${offline ? 'inline' : 'module'} Worker bundles independently`, async () => {
    const result = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        minify: false,
        target: 'es2022',
        lib: {
          entry: fileURLToPath(
            new URL(
              `../../../src/editor/flowchart/services/worker-factory${offline ? '.offline' : ''}.js`,
              import.meta.url,
            ),
          ),
          formats: ['es'],
        },
      },
    });
    const output = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
    const assets = output.filter((o) => o.type === 'asset');
    if (offline) {
      assert.equal(assets.length, 0);
      assert.match(output.find((o) => o.type === 'chunk').code, /createObjectURL/);
    } else {
      assert.equal(assets.length, 1);
      assert.match(String(assets[0].source), /editorKey/);
      assert.match(String(assets[0].source), /revision/);
    }
  });
