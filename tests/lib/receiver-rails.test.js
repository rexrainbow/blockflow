import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagramModel } from '../../src/lib/blockchart/index.js';
import { separateReceiverRails } from '../../src/lib/blockchart/layout/receiver-rails.js';
import { netRouteQuality } from '../../src/lib/blockchart/layout/route-quality.js';
import { collinearOverlap, sectionSegments } from '../../src/lib/blockchart/layout/routing-geometry.js';
function fixture(rotation = 0) {
  const point = (p) => {
    let { x, y } = p;
    for (let i = 0; i < rotation; i++) [x, y] = [-y, x];
    return { x, y };
  };
  const box = (b) => {
    const p = point(b),
      q = point({ x: b.x + b.width, y: b.y + b.height });
    return {
      ...b,
      x: Math.min(p.x, q.x),
      y: Math.min(p.y, q.y),
      width: Math.abs(q.x - p.x),
      height: Math.abs(q.y - p.y),
    };
  };
  const side = (value) => {
    const sides = ['right', 'bottom', 'left', 'top'];
    return sides[(sides.indexOf(value) + rotation) % 4];
  };
  const model = createDiagramModel({
    version: 1,
    diagram: { name: 'Receiver rails' },
    modules: [
      { id: 'Input', ports: [{ id: 'out', direction: 'output' }] },
      { id: 'Controller', ports: [{ id: 'out', direction: 'output' }] },
      {
        id: 'Receiver',
        ports: [
          { id: 'data', direction: 'input', side: side('left') },
          { id: 'sample', direction: 'input', side: side('left') },
        ],
      },
    ],
    groups: [{ id: 'G', members: ['Receiver'] }],
    connections: [
      { from: 'Input.out', to: ['Receiver.data'] },
      { from: 'Controller.out', to: ['Receiver.sample'] },
    ],
  });
  const sections = (lists) => lists.map((points) => ({ points: points.map(([x, y]) => point({ x, y })) }));
  const result = {
    modules: [
      {
        ...box({ id: 'Input', x: -40, y: 140, width: 40, height: 40 }),
        ports: [{ id: 'out', ...point({ x: 0, y: 156 }), side: side('right') }],
      },
      {
        ...box({ id: 'Controller', x: 200, y: 0, width: 20, height: 40 }),
        ports: [{ id: 'out', ...point({ x: 220, y: 20 }), side: side('right') }],
      },
      {
        ...box({ id: 'Receiver', x: 100, y: 100, width: 100, height: 100 }),
        ports: [
          { id: 'data', ...point({ x: 100, y: 140 }), side: side('left') },
          { id: 'sample', ...point({ x: 100, y: 164 }), side: side('left') },
        ],
      },
    ],
    groups: [box({ id: 'G', type: 'container', x: 78, y: 70, width: 169, height: 180 })],
    connections: [
      {
        id: model.connections[0].id,
        netId: 'Data',
        sections: sections([
          [
            [0, 156],
            [91, 156],
            [91, 140],
            [100, 140],
          ],
        ]),
      },
      {
        id: model.connections[1].id,
        netId: 'Clock',
        sections: sections([
          [
            [220, 20],
            [230, 20],
          ],
          [
            [230, 20],
            [250, 20],
          ],
          [
            [250, 20],
            [260, 20],
            [260, 90],
            [91, 90],
            [91, 164],
            [100, 164],
          ],
        ]),
      },
    ],
  };
  return { model, result, point, box };
}
const overlaps = (r) =>
  sectionSegments(r.connections[0].sections).some(([a, b]) =>
    sectionSegments(r.connections[1].sections).some(([c, d]) => collinearOverlap(a, b, c, d)),
  );
for (let rotation = 0; rotation < 4; rotation++)
  test(`distinct incoming Net rails separate without moving geometry (rotation ${rotation})`, () => {
    const { model, result } = fixture(rotation),
      before = structuredClone(result),
      modelBefore = structuredClone(model);
    assert.equal(overlaps(result), true);
    separateReceiverRails(result, model);
    assert.equal(overlaps(result), false);
    assert.deepEqual(result.modules, before.modules);
    assert.deepEqual(result.groups, before.groups);
    assert.deepEqual(model, modelBefore);
    assert.deepEqual(result.connections[0], before.connections[0]);
    const clock = result.connections[1],
      old = before.connections[1];
    assert.deepEqual(clock.sections.slice(0, -1), old.sections.slice(0, -1));
    assert.deepEqual(clock.sections.at(-1).points.slice(0, -3), old.sections.at(-1).points.slice(0, -3));
    assert.deepEqual(clock.sections.at(-1).points.at(-1), old.sections.at(-1).points.at(-1));
    assert.equal(clock.routingInfo.receiverRail, 'separated');
    assert.equal(netRouteQuality(result).overlaps, 0);
    // One ordinary crossing replaces an ambiguous shared rail, without two new crossings.
    assert.equal(netRouteQuality(result).crossings, 1);
    const once = structuredClone(result);
    separateReceiverRails(result, model);
    assert.deepEqual(result, once);
  });
test('same Net branches may share an approach rail', () => {
  const { model, result } = fixture();
  result.connections[1].netId = result.connections[0].netId;
  const before = structuredClone(result);
  separateReceiverRails(result, model);
  assert.deepEqual(result, before);
});
test('a clear incoming route and explicit reserved channels remain unchanged', () => {
  const { model, result } = fixture();
  result.connections[0].routingInfo = { method: 'group-channel', channelStatus: 'routed', channelTrack: 0 };
  const reserved = structuredClone(result.connections[0]);
  separateReceiverRails(result, model);
  assert.deepEqual(result.connections[0], reserved);
  assert.equal(overlaps(result), false);
  const one = fixture();
  one.result.connections.pop();
  const before = structuredClone(one.result);
  separateReceiverRails(one.result, one.model);
  assert.deepEqual(one.result, before);
});
test('no safe free corridor keeps the original valid routes', () => {
  const { model, result, box } = fixture();
  result.modules.push({ ...box({ id: 'Obstacle', x: 58, y: 90, width: 29, height: 120 }), ports: [] });
  const before = structuredClone(result);
  separateReceiverRails(result, model);
  assert.deepEqual(result, before);
});
test('pinned receiver label and containing scope prevent unsafe relocation', () => {
  for (const label of [false, true]) {
    const { model, result } = fixture();
    if (label) result.connections[1].signalEndLabel = { bounds: { x: 58, y: 90, width: 29, height: 120 } };
    else {
      model.connections.forEach((e) => (e.scope = 'Limit'));
      result.groups.push({ id: 'Limit', x: 90, y: 0, width: 180, height: 200 });
    }
    const before = structuredClone(result);
    separateReceiverRails(result, model);
    assert.deepEqual(result, before);
  }
});
test('receiver repair cannot pull a departure bend inside its source Container', () => {
  const { model, result } = fixture();
  result.connections[1].routingInfo = { channelStatus: 'routed' };
  const data = result.connections[0],
    target = result.modules.find((n) => n.id === 'Receiver'),
    input = result.modules.find((n) => n.id === 'Input');
  input.y = 110;
  input.ports[0].y = 124;
  target.ports.find((p) => p.id === 'data').y = 180;
  data.sections = [
    {
      points: [
        { x: 0, y: 124 },
        { x: 91, y: 124 },
        { x: 91, y: 180 },
        { x: 100, y: 180 },
      ],
    },
  ];
  model.groups.push({ id: 'SourceFrame', members: ['Input'] });
  result.groups.push({ id: 'SourceFrame', type: 'container', x: -50, y: 110, width: 135, height: 30 });
  const before = structuredClone(result);
  separateReceiverRails(result, model);
  assert.deepEqual(result, before);
});
test('Boundary Containers keep their protected receiver paths', () => {
  const { model, result } = fixture();
  result.groups[0].portMode = 'boundary';
  const before = structuredClone(result);
  separateReceiverRails(result, model);
  assert.deepEqual(result, before);
});
for (let rotation = 0; rotation < 4; rotation++)
  test(`close receiver frame gains clearance without changing geometry (${rotation})`, () => {
    const { model, result, box } = fixture(rotation);
    result.groups[0] = box({ id: 'G', type: 'container', x: 87, y: 70, width: 160, height: 180 });
    const before = structuredClone(result);
    separateReceiverRails(result, model);
    assert.equal(overlaps(result), false);
    assert.deepEqual(result.modules, before.modules);
    assert.deepEqual(result.groups, before.groups);
    // Undo rotation to measure the physical distance from the original left frame.
    const undo = (p) => {
      let { x, y } = p;
      for (let i = 0; i < rotation; i++) [x, y] = [y, -x];
      return { x, y };
    };
    for (const edge of result.connections) {
      const rail = undo(edge.sections.at(-1).points.at(-2));
      assert.ok(Math.abs(rail.x - 87) >= 12 - 1e-6);
    }
  });
test('close same-Net approaches retain their shared rail', () => {
  const { model, result } = fixture();
  result.groups[0].x = 87;
  result.groups[0].width = 160;
  result.connections[1].netId = result.connections[0].netId;
  const before = structuredClone(result);
  separateReceiverRails(result, model);
  assert.deepEqual(result, before);
});
test('ordinary local scope can borrow a free corridor within its ordinary parent', () => {
  const { model, result } = fixture();
  model.groups.push({
    id: 'Outer',
    type: 'container',
    portMode: 'direct',
    members: ['G', 'Input', 'Controller'],
  });
  result.groups.push({
    id: 'Outer',
    type: 'container',
    portMode: 'direct',
    x: -60,
    y: -10,
    width: 350,
    height: 280,
  });
  model.connections.forEach((e) => (e.scope = 'G'));
  result.groups[0].x = 87;
  result.groups[0].width = 160;
  const before = structuredClone({ modules: result.modules, groups: result.groups });
  separateReceiverRails(result, model);
  assert.equal(overlaps(result), false);
  assert.deepEqual({ modules: result.modules, groups: result.groups }, before);
  assert.ok(result.connections[1].sections.at(-1).points.at(-2).x <= 75);
});
