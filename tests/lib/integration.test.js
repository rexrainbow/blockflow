import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { exportSvg, exportPng } from '../../src/lib/node.js';
import { checkLayout } from './helpers.js';

for (const name of ['uart-data-path', 'placement-feedback', 'placement-stress']) test(`${name} JSON → model → layout → SVG + PNG from the same result`, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'rtl-e2e-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = JSON.parse(await readFile(new URL(`../../examples/${name}.json`, import.meta.url), 'utf8'));
  const model = createDiagramModel(input);
  const layout = await layoutDiagram(model);
  checkLayout(model, layout);
  const svg = renderSvg(layout);
  await exportSvg(svg, join(dir, 'diagram.svg'));
  await exportPng(svg, join(dir, 'diagram.png'), { scale: 2 });
  assert.equal(await readFile(join(dir, 'diagram.svg'), 'utf8'), svg);
  const metadata = await sharp(join(dir, 'diagram.png')).metadata();
  const base = await sharp(Buffer.from(svg)).metadata();
  assert.equal(metadata.width, Math.round(base.width * 2));
  assert.equal(metadata.height, Math.round(base.height * 2));
});
