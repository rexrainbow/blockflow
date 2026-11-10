import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as runCli } from '../src/agent-kit/flowchart-converter.js';
import { exportPng } from '../src/lib/shared/export/node.js';

export const main = (values = process.argv.slice(2)) =>
  runCli(values, {
    pngExporter: exportPng,
    command: 'node scripts/flowchart-convert.js',
  });
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
