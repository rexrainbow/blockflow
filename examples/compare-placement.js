import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDiagramModel, layoutDiagram, renderSvg, exportSvg, exportPng } from '../src/lib/node.js';
import { measureLayout } from './metrics.js';

const placements = ['default', 'relaxed', 'simple'];
const cases = ['placement-branch', 'placement-feedback', 'placement-stress'];
const output = new URL('../output/placement/', import.meta.url);
await mkdir(output, { recursive: true });
const results = [];
for (const name of cases) {
  const input = JSON.parse(await readFile(new URL(`./${name}.json`, import.meta.url), 'utf8'));
  const panels = [];
  for (const placement of placements) {
    const model = createDiagramModel({ ...input, layout: { ...input.layout, direction: 'right', placement } });
    const layout = await layoutDiagram(model);
    const svg = renderSvg(layout);
    const stem = `${name}-${placement}`;
    await exportSvg(svg, new URL(`${stem}.svg`, output));
    await exportPng(svg, fileURLToPath(new URL(`${stem}.png`, output)), { scale: 2 });
    await writeFile(new URL(`${stem}.layout.json`, output), JSON.stringify(layout, null, 2) + '\n');
    const metrics = measureLayout(layout);
    results.push({ name, placement, ...metrics });
    panels.push({ placement, svg, width: layout.width + 40, height: layout.height + 40, metrics });
  }
  // Stack SVGs without rescaling so distances remain visually comparable.
  const width = Math.max(...panels.map(panel => panel.width)) + 40;
  const height = panels.reduce((sum, panel) => sum + panel.height + 70, 0) + 20;
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="white"/>`,
  ];
  let y = 20;
  for (const panel of panels) {
    const { topYSpread, centerYSpread, bends, wireLength } = panel.metrics;
    lines.push(`<text x="20" y="${y + 16}" font-family="monospace" font-size="14">${panel.placement}: top=${topYSpread}, center=${centerYSpread}, bends=${bends}, length=${wireLength}</text>`);
    lines.push(`<g transform="translate(20 ${y + 30})">${panel.svg}</g>`);
    y += panel.height + 70;
  }
  lines.push('</svg>');
  const overview = lines.join('\n');
  await exportSvg(overview, new URL(`${name}-comparison.svg`, output));
  await exportPng(overview, fileURLToPath(new URL(`${name}-comparison.png`, output)));
}

const columns = ['Case', 'Placement', 'Width', 'Height', 'Top Y spread', 'Center Y spread', 'Bends', 'Wire length'];
const table = [
  `| ${columns.join(' | ')} |`,
  `| ${columns.map(() => '---').join(' | ')} |`,
  ...results.map(row => `| ${[row.name, row.placement, row.width, row.height, row.topYSpread, row.centerYSpread, row.bends, row.wireLength].join(' | ')} |`),
];
const report = [
  '# Placement comparison', '',
  'All cases use RIGHT, identical ports, spacing and random seed; only placement changes.',
  'Main-path alignment is measured on A, B, C, D. Spreads are max(Y) - min(Y); smaller means closer alignment.',
  'Width/height exclude the 20px SVG margin. Wire length is Manhattan length summed per edge; shared segments count once per edge.',
  'Bends count direction changes within each edge section, ignoring zero-length segments and collinear continuation.',
  'These are observations, not guarantees of optimality or exact alignment.', '',
  ...table, '',
  '## Diagrams', '',
  ...cases.map(name => `- [${name} comparison](${name}-comparison.svg)`), '',
].join('\n');
await writeFile(new URL('summary.json', output), JSON.stringify(results, null, 2) + '\n');
await writeFile(new URL('summary.md', output), report);
console.log(table.join('\n'));
console.log(`\nOutput: ${fileURLToPath(output)}`);
