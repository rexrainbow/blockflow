// End-to-end checks for blockflow Studio (src/studio).
// The canvas must draw exactly what the agent-kit converter produces for the same JSON.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { convertDiagram } from '../src/agent-kit/blockchart-converter.js';

// The bundled list, read from src/studio/blockchart/examples.js so the tests follow it.
const EXAMPLES = [
  ...(await readFile(new URL('../src/studio/blockchart/examples.js', import.meta.url), 'utf8')).matchAll(
    /examples\/blockchart\/([\w-]+)\.json/g,
  ),
].map((m) => m[1]);
if (!EXAMPLES.length) throw new Error('No bundled examples found in src/studio/blockchart/examples.js');
const FIRST = EXAMPLES[0];

const readExample = async (name) =>
  JSON.parse(await readFile(new URL(`../examples/blockchart/${name}.json`, import.meta.url), 'utf8'));

async function ready(page) {
  await page.waitForFunction(
    () => window.__studio?.store.layout && !window.__studio.store.layoutPending,
    null,
    { timeout: 30000 },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await ready(page);
});

test('first visit shows the first bundled example identical to the converter', async ({ page }) => {
  const reference = await convertDiagram(await readExample(FIRST), { format: 'svg' });
  const svg = await page.evaluate(() => window.__studio.store.layout.svg);
  expect(svg).toBe(reference.text.trimEnd());
});

test('every example and group view matches the converter', async ({ page }) => {
  test.setTimeout(240000);
  for (const name of EXAMPLES) {
    const document = await readExample(name);
    await page.evaluate((doc) => window.__studio.replaceKeepingUndo(doc, 'test'), document);
    await page.waitForTimeout(250);
    await ready(page);
    const reference = await convertDiagram(document, { format: 'svg' });
    expect(await page.evaluate(() => window.__studio.store.layout.svg), name).toBe(reference.text.trimEnd());
    const group = document.groups?.[0]?.id;
    if (group) {
      await page.evaluate((g) => window.__studio.enterGroup(g), group);
      await page.waitForTimeout(250);
      await ready(page);
      const view = await convertDiagram(document, { format: 'svg', rootGroupId: group });
      expect(await page.evaluate(() => window.__studio.store.layout.svg), `${name}@${group}`).toBe(
        view.text.trimEnd(),
      );
    }
  }
});

test('drag from a driving port adds a target to its net', async ({ page }) => {
  await page.evaluate(
    async (doc) => window.__studio.replaceKeepingUndo(doc, 'test'),
    await readExample('nested-groups'),
  );
  await page.waitForTimeout(250);
  await ready(page);
  await page.locator('.canvas').focus();
  await page.keyboard.press('b');
  await page.waitForTimeout(250);
  await ready(page);
  const id = await page.evaluate(() => window.__studio.store.selection.id);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__studio.canvas.fit());
  const from = await page.locator('[data-hit="port"][data-owner="A"][data-port="b_out"]').boundingBox();
  const to = await page.locator(`[data-hit="port"][data-owner="${id}"][data-port="in"]`).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await expect(page.locator('.drag-tip')).toContainText('Add to net');
  await page.mouse.up();
  const net = await page.evaluate(() =>
    window.__studio.store.document.connections.find((c) => c.from === 'A.b_out'),
  );
  expect(net.to).toContain(`${id}.in`);
});

test('inline rename, delete and undo', async ({ page }) => {
  await page.evaluate(
    async (doc) => window.__studio.replaceKeepingUndo(doc, 'test'),
    await readExample('nested-groups'),
  );
  await page.waitForTimeout(250);
  await ready(page);
  await page.evaluate(() => window.__studio.canvas.fit());
  await page.locator('[data-hit="block"][data-id="B"]').dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Decoder');
  await page.keyboard.press('Enter');
  expect(
    await page.evaluate(() => window.__studio.store.document.modules.find((m) => m.id === 'B').label),
  ).toBe('Decoder');
  await page.keyboard.press('Delete');
  expect(await page.evaluate(() => window.__studio.store.document.modules.some((m) => m.id === 'B'))).toBe(
    false,
  );
  await page.getByRole('button', { name: 'Undo' }).first().click();
  expect(await page.evaluate(() => window.__studio.store.document.modules.some((m) => m.id === 'B'))).toBe(
    true,
  );
});

test('theme switch keeps the exported sheet white', async ({ page }) => {
  await page.evaluate(() => window.__studio.cycleTheme('dark'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const sheet = await page.locator('.art svg rect').first().getAttribute('fill');
  expect(sheet).toBe('#ffffff');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).not.toBe('rgb(238, 242, 247)');
});

test('SVG export equals the converter output for the current view', async ({ page }) => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.__studio.run('export-svg')),
  ]);
  const text = await readFile(await download.path(), 'utf8');
  const reference = await convertDiagram(await readExample(FIRST), { format: 'svg' });
  expect(text).toBe(reference.text);
});

test('hiding a side pane keeps the canvas and the other pane in their columns', async ({ page }) => {
  const box = (sel) => page.locator(sel).first().boundingBox();
  const vw = page.viewportSize().width;

  await page.getByRole('button', { name: 'Toggle outline' }).first().click();
  await expect(page.locator('.studio')).toHaveClass(/outline-hidden/);
  let center = await box('.center');
  let inspector = await box('.inspector');
  expect(center.x).toBe(0);
  expect(center.width).toBeGreaterThan(vw / 2);
  expect(inspector.x + inspector.width).toBeCloseTo(vw, 0);
  expect(inspector.width).toBeLessThan(400);

  await page.getByRole('button', { name: 'Toggle inspector' }).first().click();
  center = await box('.center');
  expect(center.x).toBe(0);
  expect(center.width).toBeCloseTo(vw, 0);

  await page.getByRole('button', { name: 'Toggle outline' }).first().click();
  center = await box('.center');
  const outline = await box('.outline');
  expect(outline.x).toBe(0);
  expect(center.x).toBeCloseTo(outline.width, 0);
  expect(center.x + center.width).toBeCloseTo(vw, 0);
});

test('Cells decide container expansion; errors name the cell and keep the draft', async ({ page }) => {
  await page.evaluate(
    async (doc) => window.__studio.replaceKeepingUndo(doc, 'test'),
    await readExample('processor-overview'),
  );
  await page.waitForTimeout(250);
  await ready(page);
  await page.getByRole('tab', { name: 'Layout' }).click();
  const cells = page.locator('textarea[data-fid="grid-cells"]');
  const hint = page.locator('.insp-hint', { hasText: 'Container blocks' });
  await expect(hint).toContainText('ComputeCluster → ALU0');
  await expect(hint).not.toContainText('(expanded)');

  await cells.fill('Clock ALU0 .\nController ALU1 ALU2\n. ALU4 ALU3');
  await cells.press('Control+Enter');
  await expect(hint).toContainText('Sources (expanded)');
  await expect(hint).toContainText('ComputeCluster (expanded)');
  await ready(page);
  const layout = await page.evaluate(() => window.__studio.store.document.layout);
  expect(layout.cells[0]).toEqual(['Clock', 'ALU0', null]);
  expect(layout).not.toHaveProperty('expandGroups');

  const committed = layout.cells;
  await cells.fill('Clock ALU0 ComputeCluster\nController ALU1 ALU2\n. ALU4 ALU3');
  await cells.press('Control+Enter');
  await expect(page.locator('.field-error')).toContainText('Row 1, column 3');
  await expect(cells).toHaveValue(/ComputeCluster/);
  expect(await page.evaluate(() => window.__studio.store.document.layout.cells)).toEqual(committed);

  await cells.fill('Sources ComputeCluster');
  await cells.press('Control+Enter');
  await expect(hint).not.toContainText('(expanded)');
});

test('adding a block to an expanded container places it; opening a file keeps its cells exactly', async ({
  page,
}) => {
  const source = await readExample('processor-cross-group-grid');
  await page.evaluate(async (doc) => window.__studio.replaceKeepingUndo(doc, 'test'), source);
  await page.waitForTimeout(250);
  await ready(page);
  await page.evaluate(() => window.__studio.enterGroup('ComputeCluster'));
  await page.locator('.canvas').focus();
  await page.keyboard.press('b');
  await expect
    .poll(() => page.evaluate(() => window.__studio.store.document.layout.cells[0]))
    .toEqual(['Clock', 'ALU0', 'block_1']);
  await ready(page);
  expect(await page.evaluate(() => window.__studio.store.layoutError)).toBeNull();

  // The replacement differs in membership from the current document; it must load as written.
  await page.evaluate(async (doc) => window.__studio.replaceKeepingUndo(doc, 'test'), source);
  expect(await page.evaluate(() => window.__studio.store.document)).toEqual(source);
});

test('spacing defaults: no Density control; dots show default vs set, Undo, save and group view', async ({
  page,
}) => {
  test.setTimeout(120000); // several full relayouts of the processor example
  // Works before and after the runtime drops density: start from a document without it.
  const source = await readExample('processor-components');
  source.layout = { direction: 'down', moduleSpacing: 180, layerSpacing: 70 };
  await page.evaluate(async (doc) => window.__studio.replaceKeepingUndo(doc, 'test'), source);
  await page.waitForTimeout(250);
  await ready(page);
  await page.evaluate(() => window.__studio.store.select(null));
  await page.getByRole('tab', { name: 'Layout' }).click();
  const docLayout = () => page.evaluate(() => window.__studio.store.document.layout);
  const svgMatches = async (options = {}) => {
    await page.waitForTimeout(250);
    await ready(page);
    const doc = await page.evaluate(() => window.__studio.store.document);
    const reference = await convertDiagram(doc, { format: 'svg', ...options });
    expect(await page.evaluate(() => window.__studio.store.layout.svg)).toBe(reference.text.trimEnd());
  };
  const ms = page.locator('input[data-fid="l-ms"]'),
    ls = page.locator('input[data-fid="l-ls"]'),
    msDot = page.locator('[data-fid="l-ms-dot"]'),
    lsDot = page.locator('[data-fid="l-ls-dot"]');

  // There is one set of defaults: no Density control or preset hint.
  await expect(page.getByText('Density', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-fid^="l-density"]')).toHaveCount(0);
  await expect(page.locator('[data-hint="spacing-override"]')).toHaveCount(0);

  // Authored values: filled dots, values shown, defaults in the tooltip.
  await expect(ms).toHaveValue('180');
  await expect(msDot).toContainClass('on');
  await expect(lsDot).toContainClass('on');
  await expect(msDot).toHaveAttribute('title', 'Set on this diagram — click to use the default (20)');
  await expect(lsDot).toHaveAttribute('title', 'Set on this diagram — click to use the default (30)');
  await svgMatches();

  // Each dot returns its own field to the default.
  await msDot.click();
  await expect.poll(docLayout).toEqual({ direction: 'down', layerSpacing: 70 });
  await expect(ms).toHaveValue('');
  await expect(ms).toHaveAttribute('placeholder', '20');
  await expect(msDot).not.toContainClass('on');
  await expect(msDot).toHaveAttribute('aria-label', 'Block spacing uses the default (20)');
  await lsDot.click();
  await expect.poll(docLayout).toEqual({ direction: 'down' });
  await expect(ls).toHaveAttribute('placeholder', '30');
  await svgMatches();

  // Typing sets a value again.
  await ms.fill('25');
  await ms.press('Enter');
  await expect.poll(docLayout).toEqual({ direction: 'down', moduleSpacing: 25 });
  await expect(msDot).toContainClass('on');
  await svgMatches();

  // Undo walks back through each step; Redo replays.
  await page.evaluate(() => window.__studio.undo());
  await expect.poll(docLayout).toEqual({ direction: 'down' });
  await page.evaluate(() => window.__studio.undo());
  await expect.poll(docLayout).toEqual({ direction: 'down', layerSpacing: 70 });
  await page.evaluate(() => window.__studio.undo());
  await expect.poll(docLayout).toEqual(source.layout);
  await page.evaluate(() => window.__studio.redo());
  await page.evaluate(() => window.__studio.redo());
  await expect.poll(docLayout).toEqual({ direction: 'down' });

  // Saved JSON holds only authoring values: no defaults are written.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.__studio.saveJson()),
  ]);
  const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(saved).toEqual({ ...source, layout: { direction: 'down' } });

  // Group views use the same defaults.
  const group = source.groups[0].id;
  await page.evaluate((g) => window.__studio.enterGroup(g), group);
  await svgMatches({ rootGroupId: group });
  await page.evaluate(() => window.__studio.enterGroup(''));
});

test('Concat bar follows Flow: fixed sides, Flow change, creation, edits, Undo and invalid files', async ({
  page,
}) => {
  const source = await readExample('concat-feedback'); // Down flow, Concat "Sources" with a feedback input
  const authored = structuredClone(source);
  for (const p of authored.modules[1].ports) p.side = p.direction === 'input' ? 'top' : 'bottom';
  await page.evaluate(async (doc) => window.__studio.replaceKeepingUndo(doc, 'test'), authored);
  const doc = () => page.evaluate(() => window.__studio.store.document);
  const concat = async () => (await doc()).modules.find((m) => m.id === 'Sources');
  const svgMatches = async () => {
    await page.waitForTimeout(250);
    await ready(page);
    const reference = await convertDiagram(await doc(), { format: 'svg' });
    expect(await page.evaluate(() => window.__studio.store.layout.svg)).toBe(reference.text.trimEnd());
  };
  await svgMatches();

  // The inspector shows the Flow sides as fixed text and offers no shape.
  await page.locator('.outline').getByText('Sources', { exact: true }).click();
  const sides = page.locator('.inspector .side-fixed');
  await expect(sides).toHaveText(['Top', 'Top', 'Bottom']);
  await expect(page.locator('.inspector .prow select')).toHaveCount(0);
  await expect(page.locator('[data-hint="concat-sides"]')).toContainText('inputs on top in order');
  await expect(page.getByRole('radiogroup', { name: 'Block shape' })).toHaveCount(0);

  // The toolbar adds the next input (a second output is not allowed).
  await page.getByRole('button', { name: 'Add input port (next in order)' }).click();
  await expect
    .poll(async () => (await concat()).ports.map((p) => p.direction))
    .toEqual(['input', 'input', 'output', 'input']);
  expect((await concat()).ports[3]).not.toHaveProperty('side');
  await svgMatches();

  // A label edit keeps the bar thin; the name is reserved outside it.
  await page.locator('.outline').getByText('Sources', { exact: true }).click();
  const label = page.locator('[data-fid="b-label"]');
  await label.fill('Source pool');
  await label.press('Control+Enter');
  await expect.poll(async () => (await concat()).label).toBe('Source pool');
  await svgMatches();
  const bar = await page.evaluate(() =>
    window.__studio.store.layout.layout.modules.find((m) => m.id === 'Sources'),
  );
  expect(bar.body.shapes[0].height).toBeLessThanOrEqual(12);

  // Changing Flow clears explicit Concat sides in the same step.
  await page
    .getByRole('radiogroup', { name: 'Flow direction' })
    .getByRole('radio', { name: 'L → R' })
    .click();
  await expect.poll(async () => (await doc()).layout).toBeUndefined();
  expect((await concat()).ports.every((p) => p.side === undefined)).toBe(true);
  await svgMatches();
  await page.locator('.outline').getByText('Source pool', { exact: true }).click();
  await expect(sides).toHaveText(['Left', 'Left', 'Right', 'Left']);
  const right = await page.evaluate(() =>
    window.__studio.store.layout.layout.modules.find((m) => m.id === 'Sources'),
  );
  expect(right.ports.map((p) => p.side)).toEqual(['left', 'left', 'right', 'left']);
  expect(right.body.shapes[0].width).toBeLessThanOrEqual(12);
  // Port hit targets sit on the published anchors.
  const hits = await page.$$eval('.hit-port[data-owner="Sources"]', (els) =>
    els.map((e) => [+e.getAttribute('cx'), +e.getAttribute('cy')]),
  );
  expect(hits).toEqual(right.ports.map((p) => [p.x, p.y]));

  // Undo restores Down and the authored sides; Redo clears them again.
  await page.evaluate(() => window.__studio.undo());
  await expect.poll(async () => (await doc()).layout).toEqual({ direction: 'down' });
  expect((await concat()).ports.map((p) => p.side)).toEqual(['top', 'top', 'bottom', undefined]);
  await page.evaluate(() => window.__studio.redo());
  await expect.poll(async () => (await doc()).layout).toBeUndefined();

  // A new Concat has no side or appearance and lays out in Right flow.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Command' }).fill('Add concat');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await doc()).modules.length).toBe(4);
  const created = (await doc()).modules[3];
  expect(created).toMatchObject({ type: 'concat' });
  expect(created).not.toHaveProperty('appearance');
  expect(created.ports.every((p) => p.side === undefined)).toBe(true);
  await svgMatches();

  // Saved JSON holds only authoring values.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.__studio.saveJson()),
  ]);
  const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(saved).toEqual(await doc());
  expect(JSON.stringify(saved)).not.toContain('"body"');

  // Conflicting sides or another shape in an opened file are reported at their path; nothing changes.
  const before = await doc();
  for (const [name, broken, path] of [
    ['bad-side.json', (d) => (d.modules[1].ports[0].side = 'left'), 'modules[1].ports[0].side'],
    ['bad-shape.json', (d) => (d.modules[1].appearance = { type: 'rectangle' }), 'modules[1].appearance'],
  ]) {
    const file = structuredClone(source);
    broken(file);
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await expect(page.locator('.toasts')).toContainText(path);
    expect(await doc()).toEqual(before);
  }
});

test('Copy JSON puts exactly the saved file on the clipboard, from any view', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.__studio.saveJson()),
  ]);
  const saved = await readFile(await download.path(), 'utf8');
  // The OS clipboard may turn \n into \r\n on Windows; the text is otherwise identical.
  const clipboard = async () =>
    (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  const doc = await page.evaluate(() => window.__studio.store.document);

  // File menu.
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Copy JSON to clipboard' }).click();
  await expect(page.locator('.toasts')).toContainText(`Copied JSON · ${doc.modules.length} blocks`);
  expect(await clipboard()).toBe(saved);

  // Export menu inside a group view still copies the whole diagram.
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.evaluate((g) => window.__studio.enterGroup(g), doc.groups[0].id);
  await ready(page);
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.locator('.menu')).toContainText('Whole diagram source');
  await page.getByRole('menuitem', { name: 'Copy JSON' }).click();
  await expect.poll(clipboard).toBe(saved);

  // Command palette.
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Command' }).fill('Copy JSON');
  await page.keyboard.press('Enter');
  await expect.poll(clipboard).toBe(saved);
});

test('Copy JSON falls back to a dialog with the text selected when the clipboard is blocked', async ({
  page,
}) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('blocked')) },
    });
    document.execCommand = () => false;
  });
  const text = await page.evaluate(() => JSON.stringify(window.__studio.store.document, null, 2) + '\n');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Copy JSON to clipboard' }).click();
  const dialog = page.getByRole('dialog', { name: 'Copy JSON' });
  await expect(dialog).toBeVisible();
  const box = dialog.getByRole('textbox', { name: 'Diagram JSON' });
  await expect(box).toHaveValue(text);
  await expect(box).toBeFocused();
  expect(await box.evaluate((el) => [el.selectionStart, el.selectionEnd])).toEqual([0, text.length]);
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(dialog).toHaveCount(0);
});

test('retired layout.density: opened files and a stored draft report the runtime error; nothing is migrated', async ({
  page,
}) => {
  const source = await readExample(FIRST);
  expect(source.layout).not.toHaveProperty('density');

  // Opening a file with the retired field (any value) is refused at layout.density.
  const before = await page.evaluate(() => window.__studio.store.document);
  for (const density of ['standard', 'compact']) {
    await page.locator('input[type="file"]').setInputFiles({
      name: `retired-${density}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...source, layout: { ...source.layout, density } })),
    });
    await expect(page.locator('.toasts')).toContainText('layout.density');
    expect(await page.evaluate(() => window.__studio.store.document)).toEqual(before);
    await page.locator('.toasts .toast').first().getByRole('button', { name: 'Dismiss' }).click();
  }

  // A draft stored before the change is kept aside, reported, and offered back unchanged.
  const draft = {
    ...source,
    diagram: { ...source.diagram, name: 'Old draft' },
    layout: { direction: 'down', density: 'compact' },
  };
  await page.evaluate(
    (d) => localStorage.setItem('blockflow.editor.v1', JSON.stringify({ document: d })),
    draft,
  );
  await page.reload();
  await ready(page);
  const notice = page.locator('.toast.error', { hasText: 'Your last browser diagram was not opened' });
  await expect(notice).toContainText('layout.density');
  await expect(notice).toContainText('. A copy is kept: File › Save unopened draft.');
  expect(await page.evaluate(() => window.__studio.store.document.diagram.name)).toBe(source.diagram.name);
  // Autosave of the replacement document does not destroy the kept draft.
  await page.waitForTimeout(500);
  expect(
    JSON.parse(await page.evaluate(() => localStorage.getItem('blockflow.editor.v1.rejected'))).document,
  ).toEqual(draft);

  // The notice is shown once: dismissing it and reloading does not report it again.
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await page.reload();
  await ready(page);
  await expect(page.locator('.toast.error')).toHaveCount(0);

  // The kept copy stays available from File until it is saved.
  await page.getByRole('button', { name: 'File' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Save unopened draft' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Old-draft-unopened.json');
  expect(JSON.parse(await readFile(await download.path(), 'utf8'))).toEqual(draft);
  expect(await page.evaluate(() => localStorage.getItem('blockflow.editor.v1.rejected'))).toBeNull();
  await page.getByRole('button', { name: 'File' }).click();
  await expect(page.getByRole('menuitem', { name: 'Save unopened draft' })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('Container titles overlap wires continuously; the current drawing owns its ids during the cross-fade', async ({
  page,
}) => {
  // First example: Down flow with nested Containers whose titles are crossed by wires.
  const art = () =>
    page.evaluate(() => {
      const svg = document.querySelector('.art:not(.leaving) svg');
      return {
        titleMasks: svg.querySelectorAll('[data-role="container-title-mask"], [id$="container-title-mask"]')
          .length,
        layerMask: svg.querySelector('[data-role="connection-layer"]')?.getAttribute('mask') ?? null,
        labelMasks: svg.querySelectorAll('mask[id*="connection-label-mask"]').length,
      };
    });
  const before = await art();
  expect(before).toMatchObject({ titleMasks: 0, layerMask: null });
  expect(before.labelMasks, 'connection-label masks still use ids').toBeGreaterThan(0);

  // Relayout and catch the fade: exactly one element owns each default id.
  const fade = page.waitForFunction(
    () => {
      const leaving = document.querySelector('.art.leaving');
      if (!leaving) return false;
      const current = document.querySelector('.art:not(.leaving)');
      const dup = [...current.querySelectorAll('[id]')].filter(
        (el) => document.querySelectorAll(`[id="${CSS.escape(el.id)}"]`).length > 1,
      );
      const refs = [...leaving.querySelectorAll('[mask]')].map(
        (el) => el.getAttribute('mask').match(/#([^)]+)/)[1],
      );
      return {
        duplicates: dup.length,
        leavingRenamed: [...leaving.querySelectorAll('[id]')].every((el) => el.id.startsWith('leaving-')),
        leavingRefsResolveInside:
          refs.length > 0 && refs.every((id) => leaving.querySelector(`[id="${CSS.escape(id)}"]`)),
      };
    },
    null,
    { polling: 'raf', timeout: 15000 },
  );
  await page.evaluate(() => {
    const d = structuredClone(window.__studio.store.document);
    d.layout = { ...d.layout, moduleSpacing: 40 };
    window.__studio.replaceKeepingUndo(d, 'test');
  });
  expect(await (await fade).jsonValue()).toEqual({
    duplicates: 0,
    leavingRenamed: true,
    leavingRefsResolveInside: true,
  });
  await ready(page);
  await page.waitForTimeout(300);
  expect(await page.locator('.art').count()).toBe(1);

  // A wire crossing a title is drawn through it (no mask on any of its ancestors) and is clickable there.
  const probe = await page.evaluate(() => {
    const L = window.__studio.store.layout.layout;
    const titles = L.groups.filter((g) => !g.collapsed && g.labelBounds?.width > 0).map((g) => g.labelBounds);
    for (const c of L.connections)
      for (const s of c.sections)
        for (let i = 1; i < s.points.length; i++) {
          const [a, b] = [s.points[i - 1], s.points[i]];
          for (const r of titles) {
            if (a.x === b.x && a.x > r.x && a.x < r.x + r.width) {
              const y = Math.max(Math.min(a.y, b.y), r.y) + 1;
              if (y < Math.min(Math.max(a.y, b.y), r.y + r.height)) return { x: a.x, y };
            }
            if (a.y === b.y && a.y > r.y && a.y < r.y + r.height) {
              const x = Math.max(Math.min(a.x, b.x), r.x) + 1;
              if (x < Math.min(Math.max(a.x, b.x), r.x + r.width)) return { x, y: a.y };
            }
          }
        }
    return null;
  });
  expect(probe, 'the first example has a wire crossing a Container title').not.toBeNull();
  expect(await art()).toMatchObject({ titleMasks: 0, layerMask: null });
  await page.evaluate(({ x, y }) => window.__studio.canvas.zoomTo?.({ x, y }) ?? null, probe);
  const hit = await page.evaluate(({ x, y }) => {
    const overlay = document.querySelector('.overlay');
    const m = overlay.getScreenCTM();
    const p = new DOMPoint(x, y).matrixTransform(m);
    return document.elementsFromPoint(p.x, p.y).some((el) => el.dataset?.hit === 'net');
  }, probe);
  expect(hit).toBe(true);
});

test('a group moves into another group by its title, Move to… or Inside; never into itself', async ({
  page,
}) => {
  const parentOf = (id) =>
    page.evaluate(
      (id) => window.__studio.store.document.groups.find((g) => g.members.includes(id))?.id ?? '',
      id,
    );
  await page.evaluate(() => window.__studio.canvas.fit());
  await page.waitForTimeout(250);
  // Zoomed out, every title strip (the group's drag handle) stays at least 16 screen px tall.
  // (or the whole group, when the group itself is smaller than that on screen).
  const short = await page.$$eval('[data-hit="group-title"]', (els) =>
    els
      .map((e) => {
        const box = document
          .querySelector(`[data-hit="group"][data-id="${e.dataset.id}"]`)
          .getBoundingClientRect();
        return { id: e.dataset.id, title: e.getBoundingClientRect().height, group: box.height };
      })
      .filter((t) => t.title < Math.min(16, t.group) - 0.5),
  );
  expect(await page.evaluate(() => window.__studio.canvas.camera.z)).toBeLessThan(0.5);
  expect(short).toEqual([]);

  // Find a screen point whose top hit is the given kind/id.
  const pointOn = (hit, id) =>
    page.evaluate(
      ({ hit, id }) => {
        const el = document.querySelector(`[data-hit="${hit}"][data-id="${id}"]`);
        const r = el.getBoundingClientRect();
        for (let y = r.top + 2; y < r.bottom - 1; y += 3)
          for (let x = r.left + 2; x < r.right - 1; x += 3) {
            const top = document.elementFromPoint(x, y)?.closest('[data-hit]');
            if (top?.dataset.hit === hit && top.dataset.id === id) return { x, y };
          }
        return null;
      },
      { hit, id },
    );
  const from = await pointOn('group-title', 'WritebackStage');
  const to = await pointOn('group', 'InterruptSubsystem');
  expect(from && to).toBeTruthy();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(page.locator('.drag-tip').filter({ hasText: 'Move into Interrupts' })).toHaveCount(1);
  await page.mouse.up();
  expect(await parentOf('WritebackStage')).toBe('InterruptSubsystem');
  await page.getByRole('button', { name: 'Undo' }).first().click();
  expect(await parentOf('WritebackStage')).toBe('Processor');
  await ready(page);

  // Context menu › Move to…: the current parent is marked; the group itself and its descendants are absent.
  await page.evaluate(() =>
    window.__studio.contextMenu({ type: 'group', id: 'Processor' }, { x: 300, y: 200 }),
  );
  await page.getByRole('menuitem', { name: 'Move to…' }).click();
  const offered = await page.$$eval('.menu .menu-item', (els) => els.map((e) => e.textContent.trim()));
  expect(offered).toEqual(['Top level', 'Input subsystem', 'Input conditioning', 'Interrupts']);
  await expect(page.getByRole('menuitemradio', { name: 'Top level' })).toBeDisabled();
  await page.getByRole('menuitemradio', { name: 'Interrupts' }).click();
  expect(await parentOf('Processor')).toBe('InterruptSubsystem');
  await page.keyboard.press('Control+z');
  expect(await parentOf('Processor')).toBe('');
  await ready(page);

  // Inspector › Inside, for a group and for a block.
  await page.evaluate(() => window.__studio.select({ type: 'group', id: 'DecodeStage' }));
  const inside = page.locator('[data-fid="g-inside"]');
  await expect(inside).toHaveValue('Processor');
  expect(await inside.locator('option').allTextContents()).not.toContain('Decode');
  await inside.selectOption('InputSubsystem');
  expect(await parentOf('DecodeStage')).toBe('InputSubsystem');
  await page.evaluate(() => window.__studio.select({ type: 'block', id: 'ALU' }));
  await page.locator('[data-fid="b-inside"]').selectOption('');
  expect(await parentOf('ALU')).toBe('');
});

test('group spacing: inherited vs set per property, clear, invalid, root and mode changes, Flow, save, group view', async ({
  page,
}) => {
  const source = await readExample('local-layout-spacing');
  await page.evaluate(async (doc) => window.__studio.replaceKeepingUndo(doc, 'test'), source);
  await page.waitForTimeout(250);
  await ready(page);
  const doc = () => page.evaluate(() => window.__studio.store.document);
  const groupLayout = (id) =>
    page.evaluate((id) => window.__studio.store.document.groups.find((g) => g.id === id).layout, id);
  const svgMatches = async (options = {}) => {
    await page.waitForTimeout(250);
    await ready(page);
    const reference = await convertDiagram(await doc(), { format: 'svg', ...options });
    expect(await page.evaluate(() => window.__studio.store.layout.svg)).toBe(reference.text.trimEnd());
  };
  const open = async (id) => {
    await page.evaluate((id) => window.__studio.select({ type: 'group', id }), id);
    await page.getByRole('tab', { name: 'Layout' }).click();
  };
  const ms = page.locator('input[data-fid="g-ms"]'),
    ls = page.locator('input[data-fid="g-ls"]'),
    msDot = page.locator('[data-fid="g-ms-dot"]'),
    lsDot = page.locator('[data-fid="g-ls-dot"]');
  await svgMatches();

  // Each property inherits on its own: Inner sets Block spacing, inherits Layer spacing from Complex.
  await open('Inner');
  await expect(ms).toHaveValue('24');
  await expect(msDot).toContainClass('on');
  await expect(ls).toHaveValue('');
  await expect(ls).toHaveAttribute('placeholder', '80');
  await expect(lsDot).not.toContainClass('on');
  await expect(lsDot).toHaveAttribute('title', 'Inherited from group Complex (80)');
  await expect(msDot).toHaveAttribute(
    'title',
    'Set on this group — click to inherit from group Complex (60)',
  );

  // The dot clears only that property; the now-empty layout object is removed.
  await msDot.click();
  await expect.poll(() => groupLayout('Inner')).toBeUndefined();
  await expect(ms).toHaveAttribute('placeholder', '60');
  await svgMatches();
  await page.evaluate(() => window.__studio.undo());
  await expect.poll(() => groupLayout('Inner')).toEqual({ moduleSpacing: 24 });

  // Invalid values stay in the field; nothing is written.
  await ready(page);
  await open('Regular');
  await expect(ms).toHaveAttribute('placeholder', '20');
  await ms.fill('0');
  await ms.press('Enter');
  await expect(page.locator('.field-error')).toContainText('Block spacing must be a positive number.');
  expect(await groupLayout('Regular')).toBeUndefined();
  await ms.press('Escape');
  await ls.fill('12.5');
  await ls.press('Enter');
  await expect.poll(() => groupLayout('Regular')).toEqual({ layerSpacing: 12.5 });
  await svgMatches();

  // A root change reaches groups that inherit from the diagram, not those inheriting from Complex.
  await page.evaluate(() => window.__studio.select(null));
  await page.getByRole('tab', { name: 'Layout' }).click();
  await page.locator('input[data-fid="l-ms"]').fill('40');
  await page.locator('input[data-fid="l-ms"]').press('Enter');
  await open('Regular');
  await expect(ms).toHaveAttribute('placeholder', '40');
  await expect(msDot).toHaveAttribute('title', 'Inherited from the diagram (40)');
  await open('Inner');
  await expect(ls).toHaveAttribute('placeholder', '80');
  await svgMatches();

  // Grid and back keeps local spacing; Grid shows where spacing still applies.
  await open('Complex');
  await page.locator('[data-fid="grid-mode-grid"]').click();
  await expect(page.locator('[data-hint="spacing-grid"]')).toHaveCount(1);
  await expect
    .poll(() => groupLayout('Complex'))
    .toMatchObject({ type: 'grid', moduleSpacing: 60, layerSpacing: 80 });
  await page.locator('[data-fid="grid-mode-auto"]').click();
  await expect.poll(() => groupLayout('Complex')).toEqual({ moduleSpacing: 60, layerSpacing: 80 });
  await svgMatches();

  // The other Flow axis, a scoped group view, then Save: only explicit values are written.
  await page.evaluate(() => window.__studio.select(null));
  await page.getByRole('tab', { name: 'Layout' }).click();
  await page.locator('[data-fid="l-dir-right"]').click();
  await expect.poll(async () => (await doc()).layout).toEqual({ moduleSpacing: 40, layerSpacing: 30 });
  await svgMatches();
  await page.evaluate(() => window.__studio.enterGroup('Complex'));
  await svgMatches({ rootGroupId: 'Complex' });
  await page.evaluate(() => window.__studio.enterGroup(''));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.__studio.saveJson()),
  ]);
  const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(saved).toEqual(await doc());
  expect(saved.groups.find((g) => g.id === 'Inner').layout).toEqual({ moduleSpacing: 24 });
  expect(saved.groups.find((g) => g.id === 'Regular').layout).toEqual({ layerSpacing: 12.5 });
  expect(saved.layout).toEqual({ moduleSpacing: 40, layerSpacing: 30 });
});

test('Grid block minimums: per-axis Auto, fractions, invalid values, Auto cleanup, Undo, save, group view, Flow', async ({
  page,
}) => {
  const source = await readExample('grid-block-minimums');
  await page.evaluate(async (doc) => window.__studio.replaceKeepingUndo(doc, 'test'), source);
  await page.waitForTimeout(250);
  await ready(page);
  const doc = () => page.evaluate(() => window.__studio.store.document);
  const box = (id) =>
    page.evaluate((id) => {
      const m = window.__studio.store.layout.layout.modules.find((n) => n.id === id);
      return m && [m.width, Math.round(m.height)];
    }, id);
  // Ports stay on the border of their (resized) block.
  const portsAttached = () =>
    page.evaluate(() =>
      window.__studio.store.layout.layout.modules.every((m) =>
        (m.ports ?? []).every((p) =>
          p.side === 'left' || p.side === 'right'
            ? Math.abs(p.x - (p.side === 'left' ? m.x : m.x + m.width)) < 0.01 &&
              p.y >= m.y &&
              p.y <= m.y + m.height
            : Math.abs(p.y - (p.side === 'top' ? m.y : m.y + m.height)) < 0.01 &&
              p.x >= m.x &&
              p.x <= m.x + m.width,
        ),
      ),
    );
  const svgMatches = async (options = {}) => {
    await page.waitForTimeout(250);
    await ready(page);
    const reference = await convertDiagram(await doc(), { format: 'svg', ...options });
    expect(await page.evaluate(() => window.__studio.store.layout.svg)).toBe(reference.text.trimEnd());
  };
  const bmw = page.locator('input[data-fid="grid-bmw"]'),
    bmh = page.locator('input[data-fid="grid-bmh"]');
  const set = async (input, value) => {
    await input.fill(value);
    await input.press('Enter');
  };
  await svgMatches();
  expect(await box('ALU')).toEqual([252, 105]);
  expect(await box('Status')).toEqual([252, 105]);
  expect(await box('Processor')).toEqual([336, 105]);
  expect(await box('Monitor')).toEqual([122, 54]);
  expect(await portsAttached()).toBe(true);

  await page.evaluate(() => window.__studio.select(null));
  await page.getByRole('tab', { name: 'Layout' }).click();
  await expect(bmw).toHaveValue('1.8');
  await expect(bmh).toHaveValue('1.25');
  await expect(page.locator('[data-hint="grid-block-min"]')).toHaveCount(1);

  // Clearing one axis removes only that key; the other stays.
  await set(bmh, '');
  await expect.poll(async () => Object.hasOwn((await doc()).layout, 'blockMinHeight')).toBe(false);
  expect((await doc()).layout.blockMinWidth).toBe(1.8);
  await expect(bmh).toHaveAttribute('placeholder', 'Auto');
  await svgMatches();
  expect((await box('ALU'))[0]).toBe(252);
  expect((await box('ALU'))[1]).toBeLessThan(105);

  // Invalid values keep the field and write nothing.
  for (const bad of ['0', '-1']) {
    await set(bmw, bad);
    await expect(page.locator('.field-error')).toContainText('Block min width must be a positive number');
    expect((await doc()).layout.blockMinWidth).toBe(1.8);
    await bmw.press('Escape');
  }

  // A fraction; Undo and Redo follow the history.
  await set(bmw, '2.25');
  await expect.poll(async () => (await doc()).layout.blockMinWidth).toBe(2.25);
  await svgMatches();
  expect((await box('ALU'))[0]).toBe(315);
  await page.evaluate(() => window.__studio.undo());
  await expect.poll(async () => (await doc()).layout.blockMinWidth).toBe(1.8);
  await page.evaluate(() => window.__studio.redo());
  await expect.poll(async () => (await doc()).layout.blockMinWidth).toBe(2.25);

  // Down flow uses the same physical units for each axis.
  await page.locator('[data-fid="l-dir-down"]').click();
  await expect.poll(async () => (await doc()).layout.direction).toBe('down');
  await svgMatches();
  expect((await box('ALU'))[0]).toBe(315);
  expect(await portsAttached()).toBe(true);
  await page.locator('[data-fid="l-dir-right"]').click();
  await ready(page);

  // Save keeps the authored values and omissions exactly.
  await set(bmh, '1.25');
  await expect.poll(async () => (await doc()).layout.blockMinHeight).toBe(1.25);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.__studio.saveJson()),
  ]);
  const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(saved).toEqual(await doc());
  expect(saved.modules.find((m) => m.id === 'Processor').width).toBe(2.4);
  expect(
    Object.hasOwn(
      saved.modules.find((m) => m.id === 'ALU'),
      'width',
    ),
  ).toBe(false);

  // Auto removes both bounds with the other Grid-only fields.
  await page.locator('[data-fid="grid-mode-auto"]').click();
  await expect
    .poll(async () => Object.keys((await doc()).layout ?? {}).filter((k) => k !== 'direction'))
    .toEqual([]);
  await svgMatches();
  expect(await box('ALU')).not.toEqual([315, 105]);

  // A group Grid: only the blocks written in its cells get the floor, also in the group view.
  const grouped = structuredClone(source);
  grouped.groups = [
    { id: 'Core', members: ['ALU', 'Decoder'], layout: { type: 'grid', cells: [['ALU'], ['Decoder']] } },
  ];
  delete grouped.layout;
  await page.evaluate(async (doc) => window.__studio.replaceKeepingUndo(doc, 'test'), grouped);
  await page.waitForTimeout(250);
  await ready(page);
  await page.evaluate(() => window.__studio.select({ type: 'group', id: 'Core' }));
  await page.getByRole('tab', { name: 'Layout' }).click();
  await set(bmw, '2');
  await expect
    .poll(async () => (await doc()).groups[0].layout)
    .toEqual({ type: 'grid', cells: [['ALU'], ['Decoder']], blockMinWidth: 2 });
  await svgMatches();
  expect((await box('ALU'))[0]).toBe(280);
  expect((await box('Status'))[0]).toBeLessThan(280);
  await page.evaluate(() => window.__studio.enterGroup('Core'));
  await svgMatches({ rootGroupId: 'Core' });
  expect((await box('Decoder'))[0]).toBe(280);
  await page.evaluate(() => window.__studio.enterGroup(''));
  await ready(page);
  await page.evaluate(() => window.__studio.select({ type: 'group', id: 'Core' }));
  await page.getByRole('tab', { name: 'Layout' }).click();
  await page.locator('[data-fid="grid-mode-auto"]').click();
  await expect.poll(async () => (await doc()).groups[0].layout).toBeUndefined();
});

test('Grid block alignment: Left/Center/Right, default Center, Flow, group Grid and view, Undo, save, Auto cleanup', async ({
  page,
}) => {
  const source = await readExample('grid-block-alignment');
  await page.evaluate(async (doc) => window.__studio.replaceKeepingUndo(doc, 'test'), source);
  await page.waitForTimeout(250);
  await ready(page);
  const doc = () => page.evaluate(() => window.__studio.store.document);
  // Physical x-range and width of a block or group in the current drawing.
  const span = (id) =>
    page.evaluate((id) => {
      const L = window.__studio.store.layout.layout;
      const n = L.modules.find((m) => m.id === id) ?? L.groups.find((g) => g.id === id);
      return { left: n.x, right: n.x + n.width, width: n.width };
    }, id);
  const svgMatches = async (options = {}) => {
    await page.waitForTimeout(250);
    await ready(page);
    const reference = await convertDiagram(await doc(), { format: 'svg', ...options });
    expect(await page.evaluate(() => window.__studio.store.layout.svg)).toBe(reference.text.trimEnd());
  };
  const near = (a, b) => Math.abs(a - b) < 0.01;
  const check = async (align, a, b) => {
    // Left/Right align body edges; Center keeps the runtime's label-envelope centering
    // (bodies can differ by a label's overhang), so it is covered by converter parity.
    const [p, q] = [await span(a), await span(b)];
    if (align === 'left') expect(near(p.left, q.left)).toBe(true);
    if (align === 'right') expect(near(p.right, q.right)).toBe(true);
    return [p.width, q.width];
  };
  const radio = (v) => page.locator(`[data-fid="grid-align-${v}"]`);
  const layoutTab = async (group) => {
    await page.evaluate((id) => window.__studio.select(id ? { type: 'group', id } : null), group);
    await page.getByRole('tab', { name: 'Layout' }).click();
  };

  // Unequal widths in one column (Source 140, Converter 308); the Core Container cell aligns whole.
  await svgMatches();
  await layoutTab(null);
  await expect(radio('left')).toHaveAttribute('aria-checked', 'true');
  expect(await check('left', 'Source', 'Converter')).toEqual([140, 308]);
  await check('left', 'Core', 'Sink');
  for (const align of ['right', 'center']) {
    await radio(align).click();
    await expect
      .poll(async () => (await doc()).layout.blockAlign)
      .toBe(align === 'center' ? undefined : align);
    await svgMatches();
    expect(await check(align, 'Source', 'Converter')).toEqual([140, 308]);
    await check(align, 'Core', 'Sink');
  }
  // Omitted means Center; Undo/Redo follow the history.
  expect(Object.hasOwn((await doc()).layout, 'blockAlign')).toBe(false);
  await expect(radio('center')).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => window.__studio.undo());
  await expect.poll(async () => (await doc()).layout.blockAlign).toBe('right');
  await page.evaluate(() => window.__studio.redo());
  await expect.poll(async () => Object.hasOwn((await doc()).layout, 'blockAlign')).toBe(false);

  // Down flow: still physical horizontal alignment.
  await radio('right').click();
  await page.locator('[data-fid="l-dir-down"]').click();
  await expect.poll(async () => (await doc()).layout.direction).toBe('down');
  await svgMatches();
  await check('right', 'Source', 'Converter');
  await page.locator('[data-fid="l-dir-right"]').click();
  await ready(page);

  // A group Grid aligns its own cells, also in its group view; the root Grid is separate.
  await page.evaluate(
    async (doc) => {
      doc.groups[0].layout = { type: 'grid', cells: [['Filter'], ['Scale']] };
      doc.modules.find((m) => m.id === 'Scale').width = 1.8;
      return window.__studio.replaceKeepingUndo(doc, 'test');
    },
    await doc(),
  );
  await page.waitForTimeout(250);
  await ready(page);
  await layoutTab('Core');
  await expect(radio('center')).toHaveAttribute('aria-checked', 'true');
  await radio('left').click();
  await expect.poll(async () => (await doc()).groups[0].layout.blockAlign).toBe('left');
  await svgMatches();
  await check('left', 'Filter', 'Scale');
  await check('right', 'Source', 'Converter');
  await page.evaluate(() => window.__studio.enterGroup('Core'));
  await svgMatches({ rootGroupId: 'Core' });
  await check('left', 'Filter', 'Scale');
  await page.evaluate(() => window.__studio.enterGroup(''));
  await ready(page);

  // Save keeps the authored values; Automatic removes blockAlign with the other Grid-only fields.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.__studio.saveJson()),
  ]);
  const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(saved).toEqual(await doc());
  expect(saved.layout.blockAlign).toBe('right');
  expect(saved.groups[0].layout.blockAlign).toBe('left');
  await layoutTab('Core');
  await page.locator('[data-fid="grid-mode-auto"]').click();
  await expect.poll(async () => (await doc()).groups[0].layout).toBeUndefined();
  await layoutTab(null);
  await page.locator('[data-fid="grid-mode-auto"]').click();
  await expect
    .poll(async () => Object.keys((await doc()).layout ?? {}).filter((k) => k !== 'direction'))
    .toEqual([]);
  await svgMatches();
});

test('Net junction dots: drawn as the converter, picked by their disk, never saved', async ({ page }) => {
  const fanout = {
    version: 1,
    diagram: { name: 'Fanout' },
    modules: [
      { id: 'A', ports: [{ id: 'out', direction: 'output' }] },
      ...['B', 'C', 'D'].map((id) => ({ id, ports: [{ id: 'in', direction: 'input' }] })),
    ],
    connections: [{ from: 'A.out', to: ['B.in', 'C.in', 'D.in'] }],
  };
  await page.evaluate(async (doc) => window.__studio.replaceKeepingUndo(doc, 'test'), fanout);
  await page.waitForTimeout(250);
  await ready(page);
  const reference = await convertDiagram(structuredClone(fanout), { format: 'svg' });
  const svg = await page.evaluate(() => window.__studio.store.layout.svg);
  expect(svg).toBe(reference.text.trimEnd());
  const junctions = await page.evaluate(() => window.__studio.store.layout.layout.junctions);
  expect(junctions.length).toBeGreaterThan(0);
  expect(svg.match(/data-role="connection-junction"/g)).toHaveLength(junctions.length);

  // A click on the dot's disk, off both strokes at 400%, selects its Net.
  const j = junctions[0];
  const at = await page.evaluate((p) => {
    const c = window.__studio.canvas;
    const r = c.el.getBoundingClientRect();
    c.camera.z = 4;
    c.camera.x = r.width / 2 - (p.x + c.margin) * 4;
    c.camera.y = r.height / 2 - (p.y + c.margin) * 4;
    c.applyCamera();
    window.__studio.select(null);
    // 2 units off both axes = 8 screen px from either stroke (the stroke hit is 5 px wide each side).
    return { x: r.left + r.width / 2 + 8, y: r.top + r.height / 2 + 8 };
  }, j);
  await page.mouse.click(at.x, at.y);
  await expect
    .poll(() => page.evaluate(() => window.__studio.store.selection))
    .toMatchObject({ type: 'net', index: 0 });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.__studio.saveJson()),
  ]);
  const saved = await readFile(await download.path(), 'utf8');
  expect(JSON.parse(saved)).toEqual(fanout);
  expect(saved).not.toContain('junction');
});
