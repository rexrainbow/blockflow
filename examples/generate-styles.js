import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDiagramModel, layoutDiagram, renderSvg, exportSvg, exportPng } from '../src/lib/node.js';

const output = new URL('../output/styles/', import.meta.url);
await mkdir(output, { recursive: true });
const input = JSON.parse(await readFile(new URL('./style-gallery.json', import.meta.url), 'utf8'));
const result = await layoutDiagram(createDiagramModel(input));
async function save(stem, layout) {
  const svg = renderSvg(layout);
  await exportSvg(svg, new URL(`${stem}.svg`, output));
  await exportPng(svg, fileURLToPath(new URL(`${stem}.png`, output)), { scale: 2 });
  await writeFile(new URL(`${stem}.layout.json`, output), JSON.stringify(layout, null, 2) + '\n');
  console.log(`output/styles/${stem}: SVG, PNG (2x), layout JSON`);
}
await save('style-gallery', result);
