import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { moduleGeometry } from '../../src/lib/blockchart/geometry.js';
import { copyLayout } from '../../src/lib/blockchart/view/layout.js';

const schema = JSON.parse(
  await readFile(new URL('../../schema/blockchart.schema.json', import.meta.url), 'utf8'),
);
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
const sample = (direction) => ({
  version: 1,
  diagram: { name: 'Fixed concat' },
  layout: { direction },
  modules: [
    {
      id: 'C',
      type: 'concat',
      label: 'Composition name',
      ports: [
        { id: 'first', direction: 'input' },
        { id: 'second', direction: 'input' },
        { id: 'out', direction: 'output' },
      ],
    },
  ],
});
const overlap = (a, b) =>
  a.x < b.x + b.width - 1e-6 &&
  a.x + a.width > b.x + 1e-6 &&
  a.y < b.y + b.height - 1e-6 &&
  a.y + a.height > b.y + 1e-6;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

for (const direction of ['right', 'down']) {
  test(`Concat sides and appearance validate consistently (${direction})`, () => {
    const raw = sample(direction),
      expected = direction === 'down' ? ['top', 'top', 'bottom'] : ['left', 'left', 'right'];
    assert.equal(validate(raw), true);
    assert.deepEqual(
      createDiagramModel(raw).modules[0].ports.map((p) => p.side),
      expected,
    );
    for (const [i, side] of expected.entries()) {
      raw.modules[0].ports[i].side = side;
      assert.equal(validate(raw), true);
      assert.doesNotThrow(() => createDiagramModel(raw));
      for (const wrong of ['top', 'bottom', 'left', 'right'].filter((s) => s !== side)) {
        raw.modules[0].ports[i].side = wrong;
        assert.equal(validate(raw), false);
        assert.throws(
          () => createDiagramModel(raw),
          (e) => e.path === `modules[0].ports[${i}].side`,
        );
      }
      delete raw.modules[0].ports[i].side;
    }
    for (const type of ['rectangle', 'stacked', 'trapezoid']) {
      raw.modules[0].appearance = { type };
      assert.equal(validate(raw), false);
      assert.throws(
        () => createDiagramModel(raw),
        (e) => e.path === 'modules[0].appearance',
      );
    }
    raw.modules[0].appearance = { type: 'bar' };
    assert.equal(validate(raw), true);
    assert.doesNotThrow(() => createDiagramModel(raw));
    delete raw.modules[0].type;
    raw.modules[0].ports[0].side = 'bottom';
    assert.equal(validate(raw), true);
    assert.doesNotThrow(() => createDiagramModel(raw), 'ordinary bar has no Concat side restriction');
  });

  for (const hidden of [false, true])
    test(`Thin body reserves external text without mutation (${direction}, hidden=${hidden})`, async () => {
      const raw = sample(direction);
      raw.modules[0].style = { label: { hidden }, portLabel: { hidden } };
      const before = structuredClone(raw),
        model = createDiagramModel(raw),
        geometry = moduleGeometry(model.modules[0], direction);
      const body = geometry.body.shapes[0];
      near((direction === 'down' ? body.height : body.width) + model.modules[0].style.borderWidth, 12);
      const layout = await layoutDiagram(model),
        node = layout.modules[0];
      const rect = { ...body, x: node.x + body.x, y: node.y + body.y };
      const inputs = node.ports.filter((p) => p.direction === 'input'),
        output = node.ports.find((p) => p.direction === 'output');
      near(
        output[direction === 'down' ? 'x' : 'y'],
        (inputs[0][direction === 'down' ? 'x' : 'y'] + inputs[1][direction === 'down' ? 'x' : 'y']) / 2,
      );
      if (!hidden) {
        for (const text of [node.labelBounds, ...node.ports.map((p) => p.labelBounds)])
          assert.ok(!overlap(text, rect), 'text lies outside bar');
      }
      assert.deepEqual(copyLayout(layout), layout);
      assert.deepEqual(raw, before);
      assert.match(renderSvg(layout), /data-appearance="bar"/);
      raw.modules[0].width = 4;
      raw.modules[0].height = 4;
      const sized = await layoutDiagram(createDiagramModel(raw));
      assert.ok(sized.modules[0].width >= 560 && sized.modules[0].height >= 336);
      near(
        (direction === 'down'
          ? sized.modules[0].body.shapes[0].height
          : sized.modules[0].body.shapes[0].width) + 1,
        12,
      );
    });

  test(`Feedback enters the normal input face and repeated labels cannot thicken Concat (${direction})`, async () => {
    const raw = JSON.parse(
      await readFile(new URL('../../examples/concat-feedback.json', import.meta.url), 'utf8'),
    );
    raw.layout.direction = direction;
    for (const e of raw.connections) {
      e.style ??= {};
      e.style.label = { repeatAtEnd: 'always' };
    }
    {
      assert.equal(validate(raw), true);
      const model = createDiagramModel(raw),
        before = structuredClone(model),
        layout = await layoutDiagram(model);
      assert.equal(layout.warnings, undefined, JSON.stringify(layout.warnings));
      const concat = layout.modules.find((n) => n.type === 'concat'),
        body = concat.body.shapes[0];
      near((direction === 'down' ? body.height : body.width) + concat.style.borderWidth, 12);
      assert.ok(
        concat.ports
          .filter((p) => p.direction === 'input')
          .every((p) => p.side === (direction === 'down' ? 'top' : 'left')),
      );
      const feedback = layout.connections.find((e) => e.feedback);
      const port = concat.ports.find((p) => p.id === 'prior'),
        end = feedback.sections.at(-1).points.at(-1);
      near(end.x, port.x);
      near(end.y, port.y);
      assert.ok(layout.connections.every((e) => e.labelInstances?.some((l) => l.role === 'end')));
      assert.deepEqual(copyLayout(layout), layout);
      assert.deepEqual(model, before);
    }
  });
}
