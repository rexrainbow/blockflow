import { readFile, mkdir, writeFile, rename, unlink, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createDiagramModel, layoutDiagram, renderSvg } from '../lib/blockchart/index.js';

export const KIT_VERSION =
  typeof __BLOCKCHART_KIT_VERSION__ === 'string' ? __BLOCKCHART_KIT_VERSION__ : 'development';

function staged(stage, operation) {
  try {
    return operation();
  } catch (error) {
    error.stage ??= stage;
    throw error;
  }
}

export function validateDiagram(document) {
  staged('validation', () => createDiagramModel(document));
  return { ok: true };
}

/** JSON output is the original authoring document, never a normalized model. */
export async function convertDiagram(document, options = {}) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => !['format', 'rootGroupId'].includes(key))
  )
    throw Object.assign(new TypeError('Only format and rootGroupId options are supported.'), {
      stage: 'arguments',
    });
  const format = options.format ?? 'svg';
  if (!['json', 'svg'].includes(format))
    throw Object.assign(new TypeError('Format must be json or svg.'), { stage: 'arguments' });
  if (
    options.rootGroupId !== undefined &&
    (format !== 'svg' || typeof options.rootGroupId !== 'string' || !options.rootGroupId)
  )
    throw Object.assign(new TypeError('rootGroupId requires SVG format and a non-empty group ID.'), {
      stage: 'arguments',
    });
  const model = staged('validation', () => createDiagramModel(document));
  if (format === 'json') return { format, text: JSON.stringify(document, null, 2) + '\n', warnings: [] };
  let layout;
  try {
    layout = await layoutDiagram(model, { rootGroupId: options.rootGroupId });
  } catch (error) {
    error.stage = 'layout';
    throw error;
  }
  return { format, text: staged('SVG', () => renderSvg(layout)) + '\n', warnings: layout.warnings ?? [] };
}

const usage = `blockchart-convert (Node.js 22.12+; no npm install or network required)
Usage:
  node blockchart-convert.mjs input.json --check [--diagnostics json]
  node blockchart-convert.mjs input.json --output output.svg [--view GroupID]
  node blockchart-convert.mjs input.json --output output.json
  node blockchart-convert.mjs - --output - --format svg
Options:
  --output PATH       Export .json or .svg; '-' writes data to stdout.
  --format json|svg   Optional for files; required for stdout. PNG is not supported.
  --check             Read-only semantic validation; no layout or output file.
  --view GroupID      SVG only: draw a group subtree after validating the full graph.
  --diagnostics MODE  text (default) or json; diagnostics always go to stderr.
  --version           Print the kit build ID.
  --help              Print this help.
Input '-' reads UTF-8 JSON from stdin. Exit codes: 0 success, 1 input/validation/layout/I/O
failure, 2 invalid arguments. Label-placement warnings do not fail conversion.`;

function argumentError(message) {
  throw Object.assign(new Error(message), { stage: 'arguments' });
}

function argumentsFor(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check') {
      if (result.check) argumentError('Duplicate --check.');
      result.check = true;
    } else if (['--output', '--format', '--view', '--diagnostics'].includes(arg)) {
      const key = {
        '--output': 'output',
        '--format': 'format',
        '--view': 'view',
        '--diagnostics': 'diagnostics',
      }[arg];
      if (result[key] !== undefined || !args[i + 1] || (args[i + 1].startsWith('-') && args[i + 1] !== '-'))
        argumentError('Missing or duplicate ' + arg + '.');
      result[key] = args[++i];
    } else if (arg !== '-' && arg.startsWith('-')) argumentError('Unknown option: ' + arg);
    else if (result.input !== undefined) argumentError('Supply exactly one input JSON file.');
    else result.input = arg;
  }
  if (!result.input) argumentError('Supply an input JSON file or -.');
  if (result.diagnostics && !['text', 'json'].includes(result.diagnostics))
    argumentError('Diagnostics must be text or json.');
  if (result.check) {
    if (result.output !== undefined || result.format !== undefined || result.view !== undefined)
      argumentError('--check cannot be combined with output, format or view.');
    return result;
  }
  if (!result.output) argumentError('Specify --output output.json or output.svg, or use --check.');
  const extension = extname(result.output).slice(1).toLowerCase();
  if (result.output !== '-' && !['json', 'svg'].includes(extension))
    argumentError('Output extension must be .json or .svg.');
  result.format ??= result.output === '-' ? undefined : extension;
  if (!['json', 'svg'].includes(result.format)) argumentError('Specify --format json or svg for stdout.');
  if (result.output !== '-' && result.format !== extension)
    argumentError('Output extension and format must match.');
  if (result.view !== undefined && result.format !== 'svg')
    argumentError('--view is supported only for SVG.');
  return result;
}

async function protectInput(input, output) {
  if (input === '-') return;
  const a = resolve(input),
    b = resolve(output);
  const canonical = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  if (canonical(a) === canonical(b)) throw new Error('Output must not overwrite the input JSON.');
  try {
    const [ar, br, as, bs] = await Promise.all([realpath(a), realpath(b), stat(a), stat(b)]);
    if (canonical(ar) === canonical(br) || (as.ino === bs.ino && as.dev === bs.dev))
      throw new Error('Output must not overwrite the input JSON (including aliases).');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function writeOutput(path, text, input) {
  await protectInput(input, path);
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  const temporary = output + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, output);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(usage + '\n');
    return;
  }
  if (args.length === 1 && args[0] === '--version') {
    process.stdout.write(KIT_VERSION + '\n');
    return;
  }
  const machine = args.some((arg, i) => arg === '--diagnostics' && args[i + 1] === 'json');
  let parsed,
    stage = 'arguments';
  const report = (result) => {
    if (machine) process.stderr.write(JSON.stringify({ ...result, kitVersion: KIT_VERSION }) + '\n');
    else {
      process.stderr.write(
        result.ok
          ? `OK ${result.input}${result.output ? ' -> ' + result.output : ' (validation)'}\n`
          : `${result.stage}${result.path ? ' ' + result.path : ''}: ${result.message}\n`,
      );
      for (const warning of result.warnings ?? [])
        process.stderr.write(`Warning ${warning.code}: ${warning.message}\n`);
    }
  };
  try {
    parsed = argumentsFor(args);
    stage = 'read';
    let source;
    if (parsed.input === '-') {
      process.stdin.setEncoding('utf8');
      source = '';
      for await (const chunk of process.stdin) source += chunk;
    } else source = await readFile(parsed.input, 'utf8');
    stage = 'JSON';
    const document = JSON.parse(source.replace(/^\uFEFF/, ''));
    if (parsed.check) {
      validateDiagram(document);
      report({ ok: true, stage: 'validation', input: parsed.input, warnings: [] });
      return;
    }
    const result = await convertDiagram(document, {
      format: parsed.format,
      ...(parsed.view !== undefined ? { rootGroupId: parsed.view } : {}),
    });
    stage = 'write';
    if (parsed.output === '-') process.stdout.write(result.text);
    else await writeOutput(parsed.output, result.text, parsed.input);
    report({
      ok: true,
      stage: 'export',
      input: parsed.input,
      output: parsed.output,
      format: result.format,
      warnings: result.warnings,
    });
  } catch (error) {
    const errorStage = error.stage ?? stage;
    report({
      ok: false,
      stage: errorStage,
      ...(parsed?.input ? { input: parsed.input } : {}),
      ...((error.path ?? error.cause?.path) ? { path: error.path ?? error.cause.path } : {}),
      message: error.message,
    });
    process.exitCode = errorStage === 'arguments' ? 2 : 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await main(process.argv.slice(2));
