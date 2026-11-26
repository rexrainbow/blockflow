import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { applyStoryOps } from '../../src/lib/story/edit.js';
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
  waveformIndex,
  wiresForPort,
} from '../../src/lib/story/model.js';

// The Story editor's own test diagram: terminals at both ends, a group and a shared fan-out.
const example = async (name = 'signal-path.json') =>
  JSON.parse(await readFile(new URL(`../fixtures/story/${name}`, import.meta.url), 'utf8'));
const laidOut = async (name) => {
  const layout = await layoutDiagram(createDiagramModel(await example(name)));
  return { layout, svg: renderSvg(layout) };
};

test('parseStory accepts the format, fills defaults and normalizes wire references', () => {
  const story = parseStory({
    title: 'Demo',
    chapters: [
      {
        title: 'TX',
        steps: [{ title: 'One', hops: [{ wires: ['A.out->B.in'] }], notes: [{ module: 'A', text: 'hi' }] }],
      },
    ],
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
  assert.throws(
    () => parseStory({ chapters: [{ steps: [{ hops: [{ kind: 'pulse', wires: [] }] }] }] }),
    /chapters\[0\]\.steps\[0\]\.hops\[0\]\.kind/,
  );
  assert.throws(
    () => parseStory({ chapters: [{ steps: [{ camera: 'near' }] }] }),
    /camera: must be "all" or "step"/,
  );
});

test('parseWave requires a period, bits and rows with perBit or tick', () => {
  assert.deepEqual(
    parseWave({ period: 8, bits: [1, 0], rows: [{ name: 'out', perBit: { 1: [[0, 4]] } }] }).period,
    8,
  );
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
  assert.deepEqual(index.wires['Controller.start -> Serializer.start'], {
    from: 'Controller.start',
    to: 'Serializer.start',
  });
  assert.deepEqual(Object.keys(index.modules).sort(), [
    '@terminal:Clock',
    '@terminal:Pad',
    'Controller',
    'FIFO',
    'Serializer',
    'Source',
    'Timer',
  ]);
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
  assert.deepEqual(ownersOf({ 'data-endpoints': 'not json', 'data-from': 'A.o', 'data-to': 'B.i' }), [
    { from: 'A.o', to: 'B.i' },
  ]);
});

test('storyProblems lists references the rendered diagram lacks', async () => {
  const { layout, svg } = await laidOut();
  const index = svgIndex(svg);
  const [ref] = Object.keys(index.wires);
  const story = emptyStory('t');
  story.chapters[0].steps[0].hops = [{ kind: 'event', wires: [ref, 'Gone.out -> Nowhere.in'] }];
  story.chapters[0].steps[0].notes = [
    { module: 'Missing', text: '' },
    { module: layout.modules[0].id, text: '' },
  ];
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
  const story = parseStory({
    chapters: [{ steps: [{ title: 'a' }, { title: 'b' }] }, { steps: [] }, { steps: [{ title: 'c' }] }],
  });
  assert.deepEqual(
    flatSteps(story).map(({ ci, si, step }) => `${ci}.${si}.${step.title}`),
    ['0.0.a', '0.1.b', '2.0.c'],
  );
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
  const story = {
    format: 'blockflow-story',
    title: 'T </script> <b>',
    chapters: [{ title: 'C', steps: [] }],
  };
  const inline = (v) => JSON.stringify(v).replaceAll('<', String.fromCharCode(92) + 'u003c'); // as the exporter writes it
  const html = `<html><body><script type="application/json" id="pv-data">{}</script>
<script type="application/json" id="${SOURCES_ID}">${inline({ diagram, story })}</script><script>x()</script></body></html>`;
  const read = readPresentationSources(html);
  assert.deepEqual(read.diagram, diagram);
  assert.equal(read.story.title, 'T </script> <b>');
  assert.throws(() => readPresentationSources('<html></html>'), /has no editable sources/);
  assert.throws(
    () =>
      readPresentationSources(
        `<script id="${SOURCES_ID}">{"diagram":{"nodes":[]},"story":{"chapters":[]}}</script>`,
      ),
    /must be a Block diagram/,
  );
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

test('normalized Stories satisfy the distributed schema, including edited chapters, notes and waves', async () => {
  const schema = JSON.parse(await readFile(new URL('../../schema/story.schema.json', import.meta.url)));
  const waveformSchema = JSON.parse(
    await readFile(new URL('../../schema/waveform.schema.json', import.meta.url)),
  );
  const validate = new Ajv2020({ strict: false }).addSchema(waveformSchema).compile(schema);
  const story = parseStory(await example('signal-path.story.json'));
  const { svg } = await laidOut();
  const index = svgIndex(svg),
    saved = structuredClone(story);
  const result = applyStoryOps(
    story,
    [
      { op: 'add', path: '/chapters/-', value: { title: 'New', steps: [] } },
      { op: 'move', from: '/chapters/0/steps/0', path: '/chapters/2/steps/-' },
      { op: 'replace', path: '/chapters/2/steps/0/title', value: 'Moved' },
      { op: 'add', path: '/chapters/2/steps/0/notes', value: [{ module: '@terminal:Pad', text: 'Pin' }] },
      {
        op: 'add',
        path: '/chapters/2/waveform',
        value: story.chapters[0].waveform,
      },
      { op: 'remove', path: '/chapters/1/steps/0/hops/0/badge' },
    ],
    index,
  );
  assert.deepEqual(story, saved);
  assert.equal(result.document.chapters[2].steps[0].title, 'Moved');
  assert.deepEqual(result.problems, []);
  assert.equal(validate(result.document), true, JSON.stringify(validate.errors));
  for (const invalid of [
    [
      { op: 'replace', path: '/title', value: 'Changed' },
      { op: 'remove', path: '/chapters/99' },
    ],
    [{ op: 'add', path: '/chapters/0/steps/0/typo', value: 'x' }],
    [{ op: 'add', path: '/__proto__/polluted', value: true }],
    [{ op: 'replace', path: '/chapters/0/steps/0/hops/0/wires/0', value: 'Gone.o->Nowhere.i' }],
  ]) {
    assert.throws(() => applyStoryOps(story, invalid, index));
    assert.deepEqual(story, saved);
  }
  const allowed = applyStoryOps(
    story,
    [{ op: 'add', path: '/chapters/0/steps/0/notes', value: [{ module: 'constructor', text: 'missing' }] }],
    index,
    { allowMissing: true },
  );
  assert.deepEqual(allowed.problems, [{ ci: 0, si: 0, type: 'module', ref: 'constructor' }]);
  assert.equal({}.polluted, undefined);
});

test('Story numeric/version errors include paths and parsed wave data is owned', () => {
  assert.throws(() => parseStory({ version: 2, chapters: [] }), /version/);
  for (const wave of [
    { period: Infinity, bits: [0], rows: [] },
    { period: 8, bits: [2], rows: [] },
    { period: 8, bits: [0], rows: [{ name: 'x', tick: NaN }] },
    { period: 8, bits: [0], rows: [{ name: 'x', perBit: { '*': [[0, Infinity]] } }] },
  ])
    assert.throws(() => parseWave(wave), /wave\./);
  const wave = { period: 8, bits: [0], rows: [{ name: 'x', perBit: { '*': [[0, 1]] } }] };
  const parsed = parseWave(wave);
  parsed.bits[0] = 1;
  parsed.rows[0].perBit['*'][0][0] = 2;
  assert.equal(wave.bits[0], 0);
  assert.equal(wave.rows[0].perBit['*'][0][0], 0);
});

test('Stories embed normalized owned waveforms and drop unvalidated legacy strips', async () => {
  const raw = await example('signal-path.story.json'),
    saved = structuredClone(raw);
  const parsed = parseStory(raw);
  assert.equal(parsed.chapters[0].waveform.grid.offset, 0);
  assert.deepEqual(parseStory(parsed), parsed);
  parsed.chapters[0].waveform.signals[0].changes[1][0] = 3;
  assert.deepEqual(raw, saved);
  const legacy = parseStory({ chapters: [{ wave: 'malformed old format', steps: [{ wave: 123 }] }] });
  assert.equal(legacy.chapters[0].wave, undefined);
  assert.equal(legacy.chapters[0].steps[0].wave, undefined);
  raw.chapters[0].waveform.signals[0].width = 0;
  assert.throws(
    () => parseStory(raw),
    (e) => e.path === 'chapters[0].waveform.signals[0].width',
  );
  raw.chapters[0].waveform = { ...saved.chapters[0].waveform, typo: true };
  assert.throws(
    () => parseStory(raw),
    (e) => e.path === 'chapters[0].waveform.typo',
  );
  raw.chapters[0].waveform = saved.chapters[0].waveform;
  raw.chapters[0].steps[0].waveform.from = 0.5;
  assert.throws(() => parseStory(raw), /steps\[0\].waveform.from/);
});

test('Story waveform problems retain missing focus references and invalid windows', async () => {
  const story = parseStory(await example('signal-path.story.json'));
  const index = svgIndex((await laidOut()).svg);
  story.chapters[0].steps[0].waveform = {
    from: -1,
    to: 17,
    signals: ['absent'],
    links: ['gone -> edge'],
    markers: ['missing'],
  };
  story.chapters[1].steps[0].waveform = {};
  assert.deepEqual(storyProblems(story, index), [
    { ci: 0, si: 0, type: 'window', ref: '-1 -> 17' },
    { ci: 0, si: 0, type: 'signal', ref: 'absent' },
    { ci: 0, si: 0, type: 'link', ref: 'gone -> edge' },
    { ci: 0, si: 0, type: 'marker', ref: 'missing' },
    { ci: 1, si: 0, type: 'waveform', ref: 'waveform' },
  ]);
  for (const focus of [{ from: 8, to: 8 }, { from: 9, to: 2 }, { from: 17 }, { to: 0 }]) {
    story.chapters[0].steps[0].waveform = focus;
    assert.equal(storyProblems(story, index)[0].type, 'window');
  }
  const missing = parseStory(await example('signal-path-missing.story.json'));
  assert.deepEqual(storyProblems(missing, index), [{ ci: 0, si: 0, type: 'signal', ref: 'removed_signal' }]);
});

test('Story waveform presentation carries SVG geometry and fan-out port associations', async () => {
  const story = parseStory(await example('signal-path.story.json')),
    saved = structuredClone(story);
  const { svg } = await laidOut(),
    index = svgIndex(svg);
  story.chapters.push(structuredClone(story.chapters[0]));
  const data = presentationData({ svg, story });
  const view = data.chapters[0].waveformView;
  assert.match(view.svg, /data-signal="tick"/);
  assert.match(view.svg, /data-link="timer_tick -&gt; start_edge"/);
  assert.match(view.svg, /data-marker="packet"/);
  assert.match(view.svg, /blockflow-story-waveform-0/);
  assert.match(data.chapters[2].waveformView.svg, /blockflow-story-waveform-2/);
  assert.notEqual(view.svg, data.chapters[2].waveformView.svg);
  assert.equal(view.left + (1 - view.from) * view.pixelsPerTick, 184);
  assert.equal(view.lanes.tick, 92);
  const { layoutWaveform } = await import('../../src/lib/waveform/index.js');
  assert.equal(view.lanes.start, layoutWaveform(story.chapters[0].waveform).lanes[1].y);
  assert.ok(view.lanes.start > view.lanes.tick + 56, 'gutter growth reaches Story geometry');
  assert.deepEqual(view.portWires.start, [
    { from: 'Controller.start', to: 'FIFO.start' },
    { from: 'Controller.start', to: 'Serializer.start' },
  ]);
  assert.deepEqual(wiresForPort(index, 'FIFO.start'), [{ from: 'Controller.start', to: 'FIFO.start' }]);
  assert.deepEqual(wiresForPort(index, 'Gone.port'), []);
  assert.deepEqual(data.problems, []);
  const identities = waveformIndex(story.chapters[0].waveform);
  assert.deepEqual(identities.edges, [
    { id: 'timer_tick', signal: 'tick', t: 1 },
    { id: 'start_edge', signal: 'start', t: 2 },
  ]);
  data.chapters[0].waveform.signals[0].label = 'Changed';
  assert.deepEqual(story.chapters[0], saved.chapters[0]);
});

test('Story waveform edits validate the final batch and roll back field/reference errors', async () => {
  const story = parseStory(await example('signal-path.story.json')),
    saved = structuredClone(story);
  const index = svgIndex((await laidOut()).svg);
  const batch = [
    { op: 'replace', path: '/chapters/0/waveform/signals/0/id', value: 'clock' },
    { op: 'replace', path: '/chapters/0/steps/0/waveform/signals/0', value: 'clock' },
    { op: 'replace', path: '/chapters/0/steps/1/waveform/links/0', value: 'timer_tick->start_edge' },
  ];
  const edited = applyStoryOps(story, batch, index);
  assert.equal(edited.document.chapters[0].waveform.signals[0].id, 'clock');
  assert.equal(edited.document.chapters[0].steps[1].waveform.links[0], 'timer_tick -> start_edge');
  for (const op of [
    { op: 'add', path: '/chapters/0/waveform/typo', value: 1 },
    { op: 'add', path: '/chapters/0/steps/0/waveform/typo', value: 1 },
    { op: 'replace', path: '/chapters/0/waveform/signals/0/changes/1/0', value: 0 },
  ])
    assert.throws(() => applyStoryOps(story, [op], index), /After ops\[0\]/);
  assert.throws(() => applyStoryOps(story, batch.slice(0, 1), index), /signal tick/);
  const draft = applyStoryOps(story, batch.slice(0, 1), index, { allowMissing: true });
  assert.equal(draft.problems[0].type, 'signal');
  assert.deepEqual(story, saved);
});
