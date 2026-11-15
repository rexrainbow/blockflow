import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDiagramModel, DiagramValidationError, layoutDiagram } from '../../src/lib/index.js';
import { routeOuterFeedback } from '../../src/lib/blockchart/layout/outer-feedback.js';
import { measureLayout } from '../../examples/metrics.js';
import { checkLayout, freeze, fixture } from './helpers.js';

const load = async (name) =>
  JSON.parse(await readFile(new URL(`../../examples/${name}.json`, import.meta.url), 'utf8'));

for (const name of ['feedback', 'stress']) {
  test(`${name}: exterior feedback, unchanged geometry and native other routes`, async () => {
    const input = await load(`placement-${name}`);
    const before = structuredClone(input);
    const nativeModel = createDiagramModel(freeze(input));
    const outerModel = createDiagramModel({
      ...input,
      layout: { ...input.layout, feedbackRouting: 'outer' },
    });
    const native = await layoutDiagram(freeze(nativeModel));
    const outer = await layoutDiagram(freeze(outerModel));
    assert.deepEqual(input, before);
    checkLayout(outerModel, outer);
    const dx = outer.modules[0].x - native.modules[0].x;
    const dy = outer.modules[0].y - native.modules[0].y;
    for (const [i, node] of outer.modules.entries()) {
      const old = native.modules[i];
      assert.equal(node.x - old.x, dx);
      assert.equal(node.y - old.y, dy);
      assert.equal(node.width, old.width);
      assert.equal(node.height, old.height);
    }
    const ref = outerModel.connections.find((c) => c.source.moduleId === 'D' && c.target.moduleId === 'A');
    const feedback = outer.connections.find((c) => c.id === ref.id);
    assert.equal(feedback.routingInfo.method, 'outer-aabb');
    const points = feedback.sections[0].points;
    assert.deepEqual(points.slice(2, 4), feedback.routingInfo.waypoints);
    assert.ok(points[1].x > points[0].x && points.at(-1).x > points.at(-2).x);
    const waypoints = feedback.routingInfo.waypoints;
    assert.ok(waypoints[0].x > Math.max(...outer.modules.map((n) => n.x + n.width)));
    assert.ok(waypoints[1].x < Math.min(...outer.modules.map((n) => n.x)));
    assert.equal(waypoints[0].y, waypoints[1].y);
    assert.ok(
      feedback.routingInfo.side === 'top'
        ? waypoints[0].y < Math.min(...outer.modules.map((n) => n.y))
        : waypoints[0].y > Math.max(...outer.modules.map((n) => n.y + n.height)),
    );
    assert.equal(measureLayout(outer).edges.find((c) => c.id === ref.id).bends, 4);
    for (const connection of outer.connections.filter((c) => c.id !== ref.id)) {
      const adjusted = connection.sections.map((s) => ({
        points: s.points.map((p) => ({ x: p.x - dx, y: p.y - dy })),
      }));
      assert.deepEqual(adjusted, native.connections.find((c) => c.id === connection.id).sections);
    }
  });
}

test('switch off preserves baseline; forward-only graph is unchanged with switch on', async () => {
  const input = await load('placement-branch');
  const baseline = await layoutDiagram(createDiagramModel(input));
  input.layout.feedbackRouting = 'elk';
  assert.deepEqual(await layoutDiagram(createDiagramModel(input)), baseline);
  input.layout.feedbackRouting = 'outer';
  assert.deepEqual(await layoutDiagram(createDiagramModel(input)), baseline);
});

test('margin and independent lanes apply to multiple feedback routes', async () => {
  const input = fixture();
  input.modules[0].ports.push({ id: 'i2', direction: 'input' });
  input.modules[1].ports.push({ id: 'o2', direction: 'output' });
  input.connections.push(
    { from: 'b.o', to: ['a.i'], feedback: true },
    { from: 'b.o2', to: ['a.i2'], feedback: true },
  );
  input.layout = { feedbackRouting: 'outer', feedbackMargin: 30, feedbackLaneSpacing: 18 };
  const model = createDiagramModel(input),
    layout = await layoutDiagram(model);
  checkLayout(model, layout);
  const routes = layout.connections.filter((c) => c.routingInfo?.method === 'outer-aabb');
  assert.equal(routes.length, 2);
  assert.deepEqual(
    routes.map((c) => c.routingInfo.clearance),
    [30, 48],
  );
  assert.notDeepEqual(routes[0].routingInfo.waypoints, routes[1].routingInfo.waypoints);
});

test('bottom is preferred when equal-bend exterior route is shorter', () => {
  const modules = [
    {
      id: 'a',
      x: 0,
      y: 0,
      width: 140,
      height: 132,
      ports: [
        { id: 'o', x: 140, y: 108 },
        { id: 'i', x: 0, y: 108 },
      ],
    },
  ];
  const connection = {
    id: 'loop',
    sections: [
      {
        points: [
          { x: 140, y: 108 },
          { x: 160, y: 108 },
          { x: 160, y: -20 },
          { x: -20, y: -20 },
          { x: -20, y: 108 },
          { x: 0, y: 108 },
        ],
      },
    ],
  };
  routeOuterFeedback(
    { modules, connections: [connection] },
    {
      layout: {},
      connections: [
        { id: 'loop', source: { moduleId: 'a', portId: 'o' }, target: { moduleId: 'a', portId: 'i' } },
      ],
    },
  );
  assert.equal(connection.routingInfo.side, 'bottom');
  assert.equal(connection.routingInfo.waypoints[0].y, 152);
});

test('blocked endpoint access explicitly falls back without crossing modules', () => {
  const modules = [
    { id: 's', x: 0, y: 0, width: 100, height: 100, ports: [{ id: 'o', x: 100, y: 50 }] },
    { id: 'blocker', x: 110, y: 0, width: 80, height: 100, ports: [] },
    { id: 't', x: 0, y: 200, width: 100, height: 100, ports: [{ id: 'i', x: 0, y: 250 }] },
  ];
  const sections = [
    {
      points: [
        { x: 100, y: 50 },
        { x: 105, y: 50 },
        { x: 105, y: 110 },
        { x: -20, y: 110 },
        { x: -20, y: 250 },
        { x: 0, y: 250 },
      ],
    },
  ];
  const connection = { id: 'back', sections: structuredClone(sections) };
  routeOuterFeedback(
    { modules, connections: [connection] },
    {
      layout: {},
      connections: [
        { id: 'back', source: { moduleId: 's', portId: 'o' }, target: { moduleId: 't', portId: 'i' } },
      ],
    },
  );
  assert.equal(connection.routingInfo.method, 'elk');
  assert.equal(connection.routingInfo.reason, 'outer-access-blocked');
  assert.deepEqual(connection.sections, sections);
});

for (const [key, value] of [
  ['feedbackRouting', null],
  ['feedbackRouting', true],
  ['feedbackRouting', 'outside'],
  ['feedbackMargin', 0],
  ['feedbackMargin', Infinity],
  ['feedbackLaneSpacing', -1],
  ['feedbackLaneSpacing', '12'],
]) {
  test(`reject ${key}=${value}`, () => {
    const input = fixture();
    input.layout = { [key]: value };
    assert.throws(
      () => createDiagramModel(input),
      (error) => error instanceof DiagramValidationError && error.path === `layout.${key}`,
    );
  });
}

test('left exterior routing is rejected', () => {
  const input = fixture();
  input.layout = { direction: 'left', feedbackRouting: 'outer' };
  assert.throws(
    () => createDiagramModel(input),
    (error) => error.path === 'layout.direction',
  );
});

for (const direction of ['right', 'down'])
  test(`Outer feedback crosses ordinary Container headings with reserved Net names (${direction})`, async () => {
    const raw = {
      version: 1,
      diagram: { name: 'Return bus in a Container', style: { module: { portLabel: { hidden: true } } } },
      layout: { direction, feedbackRouting: 'elk', feedbackSide: direction === 'down' ? 'right' : 'bottom' },
      modules: ['A', 'B'].map((id) => ({
        id,
        label: id === 'A' ? 'Source selector' : 'Result logic',
        ports: [
          { id: 'in', direction: 'input' },
          { id: 'out', direction: 'output' },
        ],
      })),
      groups: [
        {
          id: 'Frame',
          type: 'container',
          label: 'A deliberately long descriptive heading\nReturn signals may cross this title',
          members: ['A', 'B'],
        },
      ],
      connections: [
        { from: 'A.out', to: ['B.in'] },
        {
          from: 'B.out',
          to: [{ endpoint: 'A.in', feedback: true, constraint: false }],
          label: 'Shared result',
          style: { label: { repeatAtEnd: 'always' } },
        },
      ],
    };
    const native = await layoutDiagram(createDiagramModel(raw));
    raw.layout.feedbackRouting = 'outer';
    const authored = structuredClone(raw),
      model = createDiagramModel(freeze(raw)),
      saved = structuredClone(model);
    const result = await layoutDiagram(freeze(model));
    const ref = result.connections.find((e) => e.target.moduleId === 'A');
    assert.equal(ref.routingInfo.method, 'outer-aabb');
    assert.equal(ref.routingInfo.side, raw.layout.feedbackSide);
    assert.ok(ref.labelInstances.some((label) => label.role === 'start'));
    assert.ok(ref.labelInstances.some((label) => label.role === 'end'));
    assert.equal(result.warnings, undefined);
    assert.deepEqual(raw, authored);
    assert.deepEqual(model, saved);
    const frame = result.groups.find((g) => g.id === 'Frame'),
      waypoints = ref.routingInfo.waypoints;
    assert.ok(
      direction === 'down'
        ? waypoints.every((p) => p.x > frame.x + frame.width)
        : waypoints.every((p) => p.y > frame.y + frame.height),
    );
    const oldAnchor = native.modules[0],
      anchor = result.modules[0];
    const dx = anchor.x - oldAnchor.x,
      dy = anchor.y - oldAnchor.y;
    for (const node of result.modules) {
      const old = native.modules.find((n) => n.id === node.id);
      assert.ok(Math.abs(node.x - old.x - dx) < 1e-6 && Math.abs(node.y - old.y - dy) < 1e-6);
      assert.equal(node.width, old.width);
      assert.equal(node.height, old.height);
    }
    assert.deepEqual(
      result.connections
        .filter((e) => e.id !== ref.id)
        .map((e) => e.sections.map((s) => ({ points: s.points.map((p) => ({ x: p.x - dx, y: p.y - dy })) }))),
      native.connections.filter((e) => e.id !== ref.id).map((e) => e.sections),
    );
  });

for (const labelNode of [false, true])
  test(`ancestor frame access still rejects an actual ${labelNode ? 'signal label' : 'hardware'} blocker`, () => {
    const modules = [
      { id: 's', x: 0, y: 0, width: 100, height: 100, ports: [{ id: 'o', x: 100, y: 50 }] },
      {
        id: 'blocker',
        x: 110,
        y: 0,
        width: 80,
        height: 100,
        ports: [],
        ...(labelNode ? { _signalSize: { width: 80, height: 100 } } : {}),
      },
      { id: 't', x: 0, y: 200, width: 100, height: 100, ports: [{ id: 'i', x: 0, y: 250 }] },
    ];
    const frame = {
      id: 'Frame',
      type: 'container',
      portMode: 'direct',
      members: modules.map((n) => n.id),
      blockIds: modules.map((n) => n.id),
      x: -10,
      y: -10,
      width: 220,
      height: 330,
      ports: [],
      labelBounds: { x: 0, y: 0, width: 100, height: 20 },
    };
    const sections = [
      {
        points: [
          { x: 100, y: 50 },
          { x: 105, y: 50 },
          { x: 105, y: 110 },
          { x: -20, y: 110 },
          { x: -20, y: 250 },
          { x: 0, y: 250 },
        ],
      },
    ];
    const edge = { id: 'back', sections: structuredClone(sections) };
    routeOuterFeedback(
      { modules, groups: [frame], connections: [edge] },
      {
        layout: {},
        connections: [
          { id: 'back', source: { moduleId: 's', portId: 'o' }, target: { moduleId: 't', portId: 'i' } },
        ],
      },
    );
    assert.equal(edge.routingInfo.reason, 'outer-access-blocked');
    assert.deepEqual(edge.sections, sections);
  });

for (const kind of ['ordinary', 'boundary', 'collapsed'])
  test(`Down endpoint access crosses an ordinary heading while retaining ${kind} frame rules`, () => {
    const modules = [
      {
        id: 's',
        x: 40,
        y: 100,
        width: 50,
        height: 40,
        ports: [{ id: 'out', x: 65, y: 140, side: 'bottom' }],
        labelBounds: { x: 40, y: 100, width: 0, height: 0 },
      },
      {
        id: 't',
        x: 40,
        y: 40,
        width: 50,
        height: 40,
        ports: [{ id: 'in', x: 65, y: 40, side: 'top' }],
        labelBounds: { x: 40, y: 40, width: 0, height: 0 },
      },
    ];
    const frame = {
      id: 'Frame',
      type: 'container',
      portMode: kind === 'boundary' ? 'boundary' : 'direct',
      collapsed: kind === 'collapsed',
      members: ['s', 't'],
      blockIds: ['s', 't'],
      ports: [],
      x: 0,
      y: 0,
      width: 160,
      height: 200,
      labelBounds: { x: 10, y: 5, width: 140, height: 20 },
    };
    const edge = {
      id: 'back',
      sections: [
        {
          points: [
            { x: 65, y: 140 },
            { x: 110, y: 140 },
            { x: 110, y: 30 },
            { x: 65, y: 30 },
            { x: 65, y: 40 },
          ],
        },
      ],
    };
    const before = structuredClone(edge.sections);
    routeOuterFeedback(
      { modules, groups: [frame], connections: [edge] },
      {
        layout: { direction: 'down', feedbackSide: 'right' },
        connections: [
          { id: 'back', source: { moduleId: 's', portId: 'out' }, target: { moduleId: 't', portId: 'in' } },
        ],
      },
    );
    if (kind === 'ordinary') {
      assert.equal(edge.routingInfo.method, 'outer-aabb');
      assert.equal(edge.routingInfo.side, 'right');
    } else {
      assert.equal(edge.routingInfo.reason, 'outer-access-blocked');
      assert.deepEqual(edge.sections, before);
    }
  });
