import { readFile, realpath, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  parseWaveform,
  waveformProblems,
  applyWaveformOps,
  renderWaveformSvg,
  listVcdSignals,
  importVcd,
} from '../lib/waveform/index.js';
import { parse, replaceDocument } from './edit-file.js';

export * from '../lib/waveform/index.js';
export const KIT_VERSION =
  typeof __WAVEFORM_KIT_VERSION__ === 'string' ? __WAVEFORM_KIT_VERSION__ : 'development';

/** Owned normalized document, actual named transitions and nonfatal authoring problems. */
export function inspectWaveform(value) {
  const document = parseWaveform(value);
  return {
    document,
    edges: document.signals.flatMap((signal) =>
      signal.changes.flatMap(([t, , id], i) => (id && i > 0 ? [{ id, signalId: signal.id, t }] : [])),
    ),
    problems: waveformProblems(document),
  };
}

async function output(file, text, source) {
  if (file === '-') {
    process.stdout.write(text);
    return;
  }
  const target = await realpath(file).catch((error) => {
    if (error.code === 'ENOENT') return resolve(file);
    throw error;
  });
  const same = (path) => (process.platform === 'win32' ? path.toLowerCase() : path);
  if (same(target) === same(source)) throw new Error('Output must differ from source file: ' + file);
  await mkdir(dirname(target), { recursive: true });
  const temporary = target + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, text, { flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

const help = `Usage:
  node waveform-edit.mjs inspect waveform.json
  node waveform-edit.mjs check waveform.json
  node waveform-edit.mjs apply waveform.json --ops ops.json [--allow-problems] [--write]
  node waveform-edit.mjs export waveform.json -o out.svg [--format svg|json] [--from N --to N --tick-step N] [--link-route auto|local|rail]
  node waveform-edit.mjs vcd-list capture.vcd [--max-bytes N --max-declarations N --max-changes N]
  node waveform-edit.mjs import-vcd capture.vcd [-o out.json] [--signals top.clk,top.data] [--from N --to N --timescale 1ns]
  node waveform-edit.mjs --help | --version
apply (alias: edit) previews {diff,problems}; only --write replaces a validated waveform.
--ops - reads JSON operations from stdin. --allow-problems permits draft diagnostics.
export/import-vcd -o - writes only the exported data to stdout. Source files are protected.`;
const string = { type: 'string' },
  boolean = { type: 'boolean' };
const limits = { 'max-bytes': string, 'max-declarations': string, 'max-changes': string };
const commands = {
  inspect: {},
  check: {},
  apply: { ops: string, write: boolean, 'allow-problems': boolean },
  export: {
    output: { ...string, short: 'o' },
    format: string,
    from: string,
    to: string,
    'tick-step': string,
    'pixels-per-tick': string,
    'lane-height': string,
    'label-width': string,
    'id-prefix': string,
    'link-route': string,
  },
  'vcd-list': limits,
  'import-vcd': {
    ...limits,
    output: { ...string, short: 'o' },
    signals: string,
    from: string,
    to: string,
    timescale: string,
    title: string,
    'max-signals': string,
  },
};
function runtimeOptions(values, names) {
  const result = {};
  for (const name of names)
    if (values[name] !== undefined) {
      const key = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const value = values[name];
      if (['timescale', 'title', 'id-prefix', 'link-route'].includes(name)) result[key] = value;
      else {
        if (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))
          throw new Error('--' + name + ': expected a nonnegative number');
        result[key] = Number(value);
      }
    }
  return result;
}

async function main(args) {
  if (args.length === 1 && ['--help', '-h', '--version'].includes(args[0])) {
    console.log(args[0] === '--version' ? KIT_VERSION : help);
    return;
  }
  let [command, ...rest] = args;
  if (command === 'edit') command = 'apply';
  if (!Object.hasOwn(commands, command)) throw new Error(help);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: commands[command],
  });
  if (positionals.length !== 1) throw new Error('Expected one input filename\n' + help);
  const file = await realpath(positionals[0]),
    original = await readFile(file, 'utf8');
  if (command === 'vcd-list' || command === 'import-vcd') {
    const options = runtimeOptions(values, [
      ...Object.keys(limits),
      ...(command === 'import-vcd' ? ['max-signals', 'from', 'to', 'timescale', 'title'] : []),
    ]);
    if (values.signals !== undefined) options.signals = values.signals.split(',').map((s) => s.trim());
    const result =
      command === 'vcd-list'
        ? listVcdSignals(original.replace(/^\uFEFF/, ''), options)
        : importVcd(original.replace(/^\uFEFF/, ''), options);
    const text = JSON.stringify(result, null, 2) + '\n';
    if (command === 'import-vcd') await output(values.output ?? '-', text, file);
    else process.stdout.write(text);
    return;
  }
  const document = parse(original, positionals[0]);
  if (command === 'inspect') console.log(JSON.stringify(inspectWaveform(document), null, 2));
  if (command === 'check') {
    const problems = waveformProblems(document);
    console.log(JSON.stringify(problems, null, 2));
    if (problems.length) process.exitCode = 1;
  }
  if (command === 'apply') {
    if (!values.ops) throw new Error('apply requires --ops FILE or --ops -');
    let text = '';
    if (values.ops === '-') {
      process.stdin.setEncoding('utf8');
      for await (const chunk of process.stdin) text += chunk;
    } else text = await readFile(values.ops, 'utf8');
    const applied = applyWaveformOps(document, parse(text, values.ops), {
      allowProblems: values['allow-problems'] ?? false,
    });
    if (values.write && applied.diff.length) await replaceDocument(file, original, applied.document);
    console.log(JSON.stringify({ diff: applied.diff, problems: applied.problems }, null, 2));
  }
  if (command === 'export') {
    if (!values.output) throw new Error('export requires -o FILE or -o -');
    const format = values.format ?? 'svg';
    if (!['svg', 'json'].includes(format)) throw new Error('Unsupported format: ' + format);
    const options = runtimeOptions(values, [
      'from',
      'to',
      'tick-step',
      'pixels-per-tick',
      'lane-height',
      'label-width',
      'id-prefix',
      'link-route',
    ]);
    if (format === 'json' && Object.keys(options).length)
      throw new Error('Rendering options require --format svg');
    const text =
      format === 'svg'
        ? renderWaveformSvg(document, options)
        : JSON.stringify(parseWaveform(document), null, 2);
    await output(values.output, text + '\n', file);
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
