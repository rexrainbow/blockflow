import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setDirection } from '../src/lib/blockchart/direction.js';
import { createDiagramModel, layoutDiagram, renderSvg } from '../src/lib/index.js';

// Compare the same authored diagram; never rewrite the input or GUI artifacts.
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const input = resolve(
  args[0] && !args[0].startsWith('--') ? args.shift() : join(root, 'examples/processor-components.json'),
);
let output = join(root, 'output/layout'),
  direction;
while (args.length) {
  const key = args.shift(),
    value = args.shift();
  if (key === '--output' && value) output = resolve(value);
  else if (key === '--direction' && ['right', 'down'].includes(value)) direction = value;
  else
    throw new Error(
      'Usage: node scripts/measure-layout.js [input.json] [--output directory] [--direction right|down]',
    );
}
const source = await readFile(input, 'utf8');
const raw = JSON.parse(source.replace(/^\uFEFF/, ''));
// A named, pinned reference never inherits spacing from the evolving example.
const referenceSpacing = Object.freeze({ moduleSpacing: 180, layerSpacing: 70 });
const paper = Object.freeze({ orientation: 'portrait', widthMm: 210, heightMm: 297, marginMm: 15 });
createDiagramModel(raw); // Validate before diagnostic transformations.
const variants = [
  ['reference-wide', (d) => Object.assign(d.layout, referenceSpacing)],
  ['as-authored', () => {}],
  [
    'defaults',
    (d) => {
      delete d.layout.moduleSpacing;
      delete d.layout.layerSpacing;
    },
  ],
];
if (
  [
    join(output, 'measurements.json'),
    ...variants.flatMap(([name]) => [join(output, name + '.json'), join(output, name + '.svg')]),
  ].some((path) => resolve(path) === input)
)
  throw new Error('Output would overwrite the input');
const hash = createHash('sha256');
async function hashSources(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await hashSources(path);
    else if (path.endsWith('.js'))
      hash
        .update(path.slice(root.length).replaceAll('\\', '/'))
        .update((await readFile(path, 'utf8')).replaceAll('\r\n', '\n'));
  }
}
await hashSources(join(root, 'src/lib'));
await mkdir(output, { recursive: true });
const measurements = [];
for (const [name, configure] of variants) {
  const authored = structuredClone(raw);
  authored.layout ??= {};
  if (direction) {
    if (direction !== (authored.layout.direction ?? 'right'))
      for (const module of authored.modules ?? [])
        if (module.type === 'concat') for (const port of module.ports ?? []) delete port.side;
    setDirection(authored, direction);
  }
  configure(authored);
  const model = createDiagramModel(authored);
  const layout = await layoutDiagram(model);
  const svg = renderSvg(layout),
    rootTag = svg.slice(0, svg.indexOf('>') + 1);
  const svgWidth = Number(rootTag.match(/\bwidth="([^"]+)"/)[1]);
  const svgHeight = Number(rootTag.match(/\bheight="([^"]+)"/)[1]);
  const usableWidthMm = paper.widthMm - 2 * paper.marginMm;
  const usableHeightMm = paper.heightMm - 2 * paper.marginMm;
  const mmPerUnit = Math.min(usableWidthMm / svgWidth, usableHeightMm / svgHeight);
  const blockArea = layout.modules.reduce((sum, node) => sum + node.width * node.height, 0);
  let length = 0,
    bends = 0;
  for (const edge of layout.connections)
    for (const section of edge.sections) {
      for (let i = 1; i < section.points.length; i++) {
        const a = section.points[i - 1],
          b = section.points[i];
        length += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        if (i > 1) {
          const p = section.points[i - 2];
          if (Math.abs(p.x - a.x) < 1e-6 !== Math.abs(a.x - b.x) < 1e-6) bends++;
        }
      }
    }
  const area = layout.width * layout.height;
  const sourceNames = new Set(),
    endNames = new Set();
  for (const edge of layout.connections)
    for (const label of edge.labelInstances ?? []) {
      const key = label.sharedKey ?? edge.id;
      if (label.role === 'start') sourceNames.add(key);
      if (label.role === 'end') endNames.add(key);
    }
  measurements.push({
    name,
    layoutOptions: authored.layout,
    effectiveLayoutOptions: {
      moduleSpacing: model.layout.moduleSpacing,
      layerSpacing: model.layout.layerSpacing,
      feedbackMargin: model.layout.feedbackMargin,
      feedbackLaneSpacing: model.layout.feedbackLaneSpacing,
    },
    width: layout.width,
    height: layout.height,
    area,
    blockArea,
    blockCoveragePercent: (100 * blockArea) / area,
    routedLength: length,
    bends,
    labelCounts: { source: sourceNames.size, end: endNames.size },
    warnings: layout.warnings ?? [],
    a4: {
      svgWidth,
      svgHeight,
      mmPerUnit,
      printedWidthMm: svgWidth * mmPerUnit,
      printedHeightMm: svgHeight * mmPerUnit,
      limitingAxis: usableWidthMm / svgWidth < usableHeightMm / svgHeight ? 'width' : 'height',
      fontSize12UnitsPt: (12 * mmPerUnit * 72) / 25.4,
    },
  });
  const stem = join(output, name);
  if ([stem + '.json', stem + '.svg'].includes(input)) throw new Error('Output would overwrite the input');
  await writeFile(stem + '.json', JSON.stringify(authored, null, 2) + '\n');
  await writeFile(stem + '.svg', svg);
}
const baseline = measurements.find((row) => row.name === 'reference-wide');
for (const row of measurements) {
  row.widthReductionPercent = 100 * (1 - row.width / baseline.width);
  row.heightReductionPercent = 100 * (1 - row.height / baseline.height);
  row.areaReductionPercent = 100 * (1 - row.area / baseline.area);
  row.a4.scaleGainVsReferencePercent = 100 * (row.a4.mmPerUnit / baseline.a4.mmPerUnit - 1);
}
const report = {
  reportVersion: 3,
  baseline: { name: baseline.name, kind: 'pinned-spacing', ...referenceSpacing },
  inputLayoutOptions: raw.layout ?? {},
  paper,
  input,
  inputSha256: createHash('sha256').update(source).digest('hex'),
  runtimeSha256: hash.digest('hex'),
  node: process.version,
  elk: JSON.parse(await readFile(join(root, 'node_modules/elkjs/package.json'), 'utf8')).version,
  measurements,
};
await writeFile(join(output, 'measurements.json'), JSON.stringify(report, null, 2) + '\n');
console.table(
  measurements.map((row) => ({
    scenario: row.name,
    width: row.width.toFixed(1),
    height: row.height.toFixed(1),
    'area reduction vs reference %': row.areaReductionPercent.toFixed(2),
    spacing: `${row.effectiveLayoutOptions.moduleSpacing}/${row.effectiveLayoutOptions.layerSpacing}`,
    'block cover %': row.blockCoveragePercent.toFixed(2),
    bends: row.bends,
    warnings: row.warnings.length,
    'A4 mm/unit': row.a4.mmPerUnit.toFixed(4),
  })),
);
console.log('Report:', join(output, 'measurements.json'));
