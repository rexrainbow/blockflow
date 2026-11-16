import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { layoutFlowchart, renderFlowchartSvg } from '../../src/lib/flowchart/index.js';
import { labelTouchesEdge, placeEdgeLabels } from '../../src/lib/flowchart/layout/labels.js';

const order = JSON.parse(
  await readFile(new URL('../../examples/flowchart/order-approval.json', import.meta.url), 'utf8'),
);

// Independent axis-aligned intersection check on public geometry.
function hits(box, edge) {
  const pad = edge.style.strokeWidth / 2;
  return edge.sections.some(({ points }) =>
    points.slice(1).some((b, i) => {
      const a = points[i];
      return (
        Math.max(a.x, b.x) + pad > box.x &&
        Math.min(a.x, b.x) - pad < box.x + box.width &&
        Math.max(a.y, b.y) + pad > box.y &&
        Math.min(a.y, b.y) - pad < box.y + box.height
      );
    }),
  );
}

for (const direction of ['down', 'right', 'up', 'left']) {
  test(`Order approval conditions avoid other wires (${direction})`, async () => {
    const input = structuredClone(order);
    input.layout.direction = direction;
    const before = structuredClone(input);
    const result = await layoutFlowchart(input);
    for (const edge of result.edges.filter((e) => e.label !== undefined))
      for (const other of result.edges.filter((e) => e !== edge))
        assert.equal(hits(edge.labelBounds, other), false, `${edge.id} label intersects ${other.id}`);
    const expectedWarnings = { down: undefined, right: ['edge_8'], up: undefined, left: ['edge_5'] };
    assert.deepEqual(
      result.warnings?.map((w) => w.edgeId),
      expectedWarnings[direction],
    );
    const branches = result.edges.filter((e) => e.from === 'Valid');
    const junction = branches.find((e) => e.label === 'No').sections[0].points[1];
    for (const branch of branches) {
      assert.equal(hits(branch.labelBounds, branch), true, 'condition must overlay its own wire');
      const b = branch.labelBounds;
      assert.ok(
        Math.max(
          b.x - junction.x,
          junction.x - b.x - b.width,
          b.y - junction.y,
          junction.y - b.y - b.height,
        ) >=
          14 - 1e-6,
        'label must clear the junction by its full text box',
      );
    }
    assert.deepEqual(input, before);
    assert.deepEqual(await layoutFlowchart(input), result);
  });
}

const wire = (id, y, label) => ({
  id,
  ...(label === undefined ? {} : { label }),
  style: { fontSize: 11, strokeWidth: 1 },
  sections: [
    {
      points: [
        { x: 0, y },
        { x: 200, y },
      ],
    },
  ],
});
const crowded = () => [
  wire('owner', 100, 'Yes'),
  ...[wire('upper', 80), wire('lower', 120)].map((e) => ({ ...e, style: { ...e.style, strokeWidth: 40 } })),
];

test('local rerouting clears a label while keeping its owner path fixed', () => {
  const edges = crowded(),
    original = structuredClone(edges[0].sections);
  let trials = 0;
  const result = placeEdgeLabels({
    edges,
    nodes: [],
    groups: [],
    reroute(edge) {
      trials++;
      const [a, b] = edge.sections[0].points;
      const y = edge.id === 'upper' ? 40 : 160;
      return { ...edge, sections: [{ points: [a, { x: a.x, y }, { x: b.x, y }, b] }] };
    },
  });
  assert.ok(trials > 0);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(edges[0].sections, original);
  assert.equal(hits(edges[0].labelBounds, edges[0]), true);
  for (const edge of edges.slice(1)) assert.equal(hits(edges[0].labelBounds, edge), false);
});

test('failed local trials retain all routes and report wire-only overlap', () => {
  const edges = crowded(),
    original = edges.map((e) => structuredClone(e.sections));
  const result = placeEdgeLabels({ edges, nodes: [], groups: [], reroute: (edge) => edge });
  assert.deepEqual(
    edges.map((e) => e.sections),
    original,
  );
  assert.equal(result.warnings[0].code, 'FLOW_LABEL_OVERLAP');
  assert.equal(result.warnings[0].edgeId, 'owner');
});

test('wire clearance includes thick strokes', () => {
  const edge = wire('thick', 100);
  const box = { x: 30, y: 108, width: 30, height: 20 };
  assert.equal(labelTouchesEdge(box, edge), false);
  edge.style.strokeWidth = 16;
  assert.equal(labelTouchesEdge(box, edge), true);
});

for (const fontSize of [11, 24]) {
  test(`inline label clears a shared trunk and split at font size ${fontSize}`, () => {
    const owner = wire('owner', 0, 'Yes');
    owner.style.fontSize = fontSize;
    owner.sections = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 200 },
        ],
      },
    ];
    const branch = wire('branch', 0);
    branch.sections = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 40 },
          { x: 200, y: 40 },
        ],
      },
    ];
    const result = placeEdgeLabels({ edges: [owner, branch], nodes: [], groups: [] });
    assert.deepEqual(result.warnings, []);
    assert.equal(owner.labelPosition.x, 0);
    assert.ok(owner.labelBounds.y >= 40 + Math.max(14, fontSize));
    assert.equal(hits(owner.labelBounds, branch), false);
  });
}

test('a short wire reports the readable beside-wire fallback', () => {
  const edge = wire('short', 0, 'Yes');
  edge.sections[0].points[1].x = 40;
  const result = placeEdgeLabels({ edges: [edge], nodes: [], groups: [] });
  assert.equal(hits(edge.labelBounds, edge), false);
  assert.match(result.warnings[0].message, /placed beside its wire/);
});

test('inline text retains its configured background mask above the wire', async () => {
  const input = structuredClone(order);
  input.edges.find((e) => e.from === 'Valid' && e.label === 'Yes').style = {
    labelBackgroundColor: '#fff5d6',
  };
  const svg = renderFlowchartSvg(await layoutFlowchart(input));
  assert.match(svg, /<g data-role="flow-edge-label" data-id="edge_3"><rect[^>]*fill="#fff5d6"/);
  assert.ok(svg.indexOf('data-role="flow-edge-label"') > svg.lastIndexOf('data-role="flow-edge"'));
});

test('thick arrowheads reserve endpoint clearance before placing inline text', () => {
  const edge = wire('arrow', 0, 'Yes');
  edge.arrow = true;
  edge.style.strokeWidth = 12;
  const node = { x: 0, y: -2, width: 130, height: 4 };
  const result = placeEdgeLabels({ edges: [edge], nodes: [node], groups: [] });
  assert.equal(hits(edge.labelBounds, edge), false);
  assert.match(result.warnings[0].message, /placed beside its wire/);
});

test('Order approval left bypass reduces crossings and frees the inline Yes label', async () => {
  const result = await layoutFlowchart(order);
  const plain = structuredClone(order);
  const bypass = plain.edges.find((e) => e.from === 'OverLimit' && e.to === 'Fulfil');
  delete bypass.fromSide;
  delete bypass.toSide;
  const baseline = await layoutFlowchart(plain);
  const noBranch = (layout) => layout.edges.find((e) => e.from === 'OverLimit' && e.to === 'Fulfil');
  const parts = (edge) =>
    edge.sections.flatMap(({ points }) => points.slice(1).map((b, i) => [points[i], b]));
  const crossings = (layout) =>
    parts(noBranch(layout)).reduce(
      (sum, [a, b]) =>
        sum +
        layout.edges
          .filter((e) => e.from === 'Approved')
          .reduce(
            (n, edge) =>
              n +
              parts(edge).filter(([c, d]) => {
                const horizontal = Math.abs(a.y - b.y) < 1e-6,
                  otherHorizontal = Math.abs(c.y - d.y) < 1e-6;
                if (horizontal === otherHorizontal) return false;
                const h = horizontal ? [a, b] : [c, d],
                  v = horizontal ? [c, d] : [a, b];
                return (
                  v[0].x > Math.min(h[0].x, h[1].x) &&
                  v[0].x < Math.max(h[0].x, h[1].x) &&
                  h[0].y > Math.min(v[0].y, v[1].y) &&
                  h[0].y < Math.max(v[0].y, v[1].y)
                );
              }).length,
            0,
          ),
      0,
    );
  assert.ok(crossings(result) < crossings(baseline));
  assert.equal(crossings(result), 0);
  const no = noBranch(result),
    yes = result.edges.find((e) => e.from === 'OverLimit' && e.label === 'Yes');
  assert.equal(no.fromSide, 'left');
  assert.equal(no.toSide, 'left');
  assert.ok(
    Math.min(...no.sections[0].points.map((p) => p.x)) < result.nodes.find((n) => n.id === 'OverLimit').x,
  );
  assert.equal(hits(yes.labelBounds, yes), true);
  assert.equal(hits(yes.labelBounds, no), false);
  assert.equal(result.warnings, undefined);
});
