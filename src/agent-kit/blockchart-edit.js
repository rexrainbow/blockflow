import { readFile, realpath, open, rename, unlink, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { inspectDiagram, applyDiagramOps } from '../lib/blockchart/edit.js';

export { inspectDiagram, applyDiagramOps };
export const KIT_VERSION =
  typeof __BLOCKCHART_KIT_VERSION__ === 'string' ? __BLOCKCHART_KIT_VERSION__ : 'development';
const help = `Usage:
  node blockchart-edit.mjs inspect diagram.json --module ID
  node blockchart-edit.mjs inspect diagram.json --group ID [--recursive]
  node blockchart-edit.mjs apply diagram.json --ops changes.json [--diff-format pointer|semantic] [--write]
  node blockchart-edit.mjs --help | --version
apply prints a JSON diff. Only --write replaces the diagram. Use --ops - to read operations from stdin.`;

function parse(text, name) {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (cause) {
    throw new Error(name + ': ' + cause.message, { cause });
  }
}

function encode(document, original) {
  const indent = original.match(/\n([ \t]+)"/)?.[1] ?? (original.includes('\n') ? 2 : undefined);
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  return (
    (original.startsWith('\uFEFF') ? '\uFEFF' : '') +
    JSON.stringify(document, null, indent).replaceAll('\n', eol) +
    (original.endsWith('\n') ? eol : '')
  );
}

async function replaceDocument(file, original, document) {
  const lock = file + '.blockflow-edit.lock';
  const guard = await open(lock, 'wx');
  try {
    const tmp = file + '.' + randomUUID() + '.tmp';
    const handle = await open(tmp, 'wx', (await stat(file)).mode);
    try {
      try {
        await handle.writeFile(encode(document, original), 'utf8');
      } finally {
        await handle.close();
      }
      if ((await readFile(file, 'utf8')) !== original)
        throw new Error('Diagram changed during apply: ' + file);
      await rename(tmp, file);
    } finally {
      await unlink(tmp).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
      });
    }
  } finally {
    await guard.close();
    await unlink(lock);
  }
}

async function main(args) {
  if (args.length === 1 && ['--help', '-h', '--version'].includes(args[0])) {
    console.log(args[0] === '--version' ? KIT_VERSION : help);
    return;
  }
  const [command, ...rest] = args;
  if (!['inspect', 'apply'].includes(command)) throw new Error(help);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options:
      command === 'inspect'
        ? { module: { type: 'string' }, group: { type: 'string' }, recursive: { type: 'boolean' } }
        : { ops: { type: 'string' }, write: { type: 'boolean' }, 'diff-format': { type: 'string' } },
  });
  if (positionals.length !== 1) throw new Error('Expected a single diagram filename');
  const file = await realpath(positionals[0]);
  const original = await readFile(file, 'utf8');
  const document = parse(original, file);
  let output;
  if (command === 'inspect') {
    output = inspectDiagram(document, {
      ...(values.module !== undefined && { moduleId: values.module }),
      ...(values.group !== undefined && { groupId: values.group }),
      ...(values.recursive && { recursive: true }),
    });
  } else {
    if (!values.ops) throw new Error('apply requires --ops FILE or --ops -');
    let text = '';
    if (values.ops === '-') {
      process.stdin.setEncoding('utf8');
      for await (const chunk of process.stdin) text += chunk;
    } else text = await readFile(values.ops, 'utf8');
    const result = applyDiagramOps(document, parse(text, values.ops), { diffFormat: values['diff-format'] });
    if (values.write && result.diff.length) await replaceDocument(file, original, result.document);
    output = result.diff;
  }
  console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.path ? error.path + ': ' + error.message : error.message);
    process.exitCode = 1;
  }
}
