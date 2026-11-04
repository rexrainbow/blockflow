import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { exportSvg, exportPng } from '../../src/lib/node.js';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="101" height="51"><rect x="10" y="10" width="20" height="20" fill="black"/></svg>';
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'rtl-diagram-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('SVG output preserves exact UTF-8 content and overwrites existing files', async t => {
  const path = join(await directory(t), '圖表.svg');
  assert.equal(await exportSvg('first', path), undefined);
  const content = svg.replace('</svg>', '<text>硬體 &amp; RTL</text></svg>');
  assert.equal(await exportSvg(content, path), undefined);
  assert.equal(await readFile(path, 'utf8'), content);
});

for (const scale of [1, 2, 1.5, 0.5, 0.001]) test(`PNG size, rounded scale ${scale}, white background`, async t => {
  const path = join(await directory(t), 'diagram.png');
  assert.equal(await exportPng(svg, path, { scale }), undefined);
  const metadata = await sharp(path).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, Math.max(1, Math.round(101 * scale)));
  assert.equal(metadata.height, Math.max(1, Math.round(51 * scale)));
  if (scale >= 0.5) {
    const { data } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual(Array.from(data.subarray(0, 3)), [255, 255, 255]);
  }
});

test('default scale and overwrite PNG', async t => {
  const path = join(await directory(t), 'diagram.png');
  await exportPng(svg, path, { scale: 2 });
  await exportPng(svg, path);
  assert.equal((await sharp(path).metadata()).width, 101);
});

for (const scale of [0, -1, NaN, Infinity, null, '2']) test(`reject invalid scale ${scale}`, async t => {
  await assert.rejects(exportPng(svg, join(await directory(t), 'bad.png'), { scale }), RangeError);
});

test('reject invalid options, invalid SVG and oversized output', async t => {
  const path = join(await directory(t), 'bad.png');
  for (const options of [null, [], { extra: true }]) await assert.rejects(exportPng(svg, path, options), TypeError);
  await assert.rejects(exportPng('not svg', path));
  await assert.rejects(exportPng('<svg><invalid', path));
  await assert.rejects(exportPng(svg, path, { scale: 1000 }), RangeError);
  await assert.rejects(exportPng(svg, path, { scale: 100 }), RangeError);
  await assert.rejects(exportPng('', path), TypeError);
});

test('report I/O errors, do not create parent directories', async t => {
  const dir = await directory(t);
  const missing = join(dir, 'missing', 'diagram.svg');
  await assert.rejects(exportSvg(svg, missing), { code: 'ENOENT' });
  await assert.rejects(exportPng(svg, missing), Error);
  const existingDirectory = join(dir, 'directory'); await mkdir(existingDirectory);
  await assert.rejects(exportSvg(svg, existingDirectory), Error);
  await assert.rejects(exportPng(svg, existingDirectory), Error);
});
