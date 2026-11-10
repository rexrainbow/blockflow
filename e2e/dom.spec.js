import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { convertToBoundaryGroup } from '../src/editor/state/commands.js';
const file = new URL('../dist-dom/dom-viewer.html', import.meta.url).href;

test('DOM resolves diagram Text, Group and Terminal defaults with the shared renderer', async ({ page }) => {
  const raw = JSON.parse(await readFile(new URL('../examples/default-styles.json', import.meta.url), 'utf8'));
  const result = await page.evaluate(async (raw) => {
    const { view, createDiagramModel, layoutDiagram } = portsketchDemo;
    const layout = await layoutDiagram(createDiagramModel(raw));
    view.setLayout(layout, { fit: true });
    return {
      group: layout.groups[0].style.label.fontSize,
      terminal: layout.terminals[0].style.fontSize,
      caption: layout.caption.style.fontSize,
      port: layout.modules[0].ports[0].style.fontSize,
    };
  }, raw);
  expect(result).toEqual({ group: 16, terminal: 15, caption: 14, port: 12 });
  await expect(page.locator('svg text').filter({ hasText: 'Compute pipeline' }).first()).toHaveAttribute(
    'font-size',
    '16',
  );
});

test('DOM adjusted Port anchors retain activation and straight route endpoints', async ({ page }) => {
  const raw = JSON.parse(
    await readFile(new URL('../examples/port-adjustment.json', import.meta.url), 'utf8'),
  );
  const result = await page.evaluate(async (raw) => {
    const { view, createDiagramModel, layoutDiagram } = portsketchDemo;
    const layout = await layoutDiagram(createDiagramModel(raw));
    view.setLayout(layout, { fit: true });
    const port = layout.modules.find((n) => n.id === 'Processor').ports.find((p) => p.id === 'overlay_in'),
      edge = layout.connections[0];
    view.getElement('port', 'Processor.overlay_in').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const selected = view.selection;
    view
      .getElement('connection', 'OvlIn.out->Processor.overlay_in')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return {
      selected,
      connection: view.selection,
      tip: edge.sections.at(-1).points.at(-1),
      port,
      points: layout.connections.map((e) => e.sections.reduce((n, s) => n + s.points.length, 0)),
    };
  }, raw);
  expect(result.selected).toMatchObject({ type: 'port', ownerId: 'Processor', portId: 'overlay_in' });
  expect(result.connection).toMatchObject({ type: 'connection', netId: raw.connections[0].id });
  expect(result.tip.x).toBeCloseTo(result.port.x, 5);
  expect(result.tip.y).toBeCloseTo(result.port.y, 5);
  expect(result.points).toEqual([2, 2, 2, 2, 2, 2]);
});

test('Net DOM keeps branch identity and one source label without exposing layout helpers', async ({
  page,
}) => {
  const raw = JSON.parse(
    await readFile(new URL('../examples/net-bidirectional.json', import.meta.url), 'utf8'),
  );
  const result = await page.evaluate(async (raw) => {
    const { view, createDiagramModel, layoutDiagram } = portsketchDemo;
    const layout = await layoutDiagram(createDiagramModel(raw));
    view.setLayout(layout, { fit: true });
    const edge = layout.connections[1];
    const key = `${edge.source.moduleId}.${edge.source.portId}->${edge.target.moduleId}.${edge.target.portId}`;
    view.getElement('connection', key).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const selected = view.selection;
    const before = JSON.stringify(view.layout);
    const bad = structuredClone(layout);
    bad.connections[0].netStyle.strokeWidth = NaN;
    let rejected = false;
    try {
      view.setLayout(bad);
    } catch {
      rejected = true;
    }
    return {
      selected,
      rejected,
      unchanged: before === JSON.stringify(view.layout),
      ids: [...layout.modules, ...(layout.groups ?? [])].map((n) => n.id),
      netId: edge.netId,
    };
  }, raw);
  expect(result.selected).toMatchObject({ type: 'connection', netId: result.netId, branchIndex: 1 });
  expect(result.rejected).toBe(true);
  expect(result.unchanged).toBe(true);
  expect(result.ids.some((id) => id.startsWith('_signal_'))).toBe(false);
  await expect(page.locator('[data-role="connection-label"][data-label-position="start"]')).toHaveCount(1);
});

test('DOM end labels select their connection, masks are view-local and unsafe instances are atomic', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { view, createDiagramModel, layoutDiagram, mountDiagram } = portsketchDemo;
    const raw = {
      version: 1,
      diagram: { name: 'Two ends' },
      modules: [
        { id: 'A', ports: [{ id: 'out', direction: 'output' }] },
        { id: 'B', ports: [{ id: 'in', direction: 'input' }] },
      ],
      connections: [
        {
          from: 'A.out',
          to: ['B.in'],
          label: 'Bite',
          style: {
            label: {
              repeatAtEnd: 'always',
              backgroundColor: '#FFF9E6',
              padding: 4,
              borderColor: '#B38900',
              borderWidth: 0.8,
              borderRadius: 4,
            },
          },
        },
      ],
      layout: { direction: 'down', layerSpacing: 450 },
    };
    const layout = await layoutDiagram(createDiagramModel(raw));
    view.setLayout(layout, { fit: true });
    const before = view.layout;
    const bad = structuredClone(layout);
    bad.connections[0].labelInstances[1].bounds.x = NaN;
    let rejected = false;
    try {
      view.setLayout(bad);
    } catch {
      rejected = true;
    }
    const host = document.createElement('div');
    document.body.append(host);
    const second = mountDiagram(host, layout);
    const ids = [...document.querySelectorAll('mask')].map((n) => n.id);
    second.destroy();
    host.remove();
    return {
      rejected,
      unchanged: JSON.stringify(view.layout) === JSON.stringify(before),
      ids,
      labels: layout.connections[0].labelInstances,
    };
  });
  expect(result.rejected).toBe(true);
  expect(result.unchanged).toBe(true);
  expect(result.labels).toHaveLength(2);
  const end = page.locator('[data-role="connection-label"][data-label-position="end"]');
  await expect(end.locator('rect[data-role="label-background"]')).toHaveAttribute('stroke', '#b38900');
  await expect(end.locator('rect[data-role="label-background"]')).toHaveAttribute('rx', '4');
  const point = await end.evaluate((n) => {
    const b = n.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  const selected = await page.evaluate(() => portsketchDemo.view.selection);
  expect(selected.type).toBe('connection');
  expect(result.ids.every((id) => id.startsWith('portsketch-view-'))).toBe(true);
  expect(new Set(result.ids).size).toBe(result.ids.length);
});

test('rounded group DOM remains selectable and rejects unsafe radii atomically', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { view, createDiagramModel, layoutDiagram } = portsketchDemo;
    const raw = {
      version: 1,
      diagram: { name: 'Round DOM' },
      modules: [{ id: 'A' }],
      groups: [{ id: 'G', members: ['A'], style: { borderRadius: 16 } }],
    };
    const layout = await layoutDiagram(createDiagramModel(raw));
    view.setLayout(layout, { fit: true });
    view.getElement('group', 'G').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const selection = view.selection;
    const copy = structuredClone(layout);
    copy.groups[0].style.borderRadius = -1;
    let rejected = false;
    try {
      view.setLayout(copy);
    } catch {
      rejected = true;
    }
    return { selection, rejected, radius: view.layout.groups[0].style.borderRadius };
  });
  expect(result.selection).toMatchObject({ type: 'group', key: 'G' });
  expect(result.rejected).toBe(true);
  expect(result.radius).toBe(16);
  await expect(page.locator('[data-role="group"][data-group="G"]')).toHaveAttribute('rx', '16');
});

test('cross-group Grid retains group and port activation after scoped layout changes', async ({ page }) => {
  const raw = JSON.parse(
    await readFile(new URL('../examples/processor-cross-group-grid.json', import.meta.url), 'utf8'),
  );
  const result = await page.evaluate(async (raw) => {
    const { view, createDiagramModel, layoutDiagram } = portsketchDemo,
      model = createDiagramModel(raw);
    view.setLayout(await layoutDiagram(model), { fit: true });
    const modules = view.layout.modules,
      a = modules.find((n) => n.id === 'Clock'),
      b = modules.find((n) => n.id === 'ALU0');
    view.getElement('group', 'ComputeCluster').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const group = view.selection;
    view.getElement('port', 'ALU2.controller').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const port = view.selection;
    view.setLayout(await layoutDiagram(model, { rootGroupId: 'ComputeCluster' }), { fit: true });
    return { a: a.y + a.height / 2, b: b.y + b.height / 2, group, port, count: view.layout.modules.length };
  }, raw);
  expect(result.a).toBeCloseTo(result.b, 5);
  expect(result.group).toMatchObject({ type: 'group', key: 'ComputeCluster' });
  expect(result.port).toMatchObject({ type: 'port', key: 'ALU2.controller' });
  expect(result.count).toBe(5);
});

test('partial Grid preserves real DOM identities for automatic and fixed members', async ({ page }) => {
  const raw = JSON.parse(await readFile(new URL('../examples/partial-grid.json', import.meta.url), 'utf8'));
  const result = await page.evaluate(async (raw) => {
    const { view, createDiagramModel, layoutDiagram } = portsketchDemo;
    const before = JSON.stringify(raw);
    view.setLayout(await layoutDiagram(createDiagramModel(raw)), { fit: true });
    view.getElement('block', 'Source').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const automatic = view.selection;
    view.getElement('block', 'A').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return {
      automatic,
      fixed: view.selection,
      modules: view.layout.modules.map((n) => n.id),
      groups: view.layout.groups,
      unchanged: before === JSON.stringify(raw),
    };
  }, raw);
  expect(result.automatic).toMatchObject({ type: 'block', key: 'Source' });
  expect(result.fixed).toMatchObject({ type: 'block', key: 'A' });
  expect(result.groups).toBeUndefined();
  expect(result.modules).toHaveLength(5);
  expect(result.unchanged).toBe(true);
});

test('ComputeCluster fixed Grid and inout ports retain DOM selection and captions', async ({ page }) => {
  const raw = JSON.parse(
    await readFile(new URL('../examples/processor-overview.json', import.meta.url), 'utf8'),
  );
  const result = await page.evaluate(async (raw) => {
    const { view, createDiagramModel, layoutDiagram } = portsketchDemo;
    view.setLayout(await layoutDiagram(createDiagramModel(raw)), { fit: true });
    view.getElement('port', 'Controller.alu2').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const port = view.selection;
    view.getElement('block', 'ALU4').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { port, selection: view.selection, caption: view.layout.caption.text };
  }, raw);
  expect(result.port).toMatchObject({ type: 'port', key: 'Controller.alu2' });
  expect(result.selection).toMatchObject({ type: 'block', key: 'ALU4' });
  expect(result.caption).toContain('Double-headed');
  await expect(page.locator('[data-role="connection-start-arrow"]')).toHaveCount(3);
});

test('vertical geometry keeps DOM port activation and connection selection through direction changes', async ({
  page,
}) => {
  const raw = JSON.parse(await readFile(new URL('../examples/vertical-flow.json', import.meta.url), 'utf8'));
  const result = await page.evaluate(async (raw) => {
    const { view, createDiagramModel, layoutDiagram } = portsketchDemo;
    view.setLayout(await layoutDiagram(createDiagramModel(raw)), { fit: true });
    view.getElement('port', 'Combine.high').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const port = view.selection;
    view.select({ type: 'connection', key: 'Combine.out->Stage.in' });
    raw.layout.direction = 'right';
    raw.layout.feedbackSide = 'top';
    view.setLayout(await layoutDiagram(createDiagramModel(raw)), { fit: true });
    return { port, selection: view.selection };
  }, raw);
  expect(result.port).toMatchObject({ type: 'port', key: 'Combine.high' });
  expect(result.selection).toMatchObject({ type: 'connection', key: 'Combine.out->Stage.in' });
});

test('Concat bar keeps block and port identity in the DOM viewer', async ({ page }) => {
  const raw = JSON.parse(await readFile(new URL('../examples/concat.json', import.meta.url), 'utf8'));
  const result = await page.evaluate(async (raw) => {
    const { view, createDiagramModel, layoutDiagram } = portsketchDemo;
    view.setLayout(await layoutDiagram(createDiagramModel(raw)), { fit: true });
    view.getElement('block', 'Combine').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const selection = view.selection;
    view.getElement('port', 'Combine.high').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return {
      selection,
      port: view.selection,
      type: view.layout.modules.find((m) => m.id === 'Combine').type,
    };
  }, raw);
  expect(result.selection).toMatchObject({ type: 'block', key: 'Combine' });
  expect(result.port).toMatchObject({ type: 'port', key: 'Combine.high' });
  expect(result.type).toBe('concat');
  await expect(page.locator('[data-appearance="bar"]')).toHaveCount(2);
});

test('hidden labels retain DOM terminal, group and port targets without invisible text', async ({ page }) => {
  const raw = JSON.parse(await readFile(new URL('../examples/hidden-labels.json', import.meta.url), 'utf8'));
  const result = await page.evaluate(async (raw) => {
    const { view, createDiagramModel, layoutDiagram } = portsketchDemo;
    view.setLayout(await layoutDiagram(createDiagramModel(raw)), { fit: true });
    const activate = (kind, id) => {
      view.getElement(kind, id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return view.selection;
    };
    return {
      terminal: activate('terminal', 'ExternalInput'),
      group: activate('group', 'Frame'),
      port: activate('port', 'Processor.in'),
      terminalWidth: view.getElement('terminal', 'ExternalInput').querySelector('rect').getAttribute('width'),
      groupWidth: view.getElement('group', 'Frame').querySelector('rect').getAttribute('width'),
    };
  }, raw);
  expect(result.terminal).toMatchObject({ type: 'terminal', key: 'ExternalInput' });
  expect(result.group).toMatchObject({ type: 'group', key: 'Frame' });
  expect(result.port).toMatchObject({ type: 'port', key: 'Processor.in' });
  expect(Number(result.terminalWidth)).toBeGreaterThan(0);
  expect(Number(result.groupWidth)).toBeGreaterThan(0);
  expect(await page.locator('svg text').allTextContents()).not.toContain('Hidden external input[7:0]');
});

test('appearance bodies and arrows mount in DOM and retain block selection', async ({ page }) => {
  const raw = JSON.parse(
    await readFile(new URL('../examples/block-appearances.json', import.meta.url), 'utf8'),
  );
  const result = await page.evaluate(async (raw) => {
    const { view, createDiagramModel, layoutDiagram } = portsketchDemo;
    view.setLayout(await layoutDiagram(createDiagramModel(raw)), { fit: true });
    view.getElement('block', 'Bank').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { selection: view.selection, body: view.layout.modules.find((m) => m.id === 'Mux').body.type };
  }, raw);
  expect(result.selection).toMatchObject({ type: 'block', key: 'Bank' });
  expect(result.body).toBe('trapezoid');
  await expect(page.locator('[data-role="connection-arrow"]')).toHaveCount(2);
  await expect(page.locator('[data-appearance="stacked"] rect')).toHaveCount(3);
});

test('terminal DOM targets emit terminalclick and keep endpoint identities when reordered', async ({
  page,
}) => {
  const raw = JSON.parse(await readFile(new URL('../examples/terminals.json', import.meta.url), 'utf8'));
  const result = await page.evaluate(async (raw) => {
    const { view, createDiagramModel, layoutDiagram } = portsketchDemo;
    view.setLayout(await layoutDiagram(createDiagramModel(raw)), { fit: true });
    let terminal;
    view.once(
      'terminalclick',
      (event) => (terminal = { id: event.id, type: event.type, data: event.data.direction }),
    );
    view.getElement('terminal', 'DataIn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const selection = view.selection;
    view.select({ type: 'connection', key: '@terminal:DataIn->Processor.data_in' });
    const edge = view.selection;
    raw.connections.reverse();
    view.setLayout(await layoutDiagram(createDiagramModel(raw)));
    return { terminal, selection, edge, after: view.selection };
  }, raw);
  expect(result.terminal).toMatchObject({ id: 'DataIn', type: 'terminalclick', data: 'input' });
  expect(result.selection).toMatchObject({ type: 'terminal', key: 'DataIn' });
  expect(result.edge.source).toEqual({ terminal: 'DataIn' });
  expect(result.after.key).toBe(result.edge.key);
});

test('Group view layouts mount with original boundary port identities and prune external targets', async ({
  page,
}) => {
  const raw = JSON.parse(
    await readFile(new URL('../examples/boundary-groups.json', import.meta.url), 'utf8'),
  );
  const result = await page.evaluate(async (raw) => {
    const { view, createDiagramModel, layoutDiagram } = portsketchDemo;
    const model = createDiagramModel(raw);
    view.setLayout(await layoutDiagram(model));
    view.select({ type: 'port', id: 'Inner.in' });
    view.setPortValue('Inner.in', '0x42');
    view.setLayout(await layoutDiagram(model, { rootGroupId: 'Inner' }), { fit: true });
    const selected = view.selection;
    let externalMissing = false;
    try {
      view.getElement('block', 'Source');
    } catch {
      externalMissing = true;
    }
    let port;
    view.once('portclick', (event) => (port = { id: event.id, ownerType: event.ownerType }));
    view.getElement('port', 'Inner.in').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return {
      selected,
      externalMissing,
      port,
      value: view.getState('port', 'Inner.in'),
      root: view.layout.rootGroupId,
    };
  }, raw);
  expect(result).toMatchObject({
    root: 'Inner',
    externalMissing: true,
    selected: { type: 'port', key: 'Inner.in', ownerType: 'group' },
    port: { id: 'Inner.in', ownerType: 'group' },
    value: { value: '0x42' },
  });
});

test('converted block emits groupclick and retains port keys while ownerType changes to group', async ({
  page,
}) => {
  const original = JSON.parse(
    await readFile(new URL('../examples/block-sizes.json', import.meta.url), 'utf8'),
  );
  const converted = structuredClone(original);
  convertToBoundaryGroup(converted, 'Mux');
  const result = await page.evaluate(
    async ({ original, converted }) => {
      const { view, createDiagramModel, layoutDiagram } = portsketchDemo;
      view.setLayout(await layoutDiagram(createDiagramModel(original)), { fit: true });
      let block;
      view.once('blockclick', (e) => (block = e.id));
      view.getElement('block', 'Mux').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      view.select({ type: 'port', id: 'Mux.a' });
      view.setPortValue('Mux.a', '0x42');
      const before = view.selection;
      view.setLayout(await layoutDiagram(createDiagramModel(converted)), { fit: true });
      const after = view.selection;
      let group, port;
      view.once('groupclick', (e) => (group = e.id));
      view.once('portclick', (e) => (port = { id: e.id, ownerType: e.ownerType, groupId: e.groupId }));
      view.getElement('group', 'Mux').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      view.getElement('port', 'Mux.a').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { block, group, port, before, after, value: view.getState('port', 'Mux.a') };
    },
    { original, converted },
  );
  expect(result).toMatchObject({
    block: 'Mux',
    group: 'Mux',
    before: { key: 'Mux.a', ownerType: 'block' },
    after: { key: 'Mux.a', ownerType: 'group' },
    port: { id: 'Mux.a', ownerType: 'group', groupId: 'Mux' },
    value: { value: '0x42' },
  });
});

test('collapsed group body remains groupclick; hidden targets and runtime states are pruned', async ({
  page,
}) => {
  const raw = JSON.parse(
    await readFile(new URL('../examples/boundary-groups.json', import.meta.url), 'utf8'),
  );
  const result = await page.evaluate(async (raw) => {
    const { view, createDiagramModel, layoutDiagram } = portsketchDemo;
    view.setLayout(await layoutDiagram(createDiagramModel(raw)), { fit: true });
    view.select({ type: 'block', id: 'Decode' });
    view.setBlockState('Decode', { status: 'running' });
    view.setGroupState('Outer', { status: 'running' });
    view.setPortValue('Outer.in', '0x2A');
    raw.groups[0].collapsed = true;
    view.setLayout(await layoutDiagram(createDiagramModel(raw)), { fit: true });
    const pruned = view.selection === null;
    const body = view.getElement('group', 'Outer').querySelector('rect');
    const fullBody =
      Number(body.getAttribute('width')) === view.layout.groups[0].width &&
      Number(body.getAttribute('height')) === view.layout.groups[0].height;
    let missing = false;
    try {
      view.getElement('block', 'Decode');
    } catch {
      missing = true;
    }
    let event;
    view.once('groupclick', (e) => (event = { id: e.id, collapsed: e.data.collapsed }));
    view.getElement('group', 'Outer').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const selection = view.selection;
    raw.groups[0].collapsed = false;
    view.setLayout(await layoutDiagram(createDiagramModel(raw)));
    return {
      pruned,
      fullBody,
      missing,
      event,
      selection,
      restoredSelection: view.selection,
      hiddenState: view.getState('block', 'Decode'),
      group: view.getState('group', 'Outer'),
      port: view.getState('port', 'Outer.in'),
    };
  }, raw);
  expect(result).toMatchObject({
    pruned: true,
    fullBody: true,
    missing: true,
    event: { id: 'Outer', collapsed: true },
    selection: { type: 'group', id: 'Outer' },
    restoredSelection: { type: 'group', id: 'Outer' },
    hiddenState: null,
    group: { status: 'running' },
    port: { value: '0x2A' },
  });
  await hit(page, 'group', 'Outer').focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => portsketchDemo.view.selection.type)).toBe('group');
});

test('boundary group ports expose owner identity, events, values and state across layouts', async ({
  page,
}) => {
  const input = JSON.parse(
    await readFile(new URL('../examples/boundary-groups.json', import.meta.url), 'utf8'),
  );
  const result = await page.evaluate(async (input) => {
    const { view, createDiagramModel, layoutDiagram } = portsketchDemo;
    const layout = await layoutDiagram(createDiagramModel(input));
    view.setLayout(layout, { fit: true });
    let event;
    view.once(
      'portclick',
      (e) =>
        (event = {
          id: e.id,
          ownerId: e.ownerId,
          ownerType: e.ownerType,
          groupId: e.groupId,
          portId: e.portId,
        }),
    );
    view.getElement('port', 'Outer.in').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    view.setPortValue('Outer.in', '0x42');
    view.setGroupState('Outer', { status: 'running' });
    const selection = view.selection;
    view.setLayout(layout);
    return {
      event,
      selection,
      after: view.selection,
      value: view.getState('port', 'Outer.in'),
      group: view.getState('group', 'Outer'),
    };
  }, input);
  expect(result.event).toEqual({
    id: 'Outer.in',
    ownerId: 'Outer',
    ownerType: 'group',
    groupId: 'Outer',
    portId: 'in',
  });
  expect(result.selection).toMatchObject({
    type: 'port',
    ownerId: 'Outer',
    ownerType: 'group',
    groupId: 'Outer',
  });
  expect(result.after).toEqual(result.selection);
  expect(result.value).toEqual({ value: '0x42' });
  expect(result.group.status).toBe('running');
  await hit(page, 'port', 'Inner.in').focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => portsketchDemo.view.selection.groupId)).toBe('Inner');
  await page.screenshot({ path: 'output/editor/dom-boundary-ports.png' });
});

test.beforeEach(async ({ page }) => {
  await page.goto(file);
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#demo-status')).toHaveText('Selected block: A');
  await page.evaluate(() => {
    window.recorded = [];
    for (const name of [
      'blockclick',
      'groupclick',
      'portclick',
      'connectionclick',
      'backgroundclick',
      'selectionchange',
      'statechange',
      'layoutchange',
      'viewportchange',
    ])
      portsketchDemo.view.on(name, (e) =>
        recorded.push({
          type: e.type,
          id: e.id,
          key: e.key,
          source: e.source,
          target: e.target,
          selection: e.selection,
          state: e.state,
          originalType: e.originalEvent?.type,
        }),
      );
  });
});

const hit = (page, kind, id) => page.locator(`[data-hit][data-kind="${kind}"][data-id="${id}"]`);

test('DOM file opens offline; block, group, port and connection activation expose stable payloads', async ({
  page,
}) => {
  await expect(page.locator('[data-hit]')).toHaveCount(31);
  await hit(page, 'block', 'B').click();
  await hit(page, 'port', 'B.c_out').focus();
  await page.keyboard.press('Enter');
  await hit(page, 'group', 'pipeline').click();
  await hit(page, 'connection', 'connection_0').focus();
  await page.keyboard.press('Space');
  const events = await page.evaluate(() => recorded);
  expect(events.find((e) => e.type === 'blockclick').id).toBe('B');
  expect(events.find((e) => e.type === 'portclick').id).toBe('B.c_out');
  expect(events.find((e) => e.type === 'groupclick').id).toBe('pipeline');
  expect(events.find((e) => e.type === 'connectionclick')).toMatchObject({
    id: 'connection_0',
    key: 'A.b_out->B.b_in',
    source: { moduleId: 'A', portId: 'b_out' },
    target: { moduleId: 'B', portId: 'b_in' },
    originalType: 'keydown',
  });
  await expect(hit(page, 'connection', 'connection_0')).toHaveAttribute('aria-pressed', 'true');
  await expect(hit(page, 'group', 'pipeline')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => portsketchDemo.view.selection)).toBeNull();
});

test('on/off/once are per-view and return unsubscribe handles; event data is read-only', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { view } = portsketchDemo;
    let normal = 0,
      once = 0,
      removed = 0;
    const off = view.on('blockclick', (event) => {
      normal++;
      if (!Object.isFrozen(event.data.style)) throw Error('mutable payload');
    });
    view.once('blockclick', () => once++);
    const handler = () => removed++;
    view.on('blockclick', handler);
    view.off('blockclick', handler);
    const fire = () =>
      view.getElement('block', 'B').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fire();
    fire();
    off();
    fire();
    let unknown = false;
    try {
      view.on('bad-event', () => {});
    } catch {
      unknown = true;
    }
    return { normal, once, removed, unknown };
  });
  expect(result).toEqual({ normal: 2, once: 1, removed: 0, unknown: true });
});

test('state and port-value updates change only live DOM, retain selection and emit statechange', async ({
  page,
}) => {
  const before = await page.evaluate(() => JSON.stringify(portsketchDemo.view.layout));
  await page.evaluate(() => {
    const { view } = portsketchDemo;
    view.setBlockState('A', { status: 'running' });
    view.setBlockState('A', { highlight: true });
    view.setConnectionState('connection_0', { status: 'success' });
    view.setPortValue('A.b_out', '<script>alert(1)</script>');
  });
  await expect(hit(page, 'block', 'A')).toHaveAttribute('data-status', 'running');
  await expect(hit(page, 'block', 'A')).toHaveAttribute('data-highlight', 'true');
  await expect(hit(page, 'block', 'A')).toHaveAccessibleName(/status: running/);
  await expect(hit(page, 'connection', 'connection_0')).toHaveAttribute('data-status', 'success');
  await expect(hit(page, 'port', 'A.b_out')).toHaveAttribute('data-value', '<script>alert(1)</script>');
  await expect(page.locator('[data-portsketch-view] script')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(portsketchDemo.view.layout))).toBe(before);
  expect(await page.evaluate(() => portsketchDemo.view.getState('block', 'A'))).toEqual({
    status: 'running',
    highlight: true,
  });
  expect(await page.evaluate(() => portsketchDemo.renderSvg(portsketchDemo.view.layout))).not.toContain(
    'data-status',
  );
  await page.evaluate(() => portsketchDemo.view.clearState());
  await expect(hit(page, 'block', 'A')).not.toHaveAttribute('data-status');
  await expect(hit(page, 'port', 'A.b_out')).not.toHaveAttribute('data-value');
  expect(await page.evaluate(() => portsketchDemo.view.selection.id)).toBe('A');
});

test('setLayout preserves connection identity across reordering, state and focus; removes stale selections', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const demo = portsketchDemo,
      view = demo.view,
      key = 'A.b_out->B.b_in';
    view.select({ type: 'connection', id: key });
    view.setConnectionState(key, { status: 'running' });
    view.getElement('connection', key).focus();
    const doc = structuredClone(demo.input);
    doc.connections.reverse();
    view.setLayout(await demo.layoutDiagram(demo.createDiagramModel(doc)));
    const selected = view.selection,
      state = view.getState('connection', key),
      focused = document.activeElement.getAttribute('data-key');
    doc.connections = doc.connections.filter((edge) => edge.from !== 'A.b_out');
    view.setLayout(await demo.layoutDiagram(demo.createDiagramModel(doc)));
    return { selected, state, focused, removed: view.selection };
  });
  expect(result.selected).toMatchObject({ key: 'A.b_out->B.b_in', id: 'connection_6' });
  expect(result.state).toEqual({ status: 'running' });
  expect(result.focused).toBe('A.b_out->B.b_in');
  expect(result.removed).toBeNull();
  await expect(page.locator('[data-layer="selection"] > *')).toHaveCount(0);
});

test('invalid layouts are atomic and live DOM never interprets supplied markup or event attributes', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const { view } = portsketchDemo,
      before = JSON.stringify(view.layout);
    let rejected = 0;
    for (const change of [
      (layout) => (layout.modules[0].x = Infinity),
      (layout) => (layout.modules[0].style.fillColor = '\"/><script>bad()</script>'),
      (layout) => (layout.connections[0].sections[0].points[0].x = '0\" onload=\"bad()'),
    ]) {
      const layout = view.layout;
      change(layout);
      try {
        view.setLayout(layout);
      } catch {
        rejected++;
      }
    }
    const unchanged = JSON.stringify(view.layout) === before;
    const safe = view.layout;
    safe.modules[0].ports[0].labelBounds.onclick = 'window.bad=true';
    view.setLayout(safe);
    return {
      rejected,
      unchanged,
      unsafeAttributes: view.element.querySelectorAll('[onclick],[onload],script,foreignObject,image').length,
    };
  });
  expect(result).toEqual({ rejected: 3, unchanged: true, unsafeAttributes: 0 });
});

test('pan/zoom distinguish clicks from drags; keyboard navigation and background selection work', async ({
  page,
}) => {
  const root = page.locator('[data-portsketch-view]');
  const before = await page.evaluate(() => portsketchDemo.view.viewport);
  const box = await root.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 35);
  await page.mouse.up();
  const after = await page.evaluate(() => portsketchDemo.view.viewport);
  expect(after.x - before.x).toBeCloseTo(60);
  expect(after.y - before.y).toBeCloseTo(25);
  expect((await page.evaluate(() => recorded)).filter((e) => e.type === 'backgroundclick')).toHaveLength(0);
  await root.click({ position: { x: 5, y: 5 } });
  expect(await page.evaluate(() => portsketchDemo.view.selection)).toBeNull();
  await root.focus();
  await page.keyboard.press('+');
  expect((await page.evaluate(() => portsketchDemo.view.viewport)).scale).toBeGreaterThan(after.scale);
  await page.keyboard.press('0');
  await expect(page.getByRole('button', { name: 'Mark running', exact: true })).toBeDisabled();
  await page.evaluate(() => portsketchDemo.view.setViewport({ x: -10000, y: -10000, scale: 1 }));
  await hit(page, 'block', 'B').focus();
  const focused = await hit(page, 'block', 'B').boundingBox();
  const viewport = await root.boundingBox();
  expect(focused.x).toBeGreaterThanOrEqual(viewport.x);
  expect(focused.y).toBeGreaterThanOrEqual(viewport.y);
  expect(focused.x + focused.width).toBeLessThanOrEqual(viewport.x + viewport.width);
});

test('detached export, multiple mounts and destroy clean up only owned nodes/listeners', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { exportDom, mountDiagram, layout } = portsketchDemo;
    const host = document.createElement('div');
    host.style.height = '300px';
    host.innerHTML = '<p>Host content</p>';
    document.body.append(host);
    const first = exportDom(layout);
    const detached = first.element.parentNode === null;
    host.append(first.element);
    const second = mountDiagram(host, layout);
    let calls = 0;
    first.on('blockclick', () => calls++);
    const element = first.element;
    first.destroy();
    first.destroy();
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    second.select({ type: 'block', id: 'B' });
    const alive = second.selection.id,
      retained = host.querySelector('p').textContent;
    let destroyedError = false;
    try {
      first.select(null);
    } catch {
      destroyedError = true;
    }
    second.destroy();
    const children = host.children.length;
    host.remove();
    return { detached, calls, alive, retained, children, destroyedError };
  });
  expect(result).toEqual({
    detached: true,
    calls: 0,
    alive: 'B',
    retained: 'Host content',
    children: 1,
    destroyedError: true,
  });
});

test('viewer stays accessible and usable on narrow screens and file paths without a server', async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await hit(page, 'block', 'B').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Mark running', exact: true }).click();
  await expect(hit(page, 'block', 'B')).toHaveAttribute('data-status', 'running');
  expect(
    (
      await new AxeBuilder({ page })
        .options({ preload: false })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
  await page.screenshot({ path: 'output/editor/dom-viewer-narrow.png', fullPage: true });
});

test('Collection virtual anchors are group targets and connection identities survive collapse and expansion', async ({
  page,
}) => {
  const raw = JSON.parse(
    await readFile(new URL('../examples/collection-instances.json', import.meta.url), 'utf8'),
  );
  const result = await page.evaluate(async (raw) => {
    const { view, createDiagramModel, layoutDiagram } = portsketchDemo;
    raw.groups[0].collapsed = false;
    view.setLayout(await layoutDiagram(createDiagramModel(raw)), { fit: true });
    const key = 'Source.out->PE_0.in';
    view.select({ type: 'connection', key });
    raw.groups[0].collapsed = true;
    view.setLayout(await layoutDiagram(createDiagramModel(raw)), { fit: true });
    const selected = view.selection,
      keys = view.layout.connections.map(
        (e) => e.source.moduleId + '.' + e.source.portId + '->' + e.target.moduleId + '.' + e.target.portId,
      );
    let missing = false,
      virtualMissing = false,
      groups = 0,
      ports = 0;
    try {
      view.getElement('block', 'PE_0');
    } catch {
      missing = true;
    }
    try {
      view.getElement('port', 'PEs._collection_input');
    } catch {
      virtualMissing = true;
    }
    view.on('groupclick', () => groups++);
    view.on('portclick', () => ports++);
    view
      .getElement('group', 'PEs')
      .querySelector('circle')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const target = view.selection;
    view.select({ type: 'connection', key });
    raw.groups[0].collapsed = false;
    view.setLayout(await layoutDiagram(createDiagramModel(raw)));
    return { selected, keys, missing, virtualMissing, groups, ports, target, restored: view.selection };
  }, raw);
  expect(result.selected).toMatchObject({ type: 'connection', key: 'Source.out->PE_0.in' });
  expect(result.restored).toMatchObject({ type: 'connection', key: 'Source.out->PE_0.in' });
  expect(result.keys).toHaveLength(32);
  expect(new Set(result.keys).size).toBe(32);
  expect(result).toMatchObject({
    missing: true,
    virtualMissing: true,
    groups: 1,
    ports: 0,
    target: { type: 'group', key: 'PEs' },
  });
});
