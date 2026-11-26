import { readFile, realpath, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createDiagramModel, layoutDiagram, renderSvg } from '../lib/blockchart/index.js';
import {
  parseStory,
  svgIndex,
  storyProblems,
  presentationData,
  readPresentationSources,
  applyStoryOps,
  diagramFingerprint,
  waveformIndex,
} from '../lib/story/index.js';
import { presentationHtml } from '../story/export.js';
import { parse, replaceDocument } from './edit-file.js';

export * from '../lib/story/index.js';
export const KIT_VERSION = typeof __STORY_KIT_VERSION__ === 'string' ? __STORY_KIT_VERSION__ : 'development';

export async function inspectStory(diagram, story) {
  diagram = structuredClone(diagram);
  const parsed = story === undefined ? undefined : parseStory(story);
  const svg = renderSvg(await layoutDiagram(createDiagramModel(diagram)));
  const index = svgIndex(svg);
  const fingerprint = await diagramFingerprint(diagram);
  return {
    ...index,
    fingerprint,
    ...(parsed
      ? {
          story: parsed,
          waveforms: parsed.chapters.map((chapter, ci) => ({
            ci,
            ...(chapter.waveform
              ? waveformIndex(chapter.waveform)
              : { signals: [], edges: [], links: [], markers: [] }),
          })),
          problems: storyProblems(parsed, index),
          fingerprintMatches: parsed.diagram?.sha256 ? parsed.diagram.sha256 === fingerprint : null,
        }
      : {}),
  };
}

export async function checkStory(diagram, story) {
  return (await inspectStory(diagram, parseStory(story))).problems;
}

export async function editStory(diagram, story, operations, options) {
  const input = structuredClone(story),
    batch = structuredClone(operations),
    settings = structuredClone(options);
  return applyStoryOps(input, batch, await inspectStory(diagram), settings);
}

export async function exportStory(diagram, value) {
  diagram = structuredClone(diagram);
  const story = parseStory(value);
  const svg = renderSvg(await layoutDiagram(createDiagramModel(diagram)));
  return presentationHtml(presentationData({ svg, story }), { diagram, story });
}

async function output(file, text, inputs) {
  await mkdir(dirname(resolve(file)), { recursive: true });
  const target = await realpath(file).catch((error) => {
    if (error.code === 'ENOENT') return resolve(file);
    throw error;
  });
  const same = (path) => (process.platform === 'win32' ? path.toLowerCase() : path);
  if (inputs.some((input) => same(input) === same(target)))
    throw new Error('Output must differ from source files: ' + file);
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
  node story-edit.mjs inspect diagram.json [story.json]
  node story-edit.mjs check diagram.json story.json
  node story-edit.mjs edit diagram.json story.json --ops ops.json [--allow-missing] [--write]
  node story-edit.mjs export diagram.json story.json -o out.html
  node story-edit.mjs extract out.html
  node story-edit.mjs --help | --version
edit prints {diff, problems}; --write atomically replaces a validated Story.
--ops - reads operations from stdin. Missing references require --allow-missing.`;

async function main(args) {
  if (args.length === 1 && ['--help', '--version', '-h'].includes(args[0])) {
    console.log(args[0] === '--version' ? KIT_VERSION : help);
    return;
  }
  const [command, ...rest] = args;
  if (!['inspect', 'check', 'edit', 'export', 'extract'].includes(command)) throw new Error(help);
  const options =
    command === 'edit'
      ? { ops: { type: 'string' }, write: { type: 'boolean' }, 'allow-missing': { type: 'boolean' } }
      : command === 'export'
        ? { output: { type: 'string', short: 'o' } }
        : {};
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options });
  const expected = command === 'extract' ? [1] : command === 'inspect' ? [1, 2] : [2];
  if (!expected.includes(positionals.length)) throw new Error('Unexpected filenames\n' + help);
  const files = await Promise.all(positionals.map((file) => realpath(file)));
  if (command === 'extract') {
    console.log(JSON.stringify(readPresentationSources(await readFile(files[0], 'utf8')), null, 2));
    return;
  }
  const diagram = parse(await readFile(files[0], 'utf8'), positionals[0]);
  const original = files[1] ? await readFile(files[1], 'utf8') : null;
  const story = original === null ? undefined : parse(original, positionals[1]);
  let result;
  if (command === 'inspect') result = await inspectStory(diagram, story);
  if (command === 'check') {
    result = await checkStory(diagram, story);
    if (result.length) process.exitCode = 1;
  }
  if (command === 'edit') {
    if (!values.ops) throw new Error('edit requires --ops FILE or --ops -');
    let text = '';
    if (values.ops === '-') {
      process.stdin.setEncoding('utf8');
      for await (const chunk of process.stdin) text += chunk;
    } else text = await readFile(values.ops, 'utf8');
    const applied = await editStory(diagram, story, parse(text, values.ops), {
      allowMissing: values['allow-missing'] ?? false,
    });
    if (values.write && applied.diff.length) await replaceDocument(files[1], original, applied.document);
    result = { diff: applied.diff, problems: applied.problems };
  }
  if (command === 'export') {
    if (!values.output) throw new Error('export requires -o FILE');
    await output(values.output, await exportStory(diagram, story), files);
    result = { output: values.output };
  }
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
