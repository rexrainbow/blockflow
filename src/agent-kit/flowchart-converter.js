import { readFile, writeFile, mkdir, rename, unlink, realpath } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  parseMermaid,
  createFlowchartModel,
  layoutFlowchart,
  renderFlowchartSvg,
} from '../lib/flowchart/index.js';

export { parseMermaid };
export const KIT_VERSION =
  typeof __FLOWCHART_KIT_VERSION__ === 'string' ? __FLOWCHART_KIT_VERSION__ : 'development';
class ArgumentError extends Error {
  constructor(message) {
    super(message);
    this.stage = 'arguments';
  }
}
function documentFor(input, inputFormat) {
  const kind = inputFormat ?? (typeof input === 'string' ? 'mermaid' : 'json');
  if (!['mermaid', 'json'].includes(kind)) throw new ArgumentError('Expected input format mermaid or json');
  try {
    return kind === 'mermaid' ? parseMermaid(input) : typeof input === 'string' ? JSON.parse(input) : input;
  } catch (error) {
    error.stage ??= 'parse';
    throw error;
  }
}
export function validateFlowchart(input, options = {}) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((k) => k !== 'inputFormat')
  )
    throw new ArgumentError('Only inputFormat is supported');
  const document = documentFor(input, options.inputFormat);
  try {
    createFlowchartModel(document);
  } catch (error) {
    error.stage ??= 'validation';
    throw error;
  }
  return { ok: true };
}
export async function convertFlowchart(input, options = {}) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((k) => !['inputFormat', 'format'].includes(k))
  )
    throw new ArgumentError('Only inputFormat and format are supported');
  const format = options.format ?? 'svg';
  if (!['json', 'svg'].includes(format)) throw new ArgumentError('Format must be json or svg');
  const document = documentFor(input, options.inputFormat);
  let model;
  try {
    model = createFlowchartModel(document);
  } catch (error) {
    error.stage ??= 'validation';
    throw error;
  }
  if (format === 'json') return { format, text: JSON.stringify(document, null, 2) + '\n', warnings: [] };
  let layout;
  try {
    layout = await layoutFlowchart(model);
  } catch (error) {
    error.stage ??= 'layout';
    throw error;
  }
  try {
    return { format, text: renderFlowchartSvg(layout) + '\n', warnings: layout.warnings ?? [] };
  } catch (error) {
    error.stage ??= 'render';
    throw error;
  }
}
function usage({ command = 'node flowchart-convert.mjs', pngExporter } = {}) {
  const formats = pngExporter ? 'svg|png|json' : 'svg|json';
  return `Flowchart converter (Node.js 22.12+)
Usage: ${command} <input.mmd|input.json|-> --output <file|-> [--format ${formats}]
       ${command} <input> --check [--diagnostics text|json]
Options:
  --input-format mermaid|json  Override extension-based detection; stdin defaults to Mermaid.
  --output PATH               Export a file, or '-' for stdout.
  --format ${formats}         Inferred from output extension; required for stdout.
  --check                     Syntax/semantic validation without layout or export.
  --diagnostics text|json      Errors and warnings to stderr; defaults to text.
  --version                   Print the standalone kit build ID.
  --help                      Print help.
${pngExporter ? '  --scale NUMBER              Positive PNG scale (default 1); PNG requires a file.' : 'Standalone kit supports JSON and SVG. PNG is available through the project Flowchart CLI.'}
No project source, package installation, browser or network is required for the standalone kit.
Exit codes: 0 success, 1 input/validation/layout/I/O failure, 2 invalid arguments.`;
}
function args(values, pngExporter) {
  const result = {};
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === '--check') {
      if (result.check) throw new ArgumentError('Duplicate --check');
      result.check = true;
    } else if (['--output', '--format', '--input-format', '--scale', '--diagnostics'].includes(value)) {
      const key = {
        '--output': 'output',
        '--format': 'format',
        '--input-format': 'inputFormat',
        '--scale': 'scale',
        '--diagnostics': 'diagnostics',
      }[value];
      if (result[key] !== undefined || !values[i + 1] || values[i + 1].startsWith('--'))
        throw new ArgumentError('Missing or duplicate ' + value);
      result[key] = values[++i];
    } else if (value.startsWith('--') || result.input !== undefined)
      throw new ArgumentError('Unexpected argument ' + value);
    else result.input = value;
  }
  if (!result.input) throw new ArgumentError('Input is required');
  result.inputFormat ??= extname(result.input).toLowerCase() === '.json' ? 'json' : 'mermaid';
  if (!['json', 'mermaid'].includes(result.inputFormat))
    throw new ArgumentError('Expected input format json or mermaid');
  result.diagnostics ??= 'text';
  if (!['json', 'text'].includes(result.diagnostics))
    throw new ArgumentError('Expected diagnostics text or json');
  if (result.check) {
    if (result.output || result.format || result.scale) throw new ArgumentError('--check cannot export');
    return result;
  }
  if (!result.output) throw new ArgumentError('--output is required');
  const extension = extname(result.output).slice(1).toLowerCase();
  result.format ??= extension;
  if (result.format === 'png' && !pngExporter)
    throw new ArgumentError('Standalone kit supports JSON and SVG; use the project CLI for PNG');
  if (!['json', 'svg', ...(pngExporter ? ['png'] : [])].includes(result.format))
    throw new ArgumentError('Use --format ' + (pngExporter ? 'json, svg or png' : 'json or svg'));
  if (result.output === '-' && result.format === 'png') throw new ArgumentError('PNG requires a file output');
  if (extension && extension !== result.format) throw new ArgumentError('Output extension must match format');
  if (result.scale !== undefined) {
    result.scale = Number(result.scale);
    if (result.format !== 'png' || !Number.isFinite(result.scale) || result.scale <= 0)
      throw new ArgumentError('--scale must be positive and requires PNG');
  }
  return result;
}
/** Shared CLI; the project wrapper injects Sharp, which never enters the standalone bundle. */
export async function main(values = process.argv.slice(2), options = {}) {
  if (values.length === 1 && ['--help', '-h'].includes(values[0])) {
    console.log(usage(options));
    return;
  }
  if (values.length === 1 && values[0] === '--version') {
    console.log(KIT_VERSION);
    return;
  }
  let config,
    stage = 'arguments';
  try {
    config = args(values, options.pngExporter);
    stage = 'read';
    if (config.input !== '-' && config.output && config.output !== '-') {
      const a = await realpath(config.input),
        b = await realpath(config.output).catch(() => resolve(config.output));
      if (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
        throw new ArgumentError('Output must not overwrite input');
    }
    let input = '';
    if (config.input === '-') {
      for await (const chunk of process.stdin) input += chunk;
    } else input = await readFile(config.input, 'utf8');
    stage = 'parse';
    const document = documentFor(input, config.inputFormat);
    stage = 'validation';
    createFlowchartModel(document);
    if (config.check) {
      if (config.diagnostics === 'json')
        console.error(JSON.stringify({ ok: true, stage: 'validation', kitVersion: KIT_VERSION }));
      else console.log('OK ' + config.input + ' (syntax and Flowchart semantics)');
      return;
    }
    const result = await convertFlowchart(document, {
      inputFormat: 'json',
      format: config.format === 'json' ? 'json' : 'svg',
    });
    if (result.warnings.length)
      console.error(JSON.stringify({ warnings: result.warnings, kitVersion: KIT_VERSION }));
    stage = 'export';
    if (config.output === '-') {
      process.stdout.write(result.text);
      return;
    }
    const destination = resolve(config.output);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = destination + '.' + randomUUID() + '.tmp';
    try {
      if (config.format === 'png')
        await options.pngExporter(result.text, temporary, { scale: config.scale ?? 1 });
      else await writeFile(temporary, result.text, 'utf8');
      await rename(temporary, destination);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  } catch (error) {
    const diagnostics =
      config?.diagnostics ??
      (values.includes('--diagnostics') && values[values.indexOf('--diagnostics') + 1] === 'json'
        ? 'json'
        : 'text');
    const info = {
      ok: false,
      stage: error.stage ?? stage,
      message: error.message,
      ...(error.path ? { path: error.path } : {}),
      ...(error.line ? { line: error.line, column: error.column } : {}),
      kitVersion: KIT_VERSION,
    };
    console.error(diagnostics === 'json' ? JSON.stringify(info) : `${info.stage}: ${info.message}`);
    process.exitCode = error instanceof ArgumentError ? 2 : 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
