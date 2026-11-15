import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('layout report pins its named reference while preserving authored/default scenarios', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blockflow-layout-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    const input = join(directory, 'input.json');
    const source = {
      version: 1,
      diagram: { name: 'Stable layout comparison' },
      layout: { direction: 'down', moduleSpacing: 37, layerSpacing: 19 },
      modules: [
        { id: 'A', ports: [{ id: 'out', direction: 'output' }] },
        { id: 'B', ports: [{ id: 'in', direction: 'input' }] },
      ],
      connections: [
        { from: 'A.out', to: ['B.in'], label: 'Signal', style: { label: { repeatAtEnd: 'always' } } },
      ],
    };
    const execute = (output) => {
      const result = spawnSync(process.execPath, ['scripts/measure-layout.js', input, '--output', output], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000,
      });
      assert.equal(result.status, 0, result.stderr);
    };
    await writeFile(input, JSON.stringify(source));
    const original = await readFile(input, 'utf8');
    const output = join(directory, 'first');
    execute(output);
    const report = JSON.parse(await readFile(join(output, 'measurements.json'), 'utf8'));
    const rows = new Map(report.measurements.map((row) => [row.name, row]));
    assert.equal(report.reportVersion, 3);
    assert.deepEqual(report.paper, { orientation: 'portrait', widthMm: 210, heightMm: 297, marginMm: 15 });
    for (const row of report.measurements) {
      assert.deepEqual(row.labelCounts, { source: 1, end: 1 });
      const fit = row.a4,
        scale = Math.min(180 / fit.svgWidth, 267 / fit.svgHeight);
      assert.ok(Math.abs(fit.mmPerUnit - scale) < 1e-9);
      assert.ok(fit.printedWidthMm <= 180 + 1e-6 && fit.printedHeightMm <= 267 + 1e-6);
      assert.ok(
        Math.abs(fit.svgWidth - row.width - 40) < 1e-6 && Math.abs(fit.svgHeight - row.height - 40) < 1e-6,
        'includes SVG export margins',
      );
      assert.ok(Math.abs(fit.fontSize12UnitsPt - (12 * scale * 72) / 25.4) < 1e-9);
    }
    assert.deepEqual(report.baseline, {
      name: 'reference-wide',
      kind: 'pinned-spacing',
      moduleSpacing: 180,
      layerSpacing: 70,
    });
    assert.equal(report.measurements.length, 3);
    for (const name of ['reference-wide']) {
      assert.equal(rows.get(name).effectiveLayoutOptions.moduleSpacing, 180);
      assert.equal(rows.get(name).effectiveLayoutOptions.layerSpacing, 70);
    }
    assert.equal(rows.get('reference-wide').areaReductionPercent, 0);
    assert.equal(rows.get('as-authored').effectiveLayoutOptions.moduleSpacing, 37);
    assert.equal(rows.get('defaults').effectiveLayoutOptions.moduleSpacing, 20);
    assert.equal(rows.get('defaults').effectiveLayoutOptions.layerSpacing, 30);
    assert.equal(Object.hasOwn(rows.get('defaults').layoutOptions, 'moduleSpacing'), false);
    assert.ok(report.measurements.every((row) => !Object.hasOwn(row.effectiveLayoutOptions, 'density')));
    assert.equal(await readFile(input, 'utf8'), original);
    assert.deepEqual(JSON.parse(await readFile(join(output, 'as-authored.json'), 'utf8')), source);
    source.layout.moduleSpacing = 77;
    source.layout.layerSpacing = 55;
    await writeFile(input, JSON.stringify(source));
    const second = join(directory, 'second');
    execute(second);
    const changed = JSON.parse(await readFile(join(second, 'measurements.json'), 'utf8'));
    const pinned = changed.measurements.find((row) => row.name === 'reference-wide');
    assert.deepEqual(
      [pinned.width, pinned.height],
      [rows.get('reference-wide').width, rows.get('reference-wide').height],
    );
    assert.equal(
      changed.measurements.find((row) => row.name === 'as-authored').effectiveLayoutOptions.moduleSpacing,
      77,
    );
    assert.notEqual(changed.inputSha256, report.inputSha256);
  } finally {
    if (
      dirname(resolve(directory)) === resolve(tmpdir()) &&
      basename(directory).startsWith('blockflow-layout-')
    )
      await rm(directory, { recursive: true, force: true });
  }
});
