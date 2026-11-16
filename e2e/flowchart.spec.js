// End-to-end checks for the Flowchart editor in blockflow Studio (src/studio/flowchart).
// The canvas must draw exactly what convertFlowchart produces for the same JSON.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { convertFlowchart } from '../src/agent-kit/flowchart-converter.js';
import { convertDiagram } from '../src/agent-kit/blockchart-converter.js';

const EXAMPLES = [
  ...(await readFile(new URL('../src/studio/flowchart/examples.js', import.meta.url), 'utf8')).matchAll(
    /examples\/flowchart\/([\w-]+)\.json/g,
  ),
].map((m) => m[1]);
const readExample = async (name) =>
  JSON.parse(await readFile(new URL(`../examples/flowchart/${name}.json`, import.meta.url), 'utf8'));
const ORDER = await readExample('order-approval');

async function ready(page) {
  await page.waitForTimeout(250);
  await page.waitForFunction(
    () => window.__studio?.store.layout && !window.__studio.store.layoutPending,
    null,
    { timeout: 30000 },
  );
}
const doc = (page) => page.evaluate(() => window.__studio.store.document);
const svg = (page) => page.evaluate(() => window.__studio.store.layout.svg);
async function expectConverter(page, label) {
  await ready(page);
  const document = await doc(page);
  const reference = await convertFlowchart(structuredClone(document), { format: 'svg' });
  expect(await svg(page), label).toBe(reference.text);
}
async function openText(page, name, text) {
  await page
    .locator('input[type=file]')
    .setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
}
/** Opens the Order approval example as a file, which switches the Studio to Flowchart. */
async function openOrder(page) {
  await openText(page, 'order-approval.json', JSON.stringify(ORDER));
  await page.waitForFunction(() => window.__studio.kind === 'flowchart');
  await expect(page.locator('.toast', { hasText: 'Opened order-approval.json' })).toHaveCount(1);
  await ready(page);
}
/** Page coordinates of a layout point. */
async function at(page, fn) {
  return page.evaluate((src) => {
    const c = window.__studio.canvas;
    const L = c.layout;
    const p = new Function('L', 'return (' + src + ')(L)')(L);
    const r = c.el.getBoundingClientRect();
    const s = c.toScreen(p.x, p.y);
    return { x: r.left + s.x, y: r.top + s.y };
  }, fn.toString());
}
const center = (id) =>
  `(L) => { const n = L.nodes.find((x) => x.id === '${id}') ?? L.groups.find((x) => x.id === '${id}'); return { x: n.x + n.width / 2, y: n.y + n.height / 2 }; }`;
async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  const tip = await page.locator('.drag-tip').textContent();
  await page.mouse.up();
  return tip;
}
async function focusOn(page, sel) {
  await page.evaluate((s) => window.__studio.select(s, { reveal: true, zoom: true }), sel);
  await page.waitForTimeout(200);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await ready(page);
});

test('opening a flowchart switches kind; examples, directions and switching back match the converters', async ({
  page,
}) => {
  test.setTimeout(120000);
  const blockchart = await doc(page);
  await openOrder(page);
  await expect(page.locator('.kind-chip')).toHaveText('Flowchart');
  await expectConverter(page, 'opened file');
  for (const name of EXAMPLES) {
    await page.evaluate(
      (n) =>
        window.__studio.loadExample(
          window.__studio.allExamples().find((e) => e.kind === 'flowchart' && e.document.diagram.name === n),
        ),
      (await readExample(name)).diagram.name,
    );
    await expectConverter(page, name);
  }
  await page.evaluate(() =>
    window.__studio.loadExample(window.__studio.allExamples().find((e) => e.name === 'Order approval')),
  );
  for (const dir of ['right', 'up', 'left', 'down']) {
    await page
      .getByRole('radio', {
        name: {
          right: 'Flow left to right',
          up: 'Flow bottom to top',
          left: 'Flow right to left',
          down: 'Flow top to bottom',
        }[dir],
      })
      .click();
    await expectConverter(page, 'direction ' + dir);
    expect((await doc(page)).layout.direction).toBe(dir);
  }
  // The flowchart draft is kept per kind; reload restores the last kind.
  const flow = await doc(page);
  await page.reload();
  await ready(page);
  expect(await page.evaluate(() => window.__studio.kind)).toBe('flowchart');
  expect(await doc(page)).toEqual(flow);
  // The kind chip offers a new diagram of either kind.
  await page.locator('.kind-chip').click();
  await expect(page.getByRole('menuitemradio', { name: 'Block diagram' })).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: 'Flowchart' })).toBeVisible();
  await page.keyboard.press('Escape');
  // A block diagram example switches kind; the toast leads back to the flowchart.
  await page.evaluate(() =>
    window.__studio.loadExample(window.__studio.allExamples().find((e) => e.kind === 'blockchart')),
  );
  await page.waitForFunction(() => window.__studio.kind === 'blockchart');
  await page.getByRole('button', { name: 'Back to flowchart' }).click();
  await page.waitForFunction(() => window.__studio.kind === 'flowchart');
  await ready(page);
  expect(await doc(page)).toEqual(flow);
  // Rapid switching: only the current session's layout lands, and it equals its converter.
  await page.evaluate(() => window.__studio.switchTo('blockchart'));
  await page.evaluate(() => window.__studio.switchTo('flowchart'));
  await page.evaluate(() => window.__studio.switchTo('blockchart'));
  await ready(page);
  expect(await page.evaluate(() => window.__studio.kind)).toBe('blockchart');
  const block = await doc(page);
  expect(block).toEqual(blockchart);
  expect(await svg(page)).toBe(
    (await convertDiagram(structuredClone(block), { format: 'svg' })).text.trimEnd(),
  );
  expect(await page.locator('.studio').count()).toBe(1);
});

test('drag a handle to add the next step, connect two steps and reconnect an edge; Undo restores', async ({
  page,
}) => {
  test.setTimeout(90000);
  await openOrder(page);
  const before = await doc(page);
  // Drag from Done's bottom handle onto empty space: a new connected step.
  await focusOn(page, { type: 'node', id: 'Done' });
  await page.mouse.move(...Object.values(await at(page, center('Done'))));
  await expect(page.locator('.hit-handle')).toHaveCount(4);
  const handle = await at(page, (L) => {
    const n = L.nodes.find((x) => x.id === 'Done');
    return { x: n.x + n.width / 2, y: n.y + n.height };
  });
  // The sheet's left margin beside Done is empty and outside every group, whatever the layout.
  const margin = await at(page, (L) => {
    const n = L.nodes.find((x) => x.id === 'Done');
    return { x: 6, y: n.y + n.height / 2 };
  });
  const tip = await drag(page, handle, margin);
  expect(tip).toContain('Release to add a new step');
  await ready(page);
  let d = await doc(page);
  const added = d.nodes.at(-1);
  expect(added).toMatchObject({ type: 'process' });
  expect(d.edges.at(-1)).toMatchObject({ from: 'Done', to: added.id });
  expect(d.edges.at(-1).id).toBeTruthy();
  // The inline label editor opens on the new step; Enter saves.
  await expect(page.locator('.inline-edit')).toBeFocused();
  await page.keyboard.type('Archive order');
  await page.keyboard.press('Enter');
  await ready(page);
  expect((await doc(page)).nodes.find((n) => n.id === added.id).label).toBe('Archive order');
  // Connect the new step to Received by dropping on it.
  await page.evaluate(() => window.__studio.canvas.fit());
  await page.waitForTimeout(200);
  await page.evaluate((id) => window.__studio.select({ type: 'node', id }), added.id);
  const from = await at(
    page,
    `(L) => { const n = L.nodes.find((x) => x.id === '${added.id}'); return { x: n.x + n.width, y: n.y + n.height / 2 }; }`,
  );
  expect(await drag(page, from, await at(page, center('Received')))).toBe(
    `Connect Archive order → Order received`,
  );
  await ready(page);
  d = await doc(page);
  const edge = d.edges.at(-1);
  expect(edge).toMatchObject({ from: added.id, to: 'Received' });
  expect(await page.evaluate(() => window.__studio.store.selection)).toEqual({ type: 'edge', key: edge.id });
  // A note cannot take part in a flow edge: the tip says why and nothing changes.
  await page.evaluate((id) => window.__studio.select({ type: 'node', id }), added.id);
  const count = d.edges.length;
  await page.evaluate(() => window.__studio.canvas.fit());
  await page.waitForTimeout(200);
  const from2 = await at(
    page,
    `(L) => { const n = L.nodes.find((x) => x.id === '${added.id}'); return { x: n.x + n.width, y: n.y + n.height / 2 }; }`,
  );
  const tip2 = await drag(page, from2, await at(page, center('LimitNote')));
  expect(tip2).toContain('Notes require association edges');
  expect(tip2).not.toMatch(/^Connect/);
  await expect(page.locator('.toast.error').first()).toBeVisible();
  expect((await doc(page)).edges.length).toBe(count);
  // Reconnect: drag the selected edge's "to" end onto Validate.
  await page.evaluate((key) => window.__studio.select({ type: 'edge', key }), edge.id);
  await page.waitForTimeout(100);
  const end = page.locator('.hit-handle.edge-end[data-end="to"]');
  const box = await end.boundingBox();
  expect(
    await drag(
      page,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      await at(page, center('Validate')),
    ),
  ).toContain('Move this end to Validate order');
  await ready(page);
  expect((await doc(page)).edges.find((e) => e.id === edge.id).to).toBe('Validate');
  await expectConverter(page, 'after edits');
  for (let i = 0; i < 4; i++) await page.evaluate(() => window.__studio.undo());
  await ready(page);
  expect(await doc(page)).toEqual(before);
  await expect(page.locator('.inline-edit')).toHaveCount(0);
  for (let i = 0; i < 4; i++) await page.evaluate(() => window.__studio.redo());
  expect((await doc(page)).edges.find((e) => e.id === edge.id).to).toBe('Validate');
});

test('steps move into groups with their notes; notes attach by dragging; empty groups disappear; edge selection survives deletes', async ({
  page,
}) => {
  test.setTimeout(90000);
  await openOrder(page);
  const before = await doc(page);
  const parent = (d, id) => d.groups?.find((g) => g.members.includes(id))?.id ?? null;
  // Drag Fulfil onto the Approval group.
  await page.evaluate(() => window.__studio.canvas.fit());
  await page.waitForTimeout(200);
  const tip = await drag(
    page,
    await at(page, center('Fulfil')),
    await at(
      page,
      `(L) => { const g = L.groups.find((x) => x.id === 'Approval'); return { x: g.x + g.width - 20, y: g.y + g.height - 12 }; }`,
    ),
  );
  expect(tip).toBe('Move into Approval');
  await ready(page);
  expect(parent(await doc(page), 'Fulfil')).toBe('Approval');
  // Move OverLimit (which has a note) to the top level with the inspector: the note follows.
  await page.evaluate(() => window.__studio.select({ type: 'node', id: 'OverLimit' }));
  await page.locator('[data-fid="n-inside"]').selectOption('');
  await ready(page);
  let d = await doc(page);
  expect([parent(d, 'OverLimit'), parent(d, 'LimitNote')]).toEqual([null, null]);
  // Drag the note onto Revise: it is attached there.
  await page.evaluate(() => window.__studio.canvas.fit());
  await page.waitForTimeout(200);
  expect(await drag(page, await at(page, center('LimitNote')), await at(page, center('Revise')))).toBe(
    'Attach note to Ask the customer / to revise',
  );
  await ready(page);
  expect((await doc(page)).nodes.find((n) => n.id === 'LimitNote').attachTo).toBe('Revise');
  // Group a step with G, then ungroup it from the toolbar.
  await page.evaluate(() => window.__studio.select({ type: 'node', id: 'Done' }));
  await page.locator('.canvas').focus();
  await page.keyboard.press('g');
  await ready(page);
  const gid = await page.evaluate(() => window.__studio.store.selection.id);
  expect(parent(await doc(page), 'Done')).toBe(gid);
  // Drag the new group by its title into Approval (placeGroup); its step goes along.
  await page.evaluate(() => window.__studio.canvas.fit());
  await page.waitForTimeout(200);
  const title = await at(
    page,
    `(L) => { const g = L.groups.find((x) => x.id === '${gid}'); return { x: g.x + 12, y: g.y + 6 }; }`,
  );
  const inside = await at(
    page,
    `(L) => { const g = L.groups.find((x) => x.id === 'Approval'); return { x: g.x + g.width - 20, y: g.y + g.height - 12 }; }`,
  );
  expect(await drag(page, title, inside)).toBe('Move into Approval');
  await ready(page);
  d = await doc(page);
  expect([parent(d, gid), parent(d, 'Done')]).toEqual(['Approval', gid]);
  // Move to… on Approval never offers its own descendants; the runtime refuses a cycle.
  await page.evaluate(() => window.__studio.select({ type: 'group', id: 'Approval' }));
  await page.evaluate(() =>
    window.__studio.contextMenu({ type: 'group', id: 'Approval' }, { x: 600, y: 300 }),
  );
  // Its only other place would be inside its own child group, so there is nowhere to go.
  await expect(page.getByRole('menuitem', { name: 'Move to…' })).toBeDisabled();
  await page.keyboard.press('Escape');
  const beforeCycle = await doc(page);
  await page.evaluate((g) => window.__studio.place('Approval', g), gid);
  await expect(page.locator('.toast.error').first()).toBeVisible();
  expect(await doc(page)).toEqual(beforeCycle);
  // Inside on the group's inspector moves it back to the top level.
  await page.evaluate((g) => window.__studio.select({ type: 'group', id: g }), gid);
  await page.locator('[data-fid="g-inside"]').selectOption('');
  await ready(page);
  expect(parent(await doc(page), gid)).toBe(null);
  await page.evaluate((g) => window.__studio.select({ type: 'group', id: g }), gid);
  await page.getByRole('button', { name: 'Ungroup' }).first().click();
  await ready(page);
  expect((await doc(page)).groups.some((g) => g.id === gid)).toBe(false);
  // Edge selection keeps its identity when an earlier edge disappears.
  await page.evaluate(() => window.__studio.select({ type: 'edge', key: 'edge_6' }));
  const selected = (await doc(page)).edges[5];
  await page.evaluate(() => window.__studio.remove({ type: 'node', id: 'Received' }));
  await ready(page);
  await page.evaluate(() => window.__studio.select({ type: 'edge', key: 'edge_6' }));
  d = await doc(page);
  expect(d.edges.find((e) => e.id === 'edge_6')).toMatchObject({ from: selected.from, to: selected.to });
  await expect(page.locator('.insp-sub')).toContainText('edge_6');
  // Deleting the last members of Approval removes the group.
  for (const id of ['ManagerReview', 'Approved', 'Fulfil'])
    await page.evaluate((x) => window.__studio.remove({ type: 'node', id: x }), id);
  await ready(page);
  expect((await doc(page)).groups ?? []).toEqual([]);
  await expectConverter(page, 'after deletes');
  while (await page.evaluate(() => window.__studio.store.history.past.length))
    await page.evaluate(() => window.__studio.store.undo());
  await ready(page);
  expect(await doc(page)).toEqual(before);
});

test('inspector edits, inline errors, defaults, exports, Save/reload and Mermaid import', async ({
  page,
}) => {
  test.setTimeout(90000);
  await openOrder(page);
  await page.evaluate(() => window.__studio.select({ type: 'node', id: 'Validate' }));
  // Type and ID: rename updates every reference.
  await page.locator('[data-fid="n-id"]').fill('Check');
  await page.locator('[data-fid="n-id"]').press('Enter');
  await ready(page);
  let d = await doc(page);
  expect(d.nodes.some((n) => n.id === 'Check')).toBe(true);
  expect(d.edges.filter((e) => e.from === 'Check' || e.to === 'Check').length).toBe(3);
  await page.evaluate(() => window.__studio.select({ type: 'node', id: 'Check' }));
  await page.locator('[data-fid="n-id"]').fill('1bad');
  await page.locator('[data-fid="n-id"]').press('Enter');
  await expect(page.locator('.field-error')).toBeVisible();
  expect((await doc(page)).nodes.some((n) => n.id === 'Check')).toBe(true);
  // Escape reverts the field and clears the message.
  await page.locator('[data-fid="n-id"]').press('Escape');
  await expect(page.locator('.field-error')).toHaveCount(0);
  await expect(page.locator('[data-fid="n-id"]')).toHaveValue('Check');
  await page.getByRole('radio', { name: 'Decision' }).click();
  await ready(page);
  expect((await doc(page)).nodes.find((n) => n.id === 'Check').type).toBe('decision');
  // Edge: label, sides and kind.
  const key = await page.evaluate(() => {
    const d = window.__studio.store.document;
    const i = d.edges.findIndex((e) => e.from === 'Received');
    return d.edges[i].id ?? 'edge_' + (i + 1);
  });
  await page.evaluate((k) => window.__studio.select({ type: 'edge', key: k }), key);
  await page.locator('[data-fid="e-label"]').fill('new order');
  await page.locator('[data-fid="e-label"]').press('Control+Enter');
  await page.locator('[data-fid="e-fromSide"]').selectOption('right');
  await ready(page);
  d = await doc(page);
  const e = d.edges.find((x, i) => (x.id ?? 'edge_' + (i + 1)) === key);
  expect(e).toMatchObject({ label: 'new order', fromSide: 'right' });
  // Layout: invalid spacing stays in the field; a value is written; the dot clears it.
  await page.evaluate(() => window.__studio.select(null));
  await page.getByRole('tab', { name: 'Layout' }).click();
  await page.locator('[data-fid="fl-ns"]').fill('0');
  await page.locator('[data-fid="fl-ns"]').press('Enter');
  await expect(page.locator('.field-error')).toContainText('positive');
  expect((await doc(page)).layout.nodeSpacing).toBeUndefined();
  await page.locator('[data-fid="fl-ns"]').fill('80');
  await page.locator('[data-fid="fl-ns"]').press('Enter');
  await ready(page);
  expect((await doc(page)).layout.nodeSpacing).toBe(80);
  await expectConverter(page, 'node spacing 80');
  // A fixed loop side that no longer lies across the flow resets to Auto with the turn.
  await page.locator('[data-fid="fl-loop"]').selectOption('right');
  await ready(page);
  await page.getByRole('radio', { name: 'Flow left to right' }).click();
  await ready(page);
  expect((await doc(page)).layout).toMatchObject({ direction: 'right' });
  expect((await doc(page)).layout.loopSide).toBeUndefined();
  await expect(page.locator('.toast', { hasText: 'Loops now choose their side automatically' })).toHaveCount(
    1,
  );
  await expectConverter(page, 'turned with loop side reset');
  await page.evaluate(() => window.__studio.undo());
  await ready(page);
  expect((await doc(page)).layout).toMatchObject({ direction: 'down', loopSide: 'right' });
  await page.evaluate(() => window.__studio.select(null));
  await page.getByRole('tab', { name: 'Layout' }).click();
  // Defaults: a step fill for the whole diagram.
  await page.getByRole('tab', { name: 'Defaults' }).click();
  await page.locator('input[data-fid="fd-node-shape-fillColor"]').fill('#fafafa');
  await page.locator('input[data-fid="fd-node-shape-fillColor"]').press('Tab');
  await ready(page);
  expect((await doc(page)).diagram.style.node.fillColor).toBe('#fafafa');
  await expectConverter(page, 'defaults');
  // Exports: SVG is the canvas text, PNG downloads, Save writes the document.
  const download = async (cmd, arg) => {
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(([c, a]) => window.__studio.run(c, a), [cmd, arg]),
    ]);
    return { name: dl.suggestedFilename(), data: await readFile(await dl.path()) };
  };
  const exported = await download('export-svg');
  expect(exported.name).toBe('Order-approval.svg');
  expect(exported.data.toString('utf8')).toBe(await svg(page));
  const png = await download('export-png', 2);
  expect(png.data.subarray(1, 4).toString()).toBe('PNG');
  const saved = JSON.parse((await download('save')).data.toString('utf8'));
  expect(saved).toEqual(await doc(page));
  await page.reload();
  await ready(page);
  expect(await doc(page)).toEqual(saved);
  // A file with both kinds' keys is rejected; the flowchart stays.
  await openText(page, 'both.json', JSON.stringify({ ...saved, modules: [] }));
  await expect(page.locator('.toast.error').first()).toContainText('both');
  expect(await doc(page)).toEqual(saved);
  // Mermaid flowchart text opens through the runtime parser.
  await openText(
    page,
    'process.mmd',
    'flowchart LR\n  A[Start] --> B{Ready?}\n  B -->|yes| C[Go]\n  B -->|no| A\n',
  );
  await page.waitForFunction(() => window.__studio.store.document.nodes.length === 3);
  await expect(page.locator('.toast').first()).toContainText('Imported from Mermaid');
  await expectConverter(page, 'mermaid');
  expect((await doc(page)).layout.direction).toBe('right');
});

// A crowded chart the runtime places with FLOW_LABEL_OVERLAP warnings (labels cannot clear every wire).
const CROWDED = {
  version: 1,
  diagram: { name: 'Crowded labels' },
  layout: { direction: 'down', nodeSpacing: 10, layerSpacing: 10 },
  nodes: [
    { id: 'A', type: 'decision', label: 'Route?' },
    { id: 'T0', label: 'Target 0' },
    { id: 'T1', label: 'Target 1' },
    { id: 'T2', label: 'Target 2' },
  ],
  edges: [
    { from: 'A', to: 'T0', label: 'case 0 case 0 case 0 ' },
    { from: 'A', to: 'T1', label: 'case 1 case 1 case 1 ' },
    { from: 'A', to: 'T2', label: 'case 2 case 2 case 2 ' },
    { from: 'T0', to: 'T1', label: 'next 0 next 0 next 0 ' },
    { from: 'T1', to: 'T2', label: 'next 1 next 1 next 1 ' },
    { from: 'T1', to: 'A', label: 'retry 1 retry 1 retry 1 ' },
    { from: 'T2', to: 'A', label: 'retry 2 retry 2 retry 2 ' },
  ],
};

test('label clearance warnings: status bar count, Problems name each edge and select it; canvas equals converter', async ({
  page,
}) => {
  await page.locator('input[type=file]').setInputFiles({
    name: 'crowded.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(CROWDED)),
  });
  await page.waitForFunction(() => window.__studio.store.document.diagram?.name === 'Crowded labels');
  await ready(page);
  const { svg, warnings } = await page.evaluate(() => ({
    svg: window.__studio.store.layout.svg,
    warnings: window.__studio.store.layout.layout.warnings,
  }));
  const reference = await convertFlowchart(structuredClone(CROWDED), { format: 'svg' });
  expect(svg).toBe(reference.text);
  expect(warnings.map((w) => w.code)).toEqual(reference.warnings.map((w) => w.code));
  expect(warnings.length).toBeGreaterThan(0);
  await expect(page.locator('.statusbar')).toContainText(`${warnings.length} label warning`);
  const rows = page.locator('.row.problem');
  await expect(rows).toHaveCount(warnings.length);
  const first = warnings[0].edgeId;
  const edge = CROWDED.edges[Number(first.replace('edge_', '')) - 1];
  await expect(rows.first().locator('.problem-item')).toContainText(edge.label.trim().split(' ')[0]);
  await rows.first().click();
  expect(await page.evaluate(() => window.__studio.store.selection)).toEqual({ type: 'edge', key: first });
});
