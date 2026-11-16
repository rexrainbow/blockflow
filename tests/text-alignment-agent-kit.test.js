import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createDiagramModel, layoutDiagram, renderSvg } from '../src/lib/blockchart/index.js';
import { createFlowchartModel, layoutFlowchart, renderFlowchartSvg } from '../src/lib/flowchart/index.js';
import { createStatechartModel, layoutStatechart, renderStatechartSvg } from '../src/lib/statechart/index.js';
const permissionFlag = process.allowedNodeEnvironmentFlags.has('--permission')
  ? '--permission'
  : '--experimental-permission';
for (const [domain, model, layout, render] of [
  ['blockchart', createDiagramModel, layoutDiagram, renderSvg],
  ['flowchart', createFlowchartModel, layoutFlowchart, renderFlowchartSvg],
  ['statechart', createStatechartModel, layoutStatechart, renderStatechartSvg],
])
  test(`${domain}: standalone converter validates alignment, preserves JSON and matches SVG without project access`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'text-alignment-kit-'));
    t.after(async () => {
      assert.equal(dirname(directory), resolve(tmpdir()));
      await rm(directory, { recursive: true, force: true });
    });
    const cli = join(directory, `${domain}-convert.mjs`);
    await writeFile(cli, await readFile(new URL(`../agent-kit/${domain}-convert.mjs`, import.meta.url)));
    const raw = JSON.parse(
      await readFile(new URL(`../examples/text-alignment/${domain}.json`, import.meta.url), 'utf8'),
    );
    const run = (format) =>
      spawnSync(
        process.execPath,
        [
          '--no-warnings',
          permissionFlag,
          `--allow-fs-read=${directory}`,
          cli,
          '-',
          '--output',
          '-',
          '--format',
          format,
          ...(domain === 'blockchart' ? [] : ['--input-format', 'json']),
        ],
        {
          cwd: directory,
          encoding: 'utf8',
          input: JSON.stringify(raw),
          timeout: 30000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
    const svg = run('svg');
    assert.equal(svg.status, 0, svg.stderr);
    assert.equal(svg.stdout, render(await layout(model(raw))) + '\n');
    const json = run('json');
    assert.equal(json.status, 0, json.stderr);
    assert.deepEqual(JSON.parse(json.stdout), raw);
  });
