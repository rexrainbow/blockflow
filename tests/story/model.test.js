import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/blockchart/index.js';
import {
  STORY_FORMAT,
  emptyStory,
  flatSteps,
  parseStory,
  parseWave,
  ownersOf,
  presentationData,
  storyProblems,
  svgIndex,
  viewOf,
  isStoryFile,
  readPresentationSources,
  diagramFingerprint,
  SOURCES_ID,
} from '../../src/story/model.js';
import { openInStoryEditor, receiveHandoff } from '../../src/story/handoff.js';

// The Story editor's own test diagram: terminals at both ends, a group and a shared fan-out.
const example = async (name = 'signal-path.json') => JSON.parse(await readFile(new URL(`../fixtures/story/${name}`, import.meta.url), 'utf8'));
const laidOut = async (name) => {
  const layout = await layoutDiagram(createDiagramModel(await example(name)));
  return { layout, svg: renderSvg(layout) };
};

test('parseStory accepts the format, fills defaults and normalizes wire references', () => {
  const story = parseStory({
    title: 'Demo',
    chapters: [{ title: 'TX', steps: [{ title: 'One', hops: [{ wires: ['A.out->B.in'] }], notes: [{ module: 'A', text: 'hi' }] }] }],
  });
  assert.equal(story.format, STORY_FORMAT);
  assert.equal(story.chapters[0].steps[0].body, '');
  assert.deepEqual(story.chapters[0].steps[0].hops, [{ kind: 'event', wires: ['A.out -> B.in'] }]);
  assert.deepEqual(story.chapters[0].steps[0].notes, [{ module: 'A', text: 'hi' }]);
  assert.deepEqual(parseStory(story), story, 'a parsed story parses to itself');
});

test('parseStory errors name the field', () => {
  assert.throws(() => parseStory({ chapters: 'x' }), /chapters: must be a list/);
  assert.throws(() => parseStory({ format: 'other', chapters: [] }), /format: must be "blockflow-story"/);
  assert.throws(() => parseStory({ chapters: [{ steps: [{ hops: [{ kind: 'pulse', wires: [] }] }] }] }), /chapters\[0\]\.steps\[0\]\.hops\[0\]\.kind/);
  assert.throws(() => parseStory({ chapters: [{ steps: [{ camera: 'near' }] }] }), /camera: must be "all" or "step"/);
});

test('parseWave requires a period, bits and rows with perBit or tick', () => {
  assert.deepEqual(parseWave({ period: 8, bits: [1, 0], rows: [{ name: 'out', perBit: { 1: [[0, 4]] } }] }).period, 8);
  assert.throws(() => parseWave({ period: 0, bits: [1], rows: [] }), /period/);
  assert.throws(() => parseWave({ period: 8, bits: [], rows: [] }), /bits: needs at least one bit/);
  assert.throws(() => parseWave({ period: 8, bits: [1], rows: [{ name: 'x' }] }), /needs perBit or tick/);
});

test('svgIndex reads wires and blocks from the runtime SVG identity metadata', async () => {
  const { svg } = await laidOut();
  const index = svgIndex(svg);
  // Every branch by its endpoint pair, including terminals and the later owner of the shared start trunk.
  assert.deepEqual(Object.keys(index.wires).sort(), [
    '@terminal:Clock -> Timer.clk',
    'Controller.start -> FIFO.start',
    'Controller.start -> Serializer.start',
    'FIFO.q -> Serializer.q',
    'Serializer.line -> @terminal:Pad',
    'Source.data -> FIFO.data',
    'Timer.tick -> Controller.tick',
  ]);
  assert.deepEqual(index.wires['Controller.start -> Serializer.start'], { from: 'Controller.start', to: 'Serializer.start' });
  assert.deepEqual(Object.keys(index.modules).sort(), ['@terminal:Clock', '@terminal:Pad', 'Controller', 'FIFO', 'Serializer', 'Source', 'Timer']);
  assert.equal(index.modules.Timer.label, 'Bit timer');
  assert.equal(index.modules['@terminal:Pad'].label, 'Pad');
});

test('the test story resolves completely against the test diagram', async () => {
  const { svg } = await laidOut();
  const story = parseStory(await example('signal-path.story.json'));
  assert.deepEqual(storyProblems(story, svgIndex(svg)), []);
  assert.equal(flatSteps(story).length, 5);
});

test('svgIndex lists every owner of a shared path and decodes escaped attributes', () => {
  const svg = `<svg viewBox="0 0 10 10"><path d="M0 0 L5 0" data-role="connection-path" data-from="A.o" data-to="B.i" data-endpoints="[{&quot;from&quot;:&quot;A.o&quot;,&quot;to&quot;:&quot;B.i&quot;},{&quot;from&quot;:&quot;A.o&quot;,&quot;to&quot;:&quot;@terminal:T1&quot;}]"/><path d="M5 0 L9 0" data-role="connection-label-leader" data-from="X.o" data-to="Y.i"/><rect data-role="block" data-module="A&amp;1" x="0" y="0" width="1" height="1"/><text data-role="block-label" data-module="A&amp;1"><tspan>Top</tspan><tspan>Second &lt;2&gt;</tspan></text><g data-role="terminal" data-terminal="T1"></g></svg>`;
  const index = svgIndex(svg);
  assert.deepEqual(Object.keys(index.wires), ['A.o -> B.i', 'A.o -> @terminal:T1'], 'leaders are not wires');
  assert.deepEqual(index.modules['A&1'], { label: 'Top\nSecond <2>' });
  assert.deepEqual(index.modules['@terminal:T1'], { label: 'T1' });
  assert.deepEqual(ownersOf({ 'data-from': 'A.o', 'data-to': 'B.i' }), [{ from: 'A.o', to: 'B.i' }]);
  assert.deepEqual(ownersOf({ 'data-endpoints': 'not json', 'data-from': 'A.o', 'data-to': 'B.i' }), [{ from: 'A.o', to: 'B.i' }]);
});

test('storyProblems lists references the rendered diagram lacks', async () => {
  const { layout, svg } = await laidOut();
  const index = svgIndex(svg);
  const [ref] = Object.keys(index.wires);
  const story = emptyStory('t');
  story.chapters[0].steps[0].hops = [{ kind: 'event', wires: [ref, 'Gone.out -> Nowhere.in'] }];
  story.chapters[0].steps[0].notes = [{ module: 'Missing', text: '' }, { module: layout.modules[0].id, text: '' }];
  assert.deepEqual(storyProblems(story, index), [
    { ci: 0, si: 0, type: 'wire', ref: 'Gone.out -> Nowhere.in' },
    { ci: 0, si: 0, type: 'module', ref: 'Missing' },
  ]);

  const data = presentationData({ svg, story });
  assert.deepEqual(data.view, viewOf(svg));
  assert.equal(data.svg, svg, 'the player gets the runtime SVG unchanged');
  assert.equal(data.modules, undefined, 'no layout geometry is passed');
  assert.notEqual(data.chapters, story.chapters, 'the player gets a copy');
});

test('flatSteps orders steps across chapters', () => {
  const story = parseStory({ chapters: [{ steps: [{ title: 'a' }, { title: 'b' }] }, { steps: [] }, { steps: [{ title: 'c' }] }] });
  assert.deepEqual(flatSteps(story).map(({ ci, si, step }) => `${ci}.${si}.${step.title}`), ['0.0.a', '0.1.b', '2.0.c']);
});

test('parseStory keeps the diagram reference and checks it', () => {
  const story = parseStory({ diagram: { name: 'D', sha256: 'abc' }, chapters: [] });
  assert.deepEqual(story.diagram, { name: 'D', sha256: 'abc' });
  assert.throws(() => parseStory({ diagram: 'D', chapters: [] }), /diagram: must be an object/);
  assert.equal(parseStory({ chapters: [] }).diagram, undefined);
});

test('isStoryFile tells a story from a diagram', () => {
  assert.equal(isStoryFile({ format: 'blockflow-story', chapters: [] }), true);
  assert.equal(isStoryFile({ chapters: [] }), true);
  assert.equal(isStoryFile({ modules: [], chapters: [] }), false);
  assert.equal(isStoryFile({ modules: [] }), false);
  assert.equal(isStoryFile([]), false);
});

test('readPresentationSources reads the sources block of an exported page', async () => {
  const diagram = await example();
  const story = { format: 'blockflow-story', title: 'T </script> <b>', chapters: [{ title: 'C', steps: [] }] };
  const inline = (v) => JSON.stringify(v).replaceAll('<', String.fromCharCode(92) + 'u003c'); // as the exporter writes it
  const html = `<html><body><script type="application/json" id="pv-data">{}</script>
<script type="application/json" id="${SOURCES_ID}">${inline({ diagram, story })}</script><script>x()</script></body></html>`;
  const read = readPresentationSources(html);
  assert.deepEqual(read.diagram, diagram);
  assert.equal(read.story.title, 'T </script> <b>');
  assert.throws(() => readPresentationSources('<html></html>'), /has no editable sources/);
  assert.throws(() => readPresentationSources(`<script id="${SOURCES_ID}">{"diagram":{"nodes":[]},"story":{"chapters":[]}}</script>`), /must be a Block diagram/);
  assert.throws(() => readPresentationSources(`<script id="${SOURCES_ID}">{oops</script>`), /not valid JSON/);
});

test('diagramFingerprint is stable and changes with the diagram', async () => {
  const a = await example();
  const b = structuredClone(a);
  assert.match(await diagramFingerprint(a), /^[0-9a-f]{16}$/);
  assert.equal(await diagramFingerprint(a), await diagramFingerprint(b));
  b.modules[0].label = 'changed';
  assert.notEqual(await diagramFingerprint(a), await diagramFingerprint(b));
});

// Minimal windows: message listeners, and postMessage delivering with the sender as `source`.
const fakeWindow = (href, extra = {}) => ({
  location: { href },
  listeners: new Set(),
  addEventListener(type, fn) {
    if (type === 'message') this.listeners.add(fn);
  },
  removeEventListener(type, fn) {
    if (type === 'message') this.listeners.delete(fn);
  },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  ...extra,
});
const deliver = (target, source, data) => queueMicrotask(() => [...target.listeners].forEach((fn) => fn({ source, data })));
const navigated = (type) => ({ getEntriesByType: () => [{ type }] });

test('the Studio hands its diagram to the Story editor tab it opened, once, by message', async () => {
  const studio = fakeWindow('http://host/app/index.html');
  const tab = fakeWindow('http://host/app/story.html', { performance: navigated('navigate') });
  // What each side holds for the other: the Studio the tab handle, the tab its opener.
  const tabHandle = { postMessage: (data) => deliver(tab, tab.opener, data) };
  tab.opener = { postMessage: (data) => deliver(studio, tabHandle, data) };
  const opened = [];
  studio.open = (url) => (opened.push(url), tabHandle);

  const message = { diagram: { modules: [] }, name: 'd.json' };
  assert.equal(openInStoryEditor(message, studio), true);
  assert.deepEqual(opened, ['http://host/app/story.html']);
  assert.equal(studio.listeners.size, 1, 'the Studio waits for the tab');
  assert.deepEqual(await receiveHandoff(tab), message);
  assert.equal(studio.listeners.size, 0, 'the Studio stops listening after the reply');
  assert.equal(tab.listeners.size, 0);

  assert.equal(openInStoryEditor(message, { ...studio, open: () => null }), false, 'a blocked tab is reported');
  assert.equal(await receiveHandoff(fakeWindow('x')), null, 'no opener: nothing to wait for');
  assert.equal(await receiveHandoff({ ...tab, performance: navigated('reload') }), null, 'a reload does not ask again');
  const silent = fakeWindow('x', { opener: { postMessage() {} } });
  assert.equal(await receiveHandoff(silent, 20), null, 'an opener that does not answer times out');
});
