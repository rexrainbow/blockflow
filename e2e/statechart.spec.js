// End-to-end checks for the Statechart editor in blockflow Studio (src/studio/statechart).
// The canvas must draw exactly what convertStatechart produces for the same JSON.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { convertStatechart } from '../src/agent-kit/statechart-converter.js';

const EXAMPLES = [
  ...(await readFile(new URL('../src/studio/statechart/examples.js', import.meta.url), 'utf8')).matchAll(
    /examples\/statechart\/([\w-]+)\.json/g,
  ),
].map((m) => m[1]);
const readExample = async (name) =>
  JSON.parse(await readFile(new URL(`../examples/statechart/${name}.json`, import.meta.url), 'utf8'));
// The Timer FSM is a preserved test fixture; the bundled examples are read from examples.js.
const fixture = (name) => readFile(new URL(`../tests/fixtures/statechart/${name}`, import.meta.url), 'utf8');
const TIMER = JSON.parse(await fixture('timer-fsm.json'));
const TIMER_MMD = await fixture('timer-fsm.mmd');
const TASK_MMD = await readFile(
  new URL('../examples/statechart/task-controller.mmd', import.meta.url),
  'utf8',
);

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
  const reference = await convertStatechart(structuredClone(await doc(page)), { format: 'svg' });
  expect(await svg(page), label).toBe(reference.text);
}
async function openText(page, name, text) {
  await page
    .locator('input[type=file]')
    .setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
}
async function openTimer(page) {
  await openText(page, 'timer-fsm.json', JSON.stringify(TIMER));
  await page.waitForFunction(() => window.__studio.kind === 'statechart');
  await ready(page);
}
async function at(page, src) {
  return page.evaluate((code) => {
    const c = window.__studio.canvas;
    const p = new Function('L', 'return (' + code + ')(L)')(c.layout);
    const r = c.el.getBoundingClientRect();
    const s = c.toScreen(p.x, p.y);
    return { x: r.left + s.x, y: r.top + s.y };
  }, src);
}
const center = (id) =>
  `(L) => { const n = L.nodes.find((x) => x.id === '${id}'); return { x: n.x + n.width / 2, y: n.y + n.height / 2 }; }`;
const side = (id, s) =>
  `(L) => { const n = L.nodes.find((x) => x.id === '${id}'); return ${JSON.stringify(s)} === 'right' ? { x: n.x + n.width, y: n.y + n.height / 2 } : { x: n.x + n.width / 2, y: n.y + n.height }; }`;
async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  const tip = await page.locator('.drag-tip').textContent();
  await page.mouse.up();
  return tip;
}
async function hoverAndSelect(page, id) {
  await page.evaluate((x) => window.__studio.select({ type: 'node', id: x }), id);
  await page.mouse.move(...Object.values(await at(page, center(id))));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await ready(page);
});

test('Mermaid stateDiagram and JSON open as statecharts; examples, directions, reload and kind isolation match the converter', async ({
  page,
}) => {
  test.setTimeout(120000);
  await openText(page, 'timer-fsm.mmd', TIMER_MMD);
  await page.waitForFunction(() => window.__studio.kind === 'statechart');
  await expect(page.locator('.toast', { hasText: 'Imported from Mermaid' })).toHaveCount(1);
  await expect(page.locator('.kind-chip')).toHaveText('Statechart');
  await expectConverter(page, 'mermaid');
  await openText(page, 'task-controller.mmd', TASK_MMD);
  await page.waitForFunction(() => window.__studio.store.document.states.length === 7);
  expect((await doc(page)).transitions).toHaveLength(16);
  await expectConverter(page, 'task controller mermaid');
  for (const name of EXAMPLES) {
    const document = await readExample(name);
    await page.evaluate(
      (n) =>
        window.__studio.loadExample(
          window.__studio.allExamples().find((e) => e.kind === 'statechart' && e.document.diagram.name === n),
        ),
      document.diagram.name,
    );
    await ready(page);
    expect(await doc(page), name).toEqual(document);
    await expectConverter(page, name);
  }
  for (const [dir, name] of [
    ['right', 'Flow left to right'],
    ['up', 'Flow bottom to top'],
    ['left', 'Flow right to left'],
    ['down', 'Flow top to bottom'],
  ]) {
    await page.getByRole('radio', { name }).click();
    await expectConverter(page, dir);
    expect((await doc(page)).layout.direction).toBe(dir);
  }
  const chart = await doc(page);
  await page.reload();
  await ready(page);
  expect(await page.evaluate(() => window.__studio.kind)).toBe('statechart');
  expect(await doc(page)).toEqual(chart);
  // More than one kind's root key is refused; the statechart stays.
  await openText(page, 'mixed.json', JSON.stringify({ ...chart, nodes: [] }));
  await expect(page.locator('.toast.error').first()).toContainText('a diagram is one kind');
  expect(await doc(page)).toEqual(chart);
  // Switching through every kind leaves one Studio; each restores its own draft and parity.
  for (const kind of ['flowchart', 'blockchart', 'statechart'])
    await page.evaluate((k) => window.__studio.switchTo(k), kind);
  await ready(page);
  expect(await page.locator('.studio').count()).toBe(1);
  expect(await doc(page)).toEqual(chart);
  await expectConverter(page, 'after switching');
});

test('handles add states, self and parallel transitions; reconnect; pseudostate rules; identity after deletion; Undo/Redo', async ({
  page,
}) => {
  test.setTimeout(120000);
  await openTimer(page);
  const before = await doc(page);
  // Opening is itself undoable (back to the starter): undo only the edits made after it.
  const opened = await page.evaluate(() => window.__studio.store.history.past.length);
  await page.evaluate(() => window.__studio.canvas.fit());
  await page.waitForTimeout(200);
  // Drag from LO's bottom handle onto empty space: a new state reached from LO.
  await hoverAndSelect(page, 'LO');
  await expect(page.locator('.hit-handle')).toHaveCount(4);
  const lo = await at(page, side('LO', 'bottom'));
  expect(await drag(page, lo, { x: lo.x, y: lo.y + 90 })).toContain('Release to add a new state');
  await ready(page);
  let d = await doc(page);
  const added = d.states.at(-1).id;
  expect(d.transitions.at(-1)).toMatchObject({ from: 'LO', to: added });
  await expect(page.locator('.inline-edit')).toBeFocused();
  await page.keyboard.type('DONE');
  await page.keyboard.press('Enter');
  await ready(page);
  expect((await doc(page)).states.find((s) => s.id === added).label).toBe('DONE');
  // Self transition: drop a handle back on the same state.
  await page.evaluate(() => window.__studio.canvas.fit());
  await page.waitForTimeout(200);
  await hoverAndSelect(page, 'HI');
  expect(await drag(page, await at(page, side('HI', 'right')), await at(page, center('HI')))).toBe(
    'Connect HI → HI',
  );
  await ready(page);
  d = await doc(page);
  const self = d.transitions.at(-1);
  expect(self).toMatchObject({ from: 'HI', to: 'HI' });
  await expect(page.locator('[data-fid="t-label"]')).toBeFocused();
  await page.keyboard.type('tick');
  await page.keyboard.press('Control+Enter');
  await ready(page);
  // A parallel transition HI → LO keeps its own identity.
  await page.evaluate(() => window.__studio.canvas.fit());
  await page.waitForTimeout(200);
  await hoverAndSelect(page, 'HI');
  await drag(page, await at(page, side('HI', 'right')), await at(page, center('LO')));
  await ready(page);
  d = await doc(page);
  const parallel = d.transitions.filter((t) => t.from === 'HI' && t.to === 'LO');
  expect(parallel.length).toBe(2);
  expect(new Set(parallel.map((t, i) => t.id ?? i)).size).toBe(2);
  await expect(page.locator('.insp-hint', { hasText: 'One of 2 transitions' })).toBeVisible();
  // The initial pseudostate cannot receive a transition: the tip says why, nothing changes.
  await page.evaluate(() => window.__studio.canvas.fit());
  await page.waitForTimeout(200);
  await hoverAndSelect(page, 'HI');
  const count = d.transitions.length;
  const tip = await drag(page, await at(page, side('HI', 'right')), await at(page, center('initial_1')));
  expect(tip).toContain('Initial state cannot have incoming transitions');
  expect((await doc(page)).transitions.length).toBe(count);
  // Reconnect the self transition's "to" end onto LO.
  await page.evaluate((k) => window.__studio.select({ type: 'edge', key: k }), self.id);
  await page.waitForTimeout(100);
  const box = await page.locator('.hit-handle.edge-end[data-end="to"]').boundingBox();
  expect(
    await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, await at(page, center('LO'))),
  ).toContain('Move this end to LO');
  await ready(page);
  expect((await doc(page)).transitions.find((t) => t.id === self.id).to).toBe('LO');
  // Changing a state to Final drops its text (pseudostates have none); Undo brings it back.
  await page.evaluate((x) => window.__studio.select({ type: 'node', id: x }), added);
  await page.getByRole('radio', { name: 'Final' }).click();
  await expect(page.locator('.toast', { hasText: 'Final states have no text' }).first()).toBeVisible();
  expect((await doc(page)).states.find((s) => s.id === added)).toEqual({ id: added, kind: 'final' });
  await page.evaluate(() => window.__studio.undo());
  expect((await doc(page)).states.find((s) => s.id === added).label).toBe('DONE');
  // INIT has outgoing transitions, so the runtime refuses to make it final.
  await page.evaluate(() => window.__studio.select({ type: 'node', id: 'INIT' }));
  await page.getByRole('radio', { name: 'Final' }).click();
  await expect(page.locator('.toast.error', { hasText: 'outgoing' }).first()).toBeVisible();
  expect((await doc(page)).states.find((s) => s.id === 'INIT').kind).toBeUndefined();
  // Deleting a state drops its transitions; a later transition keeps its id and selection.
  const later = (await doc(page)).transitions.findIndex((t) => t.from === 'LO' && t.to === 'IDLE');
  const key = (await doc(page)).transitions[later].id ?? `transition_${later + 1}`;
  await page.evaluate((k) => window.__studio.select({ type: 'edge', key: k }), key);
  await page.evaluate(() => window.__studio.remove({ type: 'node', id: 'INIT' }));
  await ready(page);
  d = await doc(page);
  expect(d.states.some((s) => s.id === 'INIT')).toBe(false);
  expect(d.transitions.some((t) => t.from === 'INIT' || t.to === 'INIT')).toBe(false);
  expect(d.transitions.find((t) => t.id === key)).toMatchObject({ from: 'LO', to: 'IDLE' });
  expect(await page.evaluate(() => window.__studio.store.selection)).toEqual({ type: 'edge', key });
  await expectConverter(page, 'after edits');
  const edited = await doc(page);
  while ((await page.evaluate(() => window.__studio.store.history.past.length)) > opened)
    await page.evaluate(() => window.__studio.store.undo());
  await ready(page);
  expect(await doc(page)).toEqual(before);
  await expect(page.locator('.inline-edit')).toHaveCount(0);
  while (await page.evaluate(() => window.__studio.store.history.future.length))
    await page.evaluate(() => window.__studio.store.redo());
  expect(await doc(page)).toEqual(edited);
});

test('inspector edits and errors, kinds, defaults, exports, Save/reload', async ({ page }) => {
  test.setTimeout(90000);
  await openTimer(page);
  await page.evaluate(() => window.__studio.select({ type: 'node', id: 'IDLE' }));
  await page.locator('[data-fid="s-desc"]').fill('idle-output\nled = off');
  await page.locator('[data-fid="s-desc"]').press('Control+Enter');
  await ready(page);
  expect((await doc(page)).states.find((s) => s.id === 'IDLE').description).toBe('idle-output\nled = off');
  await page.locator('[data-fid="s-id"]').fill('Idle');
  await page.locator('[data-fid="s-id"]').press('Enter');
  await ready(page);
  let d = await doc(page);
  expect(d.transitions.filter((t) => t.from === 'Idle' || t.to === 'Idle').length).toBeGreaterThan(2);
  await page.evaluate(() => window.__studio.select({ type: 'node', id: 'Idle' }));
  await page.locator('[data-fid="s-id"]').fill('9x');
  await page.locator('[data-fid="s-id"]').press('Enter');
  await expect(page.locator('.field-error')).toBeVisible();
  await page.locator('[data-fid="s-id"]').press('Escape');
  // A new final state has no text fields.
  await page.evaluate(() => window.__studio.run('add-state', 'final'));
  await ready(page);
  d = await doc(page);
  expect(d.states.at(-1)).toEqual({ id: d.states.at(-1).id, kind: 'final' });
  await expect(page.locator('[data-fid="s-label"]')).toHaveCount(0);
  // Transition: condition, routing and side.
  const key = await page.evaluate(() => {
    const d = window.__studio.store.document;
    const i = d.transitions.findIndex((t) => t.from === 'HI' && t.to === 'LO');
    return d.transitions[i].id ?? 'transition_' + (i + 1);
  });
  await page.evaluate((k) => window.__studio.select({ type: 'edge', key: k }), key);
  await page.locator('[data-fid="t-label"]').fill('half period');
  await page.locator('[data-fid="t-label"]').press('Control+Enter');
  await page.locator('[data-fid="t-fromSide"]').selectOption('left');
  await page.getByRole('radio', { name: 'Forward' }).click();
  await ready(page);
  d = await doc(page);
  expect(d.transitions.find((t, i) => (t.id ?? 'transition_' + (i + 1)) === key)).toMatchObject({
    label: 'half period',
    fromSide: 'left',
    kind: 'flow',
  });
  await expectConverter(page, 'transition edits');
  // Layout spacing with inline errors; defaults for every state.
  await page.evaluate(() => window.__studio.select(null));
  await page.getByRole('tab', { name: 'Layout' }).click();
  await expect(page.locator('[data-fid="fl-ng"]')).toHaveCount(0);
  await page.locator('[data-fid="fl-ls"]').fill('-5');
  await page.locator('[data-fid="fl-ls"]').press('Enter');
  await expect(page.locator('.field-error')).toContainText('positive');
  await page.locator('[data-fid="fl-ls"]').fill('90');
  await page.locator('[data-fid="fl-ls"]').press('Enter');
  await ready(page);
  expect((await doc(page)).layout.layerSpacing).toBe(90);
  await page.getByRole('tab', { name: 'Defaults' }).click();
  await page.locator('input[data-fid="fd-state-shape-fillColor"]').fill('#f0f7ff');
  await page.locator('input[data-fid="fd-state-shape-fillColor"]').press('Tab');
  await ready(page);
  expect((await doc(page)).diagram.style.state.fillColor).toBe('#f0f7ff');
  await expectConverter(page, 'defaults');
  const download = async (cmd, arg) => {
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(([c, a]) => window.__studio.run(c, a), [cmd, arg]),
    ]);
    return { name: dl.suggestedFilename(), data: await readFile(await dl.path()) };
  };
  const exported = await download('export-svg');
  expect(exported.name).toBe('Timer-FSM.svg');
  expect(exported.data.toString('utf8')).toBe(await svg(page));
  expect((await download('export-png', 2)).data.subarray(1, 4).toString()).toBe('PNG');
  const saved = JSON.parse((await download('save')).data.toString('utf8'));
  expect(saved).toEqual(await doc(page));
  await page.reload();
  await ready(page);
  expect(await doc(page)).toEqual(saved);
});

test('label layout: label width default/set/removal, wrapped display vs raw condition, retired loop side cleared', async ({
  page,
}) => {
  test.setTimeout(120000);
  const sample = await readFile(
    new URL('../examples/statechart/label-layout/trigger-processor.json', import.meta.url),
    'utf8',
  );
  await openText(page, 'trigger-processor.json', sample);
  await page.waitForFunction(() => window.__studio.kind === 'statechart');
  await expectConverter(page, 'trigger processor');
  // Layout tab: no global loop side; label width shows the runtime default when unset.
  await page.evaluate(() => window.__studio.select(null));
  await page.getByRole('tab', { name: 'Layout' }).click();
  await expect(page.locator('[data-fid="fl-loop"]')).toHaveCount(0);
  const width = page.locator('[data-fid="sl-lw"]');
  await expect(width).toHaveValue('240');
  await width.fill('');
  await width.press('Enter');
  await ready(page);
  expect((await doc(page)).layout.labelMaxWidth).toBeUndefined();
  await expect(width).toHaveAttribute('placeholder', '240');
  await expectConverter(page, 'default width');
  // A narrow width wraps the drawing only; the saved condition keeps its own text.
  const long = 'timer expires and the sample buffer is full';
  const key = await page.evaluate(() => {
    const d = window.__studio.store.document;
    const i = d.transitions.findIndex((t) => t.from !== t.to);
    return d.transitions[i].id ?? 'transition_' + (i + 1);
  });
  await page.evaluate((k) => window.__studio.select({ type: 'edge', key: k }), key);
  await page.locator('[data-fid="t-label"]').fill(long);
  await page.locator('[data-fid="t-label"]').press('Tab');
  await page.evaluate(() => window.__studio.select(null));
  await page.getByRole('tab', { name: 'Layout' }).click();
  await width.fill('80');
  await width.press('Enter');
  await ready(page);
  const shown = await page.evaluate(
    (k) => window.__studio.store.layout.layout.transitions.find((t) => t.editorKey === k),
    key,
  );
  expect(shown.label).toBe(long);
  expect(shown.displayLabel).toContain('\n');
  const saved = await doc(page);
  expect(saved.transitions.find((t, i) => (t.id ?? 'transition_' + (i + 1)) === key).label).toBe(long);
  expect(JSON.stringify(saved)).not.toContain('displayLabel');
  await expectConverter(page, 'narrow width');
  // Invalid width is refused with the field error; nothing changes.
  await width.fill('-5');
  await width.press('Enter');
  await expect(page.locator('.field-error')).toContainText('positive');
  await width.press('Escape');
  expect((await doc(page)).layout.labelMaxWidth).toBe(80);
  // Inline edit starts from the raw condition, not the wrapped display.
  await page.evaluate((k) => window.__studio.select({ type: 'edge', key: k }), key);
  await page.evaluate((k) => window.__studio.startRename({ type: 'edge', key: k }), key);
  await expect(page.locator('textarea.inline-edit')).toHaveValue(long);
  await page.keyboard.press('Escape');
  // Undo/Redo the width; reload keeps it.
  await page.evaluate(() => window.__studio.undo());
  await ready(page);
  expect((await doc(page)).layout.labelMaxWidth).toBeUndefined();
  await page.evaluate(() => window.__studio.redo());
  await page.reload();
  await ready(page);
  expect((await doc(page)).layout.labelMaxWidth).toBe(80);
  // Legacy JSON with the retired global loop side opens without it, announced; sides per transition stay.
  const legacy = structuredClone(TIMER);
  legacy.layout = { ...(legacy.layout ?? {}), loopSide: 'left' };
  legacy.transitions[0].fromSide = 'right';
  await openText(page, 'legacy.json', JSON.stringify(legacy));
  await expect(page.locator('.toast', { hasText: 'retired loop side' })).toBeVisible();
  await ready(page);
  expect((await doc(page)).layout?.loopSide).toBeUndefined();
  expect((await doc(page)).transitions[0].fromSide).toBe('right');
  await expectConverter(page, 'legacy opened');
  // A legacy browser draft is cleaned on start, once.
  await page.evaluate(
    (d) => localStorage.setItem('blockflow.statechart.v1', JSON.stringify({ document: d })),
    legacy,
  );
  await page.reload();
  // The startup toast lasts a few seconds: check it before waiting for the layout.
  await expect(page.locator('.toast', { hasText: 'Restored' })).toContainText('retired loop side');
  await ready(page);
  expect((await doc(page)).layout?.loopSide).toBeUndefined();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('blockflow.statechart.v1')).document.layout?.loopSide,
    ),
  ).toBeUndefined();
});

test('first Statechart visit starts from the Batch task controller; Examples lists it first', async ({
  page,
}) => {
  test.setTimeout(90000);
  const starter = await readExample(EXAMPLES[0]);
  expect(EXAMPLES).toEqual(['task-controller', 'door-controller']);
  await page.evaluate(() => window.__studio.switchTo('statechart'));
  await ready(page);
  expect(await doc(page)).toEqual(starter);
  expect(starter.states).toHaveLength(7);
  expect(starter.transitions).toHaveLength(16);
  await expectConverter(page, 'starter');
  await page.evaluate(() => window.__studio.examplesMenu(document.querySelector('.kind-chip')));
  const items = page.getByRole('menuitem');
  await expect(items.first()).toHaveText(/Batch task controller/);
  await expect(page.getByRole('menuitem', { name: /Door controller/ })).toHaveCount(1);
  await page.keyboard.press('Escape');
  // Selection works on the starter: a state and a transition.
  await page.evaluate(() =>
    window.__studio.select({ type: 'node', id: window.__studio.store.document.states[1].id }),
  );
  await expect(page.locator('[data-fid="s-label"]')).toBeVisible();
  await page.evaluate(() => window.__studio.select({ type: 'edge', key: 'transition_1' }));
  await expect(page.locator('[data-fid="t-label"]')).toBeVisible();
  // An existing draft is kept: an edit survives reload and switching away and back.
  await page.locator('[data-fid="t-label"]').fill('kept condition');
  await page.locator('[data-fid="t-label"]').press('Tab');
  await ready(page);
  await page.evaluate(() => window.__studio.switchTo('flowchart'));
  await ready(page);
  await page.reload();
  await ready(page);
  await page.evaluate(() => window.__studio.switchTo('statechart'));
  await ready(page);
  expect((await doc(page)).transitions[0].label).toBe('kept condition');
  // Save and export.
  const [json] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.__studio.run('save')),
  ]);
  expect(JSON.parse(await readFile(await json.path(), 'utf8'))).toEqual(await doc(page));
  const [svgFile] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.__studio.run('export-svg')),
  ]);
  expect(await readFile(await svgFile.path(), 'utf8')).toBe(await svg(page));
});

test('a File menu taller than the window scrolls: the last examples stay reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'File' });
  const box = await menu.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(600);
  expect(await menu.evaluate((m) => m.scrollHeight > m.clientHeight)).toBe(true);
  // Door controller is the last Statechart example, near the bottom of the list.
  await menu.getByRole('menuitem', { name: 'Door controller' }).click();
  await page.waitForFunction(() => window.__studio.kind === 'statechart');
  await ready(page);
  expect((await doc(page)).diagram.name).toBe('Door controller');
});
