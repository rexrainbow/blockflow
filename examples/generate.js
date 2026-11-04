import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDiagramModel, layoutDiagram, renderSvg, exportSvg, exportPng } from '../src/lib/node.js';

const output = new URL('../output/', import.meta.url);
await mkdir(output, { recursive: true });
for (const name of ['uart-data-path', 'direct-feedback', 'cyclic-feedback']) {
  const input = JSON.parse(await readFile(new URL(`./${name}.json`, import.meta.url), 'utf8'));
  for (const direction of ['right', 'left']) {
    const model = createDiagramModel({ ...input, layout: { ...input.layout, direction } });
    const layout = await layoutDiagram(model);
    const svg = renderSvg(layout);
    const stem = `${name}-${direction}`;
    await exportSvg(svg, new URL(`${stem}.svg`, output));
    await exportPng(svg, fileURLToPath(new URL(`${stem}.png`, output)), { scale: 2 });
    await writeFile(new URL(`${stem}.layout.json`, output), JSON.stringify(layout, null, 2) + '\n');
    console.log(`${stem}: SVG ${layout.width + 40} × ${layout.height + 40}, PNG scale 2`);
  }
}
