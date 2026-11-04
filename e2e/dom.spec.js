import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { convertToBoundaryGroup } from '../src/editor/state/commands.js';
const file = new URL('../dist-dom/dom-viewer.html', import.meta.url).href;

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
