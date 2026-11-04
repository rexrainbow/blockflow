import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDiagramModel, layoutDiagram, renderSvg, exportSvg, exportPng } from '../src/lib/node.js';
import { measureLayout } from './metrics.js';

const output = new URL('../output/feedback/', import.meta.url);
await mkdir(output, { recursive: true });
const rows = [];
for (const name of ['feedback', 'stress']) {
  const filename = `placement-${name}`;
  const input = JSON.parse(await readFile(new URL(`./${filename}.json`, import.meta.url), 'utf8'));
  const panels = [];
  for (const feedbackRouting of ['elk', 'outer']) {
    const model = createDiagramModel({
      ...input,
      layout: { ...input.layout, feedbackRouting },
    });
    const result = await layoutDiagram(model);
    const svg = renderSvg(result);
    const stem = `${name}-${feedbackRouting}`;
    await exportSvg(svg, new URL(`${stem}.svg`, output));
    await exportPng(svg, fileURLToPath(new URL(`${stem}.png`, output)), { scale: 2 });
    await writeFile(new URL(`${stem}.layout.json`, output), JSON.stringify(result, null, 2) + '\n');
    const metrics = measureLayout(result);
    const ref = model.connections.find(connection => connection.source.moduleId === 'D' && connection.target.moduleId === 'A');
    const feedback = result.connections.find(connection => connection.id === ref.id);
    const feedbackMetric = metrics.edges.find(edge => edge.id === ref.id);
    const row = {
      name, feedbackRouting, width: result.width, height: result.height,
      feedbackBends: feedbackMetric.bends, feedbackLength: feedbackMetric.wireLength,
      totalBends: metrics.bends, totalLength: metrics.wireLength,
      route: feedback.routingInfo ?? { method: 'elk' },
    };
    rows.push(row); panels.push({ ...row, svg, width: result.width + 40, height: result.height + 40 });
  }
  const width = Math.max(...panels.map(panel => panel.width)) + 40;
  const height = panels.reduce((sum, panel) => sum + panel.height + 70, 0) + 20;
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="white"/>`,
  ];
  let y = 20;
  for (const panel of panels) {
    lines.push(`<text x="20" y="${y + 16}" font-family="monospace" font-size="14">${panel.feedbackRouting}: feedback bends=${panel.feedbackBends}, length=${panel.feedbackLength}; total bends=${panel.totalBends}</text>`);
    lines.push(`<g transform="translate(20 ${y + 30})">${panel.svg}</g>`);
    y += panel.height + 70;
  }
  lines.push('</svg>');
  const svg = lines.join('\n');
  await exportSvg(svg, new URL(`${name}-comparison.svg`, output));
  await exportPng(svg, fileURLToPath(new URL(`${name}-comparison.png`, output)));
}
const table = [
  '| Case | Routing | Feedback bends | Feedback length | Total bends | Width | Height |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map(row => `| ${[row.name, row.feedbackRouting, row.feedbackBends, row.feedbackLength, row.totalBends, row.width, row.height].join(' | ')} |`),
];
await writeFile(new URL('summary.json', output), JSON.stringify(rows, null, 2) + '\n');
await writeFile(new URL('summary.md', output), [
  '# AABB exterior feedback routing', '',
  'Each pair uses identical block geometry and ELK layout. Only layout.feedbackRouting changes.',
  'outer computes the active block AABB, expands by margin, checks top/bottom candidates, and chooses by bends then length.',
  'Main exterior segment passes through two AABB corners; endpoint elbows preserve output/input directions.',
  'Blocked endpoint access preserves the ELK route with routingInfo.reason=outer-access-blocked. It never moves a block.',
  'Widths and heights exclude SVG margins. Output normalization may uniformly translate the graph.', '',
  ...table, '', '## Paired diagrams', '',
  ...['feedback', 'stress'].map(name => `- [${name}](${name}-comparison.svg)`), '',
].join('\n'));
console.log(table.join('\n'));
