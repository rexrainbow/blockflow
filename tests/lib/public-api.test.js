import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as core from 'rtl-diagram';
import * as node from 'rtl-diagram/node';
import * as coreFile from '../../src/lib/index.js';
import * as nodeFile from '../../src/lib/node.js';
import { fixture } from './helpers.js';

test('package and file entries share API identities and expose exporters only on Node entry', () => {
  assert.deepEqual(core, coreFile);
  assert.deepEqual(node, nodeFile);
  for (const key of Object.keys(core)) assert.equal(node[key], core[key]);
  assert.equal(core.exportSvg, undefined);
  assert.equal(core.exportPng, undefined);
  assert.equal(typeof node.exportSvg, 'function');
  assert.equal(typeof node.exportPng, 'function');
  assert.throws(() => core.createDiagramModel({}), error => error instanceof node.DiagramValidationError);
});

test('shared package entry completes JSON to SVG with Node exporter dependencies blocked', async () => {
  // A fresh process ensures the Node entry loaded by other tests cannot mask a leak.
  const script = `
    import { register } from 'node:module';
    import assert from 'node:assert/strict';
    const hook = \`
      export async function resolve(specifier, context, nextResolve) {
        if (['sharp', 'fs', 'node:fs'].includes(specifier) || specifier.startsWith('fs/') || specifier.startsWith('node:fs/')) {
          throw new Error('Node exporter dependency reached shared entry: ' + specifier);
        }
        return nextResolve(specifier, context);
      }
    \`;
    register('data:text/javascript,' + encodeURIComponent(hook), import.meta.url);
    await assert.rejects(import('node:fs/promises'), /Node exporter dependency reached shared entry/);
    const { createDiagramModel, layoutDiagram, renderSvg } = await import('rtl-diagram');
    const result = await layoutDiagram(createDiagramModel(JSON.parse(process.argv[1])));
    assert.equal(result.modules.length, 2);
    assert.equal(result.connections.length, 1);
    assert.ok(renderSvg(result).startsWith('<svg '));
    process.stdout.write('shared SVG pipeline OK');
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', script, JSON.stringify(fixture())], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
  });
  assert.equal(stdout, 'shared SVG pipeline OK');
});
