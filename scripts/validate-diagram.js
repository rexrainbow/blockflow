import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createDiagramModel } from '../src/lib/model.js';

const usage = 'Usage: npm run validate:diagram -- <input.json> [more.json ...] [--svg output.svg]';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(
      `${usage}\nWithout --svg: read-only model validation. --svg requires exactly one input and also checks layout.`,
    );
    return;
  }
  const files = [];
  let svgPath;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--svg' && !svgPath && args[i + 1] && !args[i + 1].startsWith('-')) svgPath = args[++i];
    else if (args[i].startsWith('-')) throw new Error(`Unknown or incomplete option: ${args[i]}`);
    else files.push(args[i]);
  }
  if (!files.length || (svgPath && files.length !== 1)) throw new Error(usage);
  if (svgPath && resolve(svgPath) === resolve(files[0]))
    throw new Error('SVG output must not overwrite the input JSON.');
  for (const file of files) {
    let stage = 'read';
    try {
      const text = await readFile(file, 'utf8');
      stage = 'JSON';
      const input = JSON.parse(text);
      stage = 'validation';
      const model = createDiagramModel(input);
      if (svgPath) {
        stage = 'layout';
        const { layoutDiagram, renderSvg } = await import('../src/lib/index.js');
        const svg = renderSvg(await layoutDiagram(model));
        stage = 'SVG write';
        await mkdir(dirname(resolve(svgPath)), { recursive: true });
        await writeFile(svgPath, svg, 'utf8');
      }
      console.log(
        `OK ${file}${svgPath ? ` -> ${svgPath} (model, layout and SVG)` : ' (structure and connection semantics)'}`,
      );
    } catch (error) {
      console.error(`${file}: ${stage}: ${error.path ? `${error.path}: ` : ''}${error.message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 2;
});
