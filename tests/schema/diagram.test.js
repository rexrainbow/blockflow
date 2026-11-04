import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import { createDiagramModel } from '../../src/lib/model.js';
import { TEXT_STYLE, BLOCK_STYLE, connectionStyle } from '../../src/lib/styles.js';

const root = new URL('../../', import.meta.url);
const schema = JSON.parse(await readFile(new URL('schema/blockflow.schema.json', root), 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const minimal = JSON.parse(await readFile(new URL('examples/agent-minimal.json', root), 'utf8'));
const run = promisify(execFile);
const cli = fileURLToPath(new URL('scripts/validate-diagram.js', root));

test('every JSON example satisfies the schema and authoritative model without mutation', async () => {
  const files = (await readdir(new URL('examples/', root))).filter((file) => file.endsWith('.json'));
  assert.ok(files.length >= 14);
  for (const file of files) {
    const input = JSON.parse(await readFile(new URL(`examples/${file}`, root), 'utf8'));
    const before = structuredClone(input);
    assert.equal(validate(input), true, `${file}: ${JSON.stringify(validate.errors)}`);
    createDiagramModel(input);
    assert.deepEqual(input, before);
  }
});

test('guide JSON is executable and matches the copyable minimal example', async () => {
  const guide = await readFile(new URL('docs/agent-guide.md', root), 'utf8');
  const examples = [...guide.matchAll(/```json\s*([\s\S]*?)```/g)];
  assert.equal(examples.length, 1);
  const input = JSON.parse(examples[0][1]);
  assert.deepEqual(input, minimal);
  assert.equal(validate(input), true);
  createDiagramModel(input);
});

test('schema style keys cover exactly the portable library style surface', () => {
  const keys = (definition) => Object.keys(schema.$defs[definition].properties).sort();
  assert.deepEqual(keys('textStyle'), Object.keys(TEXT_STYLE).sort());
  assert.deepEqual(keys('connectionStyle'), [...Object.keys(connectionStyle(1)), 'label'].sort());
  assert.deepEqual(
    keys('moduleStyle'),
    [...Object.keys(BLOCK_STYLE), 'label', 'portLabel', 'inputPortLabel', 'outputPortLabel'].sort(),
  );
});

test('schema and library reject malformed fields, unknown properties and unsupported styles', () => {
  const mutations = [
    (d) => {
      d.$schema = 'urn:any';
    },
    (d) => {
      d.version = 2;
    },
    (d) => {
      delete d.diagram;
    },
    (d) => {
      d.modules = [];
    },
    (d) => {
      d.modules[0].ports = [];
    },
    (d) => {
      d.modules[0].id = 'Source\n';
    },
    (d) => {
      d.modules[0].id = 'bad.key';
    },
    (d) => {
      d.diagram.name = ' \ufeff ';
    },
    (d) => {
      d.diagram.name = 'two\nlines';
    },
    (d) => {
      d.diagram.name = '\ud800';
    },
    (d) => {
      d.modules[0].label = null;
    },
    (d) => {
      d.modules[0].ports[0].width = null;
    },
    (d) => {
      d.modules[0].ports[0].width = 1.5;
    },
    (d) => {
      d.modules[0].ports[0].width = 9007199254740992;
    },
    (d) => {
      d.modules[0].ports[0].direction = 'inout';
    },
    (d) => {
      d.modules[0].ports[0].label = 'bad\tlabel';
    },
    (d) => {
      d.connections[0].from = 'Source.data\n';
    },
    (d) => {
      d.connections[0].order = -1;
    },
    (d) => {
      d.connections[0].alignment = 'true';
    },
    (d) => {
      d.connections[0].style = { strokeColor: '#fff\n' };
    },
    (d) => {
      d.connections[0].style = { strokeWidth: 0 };
    },
    (d) => {
      d.connections[0].style = { opacity: 1.01 };
    },
    (d) => {
      d.modules[0].style = { label: { fontSize: 0 } };
    },
    (d) => {
      d.modules[0].style = { portLabel: { padding: -1 } };
    },
    (d) => {
      d.modules[0].style = { fillColor: 'red' };
    },
    (d) => {
      d.modules[0].style = { label: { fontFamily: 'Arial' } };
    },
    (d) => {
      d.layout.alignmentGroups = [];
    },
    (d) => {
      d.layout.routing = 'spline';
    },
    (d) => {
      d.layout.layerSpacing = 0;
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const input = structuredClone(minimal);
    mutate(input);
    assert.equal(validate(input), false, `schema mutation ${index}`);
    assert.throws(
      () => createDiagramModel(input),
      { name: 'DiagramValidationError' },
      `model mutation ${index}`,
    );
  }
});

test('schema accepts Unicode, inherited styles and all library layout option values', () => {
  for (const placement of ['default', 'relaxed', 'simple']) {
    const input = structuredClone(minimal);
    input.diagram.name = '時脈 🚀';
    input.layout.placement = placement;
    input.modules[0].style = {
      label: { color: '#AbCf', padding: 0, opacity: 0 },
      outputPortLabel: { backgroundColor: 'transparent' },
    };
    assert.equal(validate(input), true, JSON.stringify(validate.errors));
    createDiagramModel(input);
  }
});

test('cross-object mistakes pass structural schema but fail authoritative model validation', () => {
  const mutations = [
    (d) => {
      d.modules[1].id = 'Source';
    },
    (d) => {
      d.modules[0].ports.push({ ...d.modules[0].ports[0] });
    },
    (d) => {
      d.connections[0].to = 'Missing.data';
    },
    (d) => {
      d.connections[0].from = 'Sink.data';
    },
    (d) => {
      d.connections.push({ ...d.connections[0] });
    },
    (d) => {
      d.modules[0].ports.push({ id: 'other', direction: 'output' });
      d.connections.push({ from: 'Source.other', to: 'Sink.data' });
    },
    (d) => {
      d.modules[0].ports[0].width = 8;
      d.modules[1].ports[0].width = 16;
    },
    (d) => {
      d.layout.direction = 'left';
      d.layout.feedbackRouting = 'outer';
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const input = structuredClone(minimal);
    mutate(input);
    assert.equal(validate(input), true, `schema semantic case ${index}: ${JSON.stringify(validate.errors)}`);
    assert.throws(() => createDiagramModel(input), { name: 'DiagramValidationError' });
  }
});

test('CLI validates batches read-only, renders SVG, and protects input on errors', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'blockflow-schema-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const source = join(folder, 'input with spaces.json');
  const invalid = join(folder, 'invalid.json');
  const output = join(folder, 'nested', 'diagram.svg');
  const original = JSON.stringify(minimal);
  await writeFile(source, original);
  const { stdout } = await run(process.execPath, [cli, source, '--svg', output]);
  assert.match(stdout, /model, layout and SVG/);
  assert.match(await readFile(output, 'utf8'), /<svg\b/);
  assert.equal(await readFile(source, 'utf8'), original);
  const input = structuredClone(minimal);
  input.connections[0].to = 'Missing.data';
  await writeFile(invalid, JSON.stringify(input));
  await assert.rejects(run(process.execPath, [cli, invalid, source]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /validation: connections\[0\]\.to: Unknown port/);
    assert.match(error.stdout, /OK .*input with spaces/);
    return true;
  });
  const previousSvg = await readFile(output, 'utf8');
  await assert.rejects(run(process.execPath, [cli, invalid, '--svg', output]), { code: 1 });
  assert.equal(await readFile(output, 'utf8'), previousSvg);
  await assert.rejects(run(process.execPath, [cli, source, '--svg', source]), { code: 2 });
  assert.equal(await readFile(source, 'utf8'), original);
  await writeFile(invalid, '{broken');
  await assert.rejects(
    run(process.execPath, [cli, invalid]),
    (error) => error.code === 1 && /JSON:/.test(error.stderr),
  );
  await assert.rejects(run(process.execPath, [cli]), { code: 2 });
  await assert.rejects(run(process.execPath, [cli, source, '--svg']), { code: 2 });
  assert.match((await run(process.execPath, [cli, '--help'])).stdout, /Usage:/);
});

test('feedback schema accepts only booleans and omitted feedback remains valid', () => {
  for (const value of [undefined, false, true, null, 0, 10, 'true', [], {}]) {
    const input = structuredClone(minimal);
    if (value !== undefined) input.connections[0].feedback = value;
    const valid = value === undefined || typeof value === 'boolean';
    assert.equal(validate(input), valid, JSON.stringify(value));
    if (valid) assert.equal(createDiagramModel(input).connections[0].feedback, value ?? false);
    else assert.throws(() => createDiagramModel(input));
  }
});

test('groups schema covers structure/styles; membership and shared IDs use model validation', () => {
  const d = structuredClone(minimal);
  const member = d.modules[0].id;
  d.groups = [
    { id: 'group_1', members: [member], style: { label: { fontSize: 18 }, borderStyle: 'dotted' } },
  ];
  assert.equal(validate(d), true);
  createDiagramModel(d);
  for (const change of [
    (d) => {
      d.groups = {};
    },
    (d) => {
      d.groups[0].children = [];
    },
    (d) => {
      d.groups[0].members = [1];
    },
    (d) => {
      d.groups[0].style.portLabel = { unknown: 1 };
    },
  ]) {
    const raw = structuredClone(d);
    change(raw);
    assert.equal(validate(raw), false);
    assert.throws(() => createDiagramModel(raw));
  }
  const unknown = structuredClone(d);
  unknown.groups[0].members = ['missing'];
  assert.equal(validate(unknown), true);
  assert.throws(() => createDiagramModel(unknown));
});

test('schema permits group-only documents and rejects a completely empty graph', () => {
  const input = {
    version: 1,
    diagram: { name: 'Empty group' },
    modules: [],
    groups: [{ id: 'g', members: [] }],
  };
  assert.equal(validate(input), true);
  createDiagramModel(input);
  input.groups = [];
  assert.equal(validate(input), false);
  assert.throws(() => createDiagramModel(input));
});

test('schema accepts nested group references; model rejects group cycles and multiple parents', () => {
  const d = structuredClone(minimal);
  d.groups = [
    { id: 'child', members: [d.modules[0].id] },
    { id: 'parent', members: ['child'] },
  ];
  assert.equal(validate(d), true);
  createDiagramModel(d);
  d.groups[0].members.push('parent');
  assert.equal(validate(d), true);
  assert.throws(() => createDiagramModel(d), /cycle/);
});
