import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const previewActionsDocument = () => ({
  version: 1,
  diagram: { name: 'Preview editing' },
  modules: [
    { id: 'Source', ports: [{ id: 'out', direction: 'output' }] },
    ...['A', 'B'].map((id) => ({
      id,
      ports: [
        { id: 'in', direction: 'input' },
        { id: 'out', direction: 'output' },
      ],
    })),
    {
      id: 'Sink',
      ports: [
        { id: 'a', direction: 'input' },
        { id: 'b', direction: 'input' },
      ],
    },
  ],
  groups: [
    { id: 'Frame', type: 'container', members: ['G'] },
    { id: 'G', label: 'Processing', type: 'collection', members: ['A', 'B'] },
  ],
  connections: [
    { from: 'Source.out', to: 'A.in', label: 'Data' },
    { from: 'Source.out', to: 'B.in' },
    { from: 'A.out', to: 'Sink.a' },
    { from: 'B.out', to: 'Sink.b' },
  ],
});

async function previewOnly(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await page.locator('.studio').getAttribute('data-view')) === 'preview') return;
    await page.locator('[data-action="cycle-view"]').click();
  }
}

test('Group view opens a hidden boundary subtree and exports its frame, ports and internal connections', async ({
  page,
}) => {
  const raw = JSON.parse(
    await readFile(new URL('../examples/boundary-groups.json', import.meta.url), 'utf8'),
  );
  raw.groups.forEach((group) => (group.collapsed = true));
  await importJson(page, raw);
  await ready(page);
  await previewOnly(page);
  await expect(page.locator('.block-hit')).toHaveCount(2);
  const target = page.getByRole('combobox', { name: 'View target', exact: true });
  await expect(target.locator('option')).toHaveText([
    'Top',
    ...raw.groups.map((group) => group.label.replace(/\s*\r?\n\s*/g, ' / ')),
  ]);
  await target.selectOption('Inner');
  await ready(page);
  await expect(target).toHaveAttribute('title', /Processing subsystem \[Outer\] \/ .*\[Inner\]/);
  await expect(page.locator('.block-hit')).toHaveCount(5);
  await expect(page.locator('.group-hit[data-module="Inner"]')).toHaveCount(1);
  await expect(page.locator('.group-hit[data-module="Outer"]')).toHaveCount(0);
  await expect(page.locator('.group-port-hit[data-module="Inner"]')).toHaveCount(2);
  await expect(page.locator('[data-preview-group="Inner"]')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Diagram view path' })).toContainText(
    'Processing subsystem',
  );
  await page.locator('.group-hit[data-module="Inner"]').dblclick();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  let download = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export SVG');
  const svg = await readFile(await (await download).path(), 'utf8');
  const { createDiagramModel, layoutDiagram, renderSvg } = await import('../src/lib/index.js');
  expect(svg).toBe(renderSvg(await layoutDiagram(createDiagramModel(raw), { rootGroupId: 'Inner' })));
  expect(svg).not.toContain('Processing subsystem');
  expect(svg).not.toContain('Source');
  download = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export PNG');
  expect((await sharp(await readFile(await (await download).path())).metadata()).width).toBeGreaterThan(0);
  download = page.waitForEvent('download');
  await toolbarAction(page, 'file', 'Save JSON');
  expect(JSON.parse(await readFile(await (await download).path(), 'utf8'))).toEqual(raw);
  await page.screenshot({ path: 'output/editor/group-view-boundary.png' });
  await page.getByRole('button', { name: 'View Top', exact: true }).click();
  await ready(page);
  await expect(target).toHaveValue('');
  await expect(page.locator('.block-hit')).toHaveCount(2);
  expect(await documentState(page)).toEqual(raw);
  await expect(page.locator('#workspace')).toBeHidden();
});

test('Group view remembers each camera, uses context menus and keeps child collapse independent', async ({
  page,
}) => {
  await importJson(page, previewActionsDocument());
  await ready(page);
  await previewOnly(page);
  const target = page.getByRole('combobox', { name: 'View target', exact: true });
  const camera = async () => ({
    zoom: await page.locator('#zoom-value').textContent(),
    transform: await page.locator('.preview-canvas > g').getAttribute('transform'),
  });
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.locator('.preview-canvas').focus();
  await page.keyboard.press('ArrowRight');
  const top = await camera();
  await target.selectOption('G');
  await ready(page);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.locator('.preview-canvas').focus();
  await page.keyboard.press('ArrowDown');
  const group = await camera();
  await target.selectOption('');
  await ready(page);
  expect(await camera()).toEqual(top);
  await target.selectOption('G');
  await ready(page);
  expect(await camera()).toEqual(group);
  await page.locator('.group-hit[data-module="G"]').click({ button: 'right' });
  await expect(page.locator('#preview-actions-menu [data-action="preview-toggle-contents"]')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'View Frame', exact: true }).click();
  await ready(page);
  await expect(target).toHaveValue('Frame');
  await expect(page.locator('[data-preview-group="G"]')).toHaveCount(1);
  await page.locator('[data-preview-group="G"]').focus();
  await page.keyboard.press('Enter');
  await ready(page);
  expect((await documentState(page)).groups[1].collapsed).toBe(true);
  await expect(page.locator('.collapsed-group-hit[data-module="G"]')).toHaveCount(1);
  await page.locator('.collapsed-group-hit[data-module="G"]').click({ button: 'right' });
  await page
    .locator('#preview-actions-menu')
    .getByRole('button', { name: 'View contents', exact: true })
    .click();
  await ready(page);
  await expect(target).toHaveValue('G');
  await expect(page.locator('.block-hit')).toHaveCount(2);
  expect((await documentState(page)).groups[1].collapsed).toBe(true);
  await page.setViewportSize({ width: 720, height: 900 });
  await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
  await target.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Escape');
  await expect(target).toHaveValue('G');
  await page.screenshot({ path: 'output/editor/group-view-narrow.png' });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze())
      .violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Group view list entry, rapid switching and deleted-target fallback preserve document history', async ({
  page,
}) => {
  const raw = previewActionsDocument();
  await importJson(page, raw);
  await ready(page);
  await page.locator('.group-section[data-group-id="G"] > .group-row').click({ button: 'right' });
  await page
    .locator('.group-section[data-group-id="G"] > .group-row .group-menu')
    .getByRole('button', { name: 'View contents', exact: true })
    .click();
  await ready(page);
  const target = page.getByRole('combobox', { name: 'View target', exact: true });
  await expect(target).toHaveValue('G');
  for (const id of ['Frame', 'G', '', 'G']) await target.selectOption(id);
  await ready(page);
  await expect(page.locator('.block-hit')).toHaveCount(2);
  expect(await documentState(page)).toEqual(raw);
  await page.locator('.group-section[data-group-id="G"] > .group-row [data-action="ungroup"]').click();
  await ready(page);
  await expect(target).toHaveValue('');
  await expect(page.locator('.block-hit')).toHaveCount(4);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  expect(await documentState(page)).toEqual(raw);
  await expect(target).toHaveValue('');
  // View changes do not add history steps: the next Undo restores the pre-import document.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  expect(await documentState(page)).not.toEqual(raw);
});

test('Preview actions edit block, group and labeled edge styles transactionally without leaving preview', async ({
  page,
}) => {
  const raw = previewActionsDocument();
  await importJson(page, raw);
  await ready(page);
  await previewOnly(page);
  const block = page.locator('.block-hit[data-module="A"]');
  await block.dblclick();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Border width', exact: true }).fill('4');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await documentState(page)).toEqual(raw);
  await expect(block).toBeFocused();
  await page.getByRole('button', { name: 'Preview style', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('spinbutton', { name: 'Border width', exact: true }).fill('0');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(await documentState(page)).toEqual(raw);
  await page.getByRole('spinbutton', { name: 'Border width', exact: true }).fill('3');
  const zoom = await page.locator('#zoom-value').textContent();
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await ready(page);
  await expect(block).toBeFocused();
  await expect(page.locator('#zoom-value')).toHaveText(zoom);
  expect((await documentState(page)).modules.find((m) => m.id === 'A').style.borderWidth).toBe(3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  expect(await documentState(page)).toEqual(raw);
  await page.locator('.group-hit[data-module="Frame"]').dblclick();
  await expect(dialog).toContainText('Frame');
  await page.keyboard.press('Escape');
  await expect(page.locator('.group-hit[data-module="Frame"]')).toBeFocused();
  const label = page.locator('.connection-label-hit[data-edge="Source.out->A.in"]');
  await label.dblclick();
  await expect(dialog).toContainText('Source.out');
  await page.getByRole('textbox', { name: 'Line color', exact: true }).fill('#123456');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).connections[0].style.strokeColor).toBe('#123456');
  await expect(page.locator('.connection-hit[data-edge="Source.out->A.in"]')).toBeFocused();
  const segment = await visibleEdgePoint(page.locator('.connection-hit[data-edge="Source.out->A.in"]'));
  await page.mouse.dblclick(segment.x, segment.y);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#workspace')).toBeHidden();
  await page.screenshot({ path: 'output/editor/preview-style-actions.png' });
});

test('Preview label dialog edits block text transactionally with validation, IME and undo', async ({
  page,
}) => {
  const raw = previewActionsDocument();
  await importJson(page, raw);
  await ready(page);
  await previewOnly(page);
  const block = page.locator('.block-hit[data-module="A"]');
  const menu = page.locator('#preview-actions-menu');
  const dialog = page.getByRole('dialog', { name: 'Edit label', exact: true });
  const label = dialog.getByRole('textbox', { name: 'Label', exact: true });
  await block.click({ button: 'right' });
  await expect(menu.getByRole('button')).toHaveText(['Edit style…', 'Edit label…']);
  await expect(menu.locator('[data-action="preview-view-contents"]')).toBeHidden();
  await menu.getByRole('button', { name: 'Edit label…', exact: true }).click();
  await expect(label).toBeFocused();
  await expect(label).toHaveAttribute('placeholder', 'A');
  await label.fill('Cancelled');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await documentState(page)).toEqual(raw);
  await expect(block).toBeFocused();
  await menu.locator('summary').click();
  await menu.getByRole('button', { name: 'Edit label…', exact: true }).click();
  await label.fill('bad\ttext');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(label).toHaveAttribute('aria-invalid', 'true');
  await expect(label).toBeFocused();
  expect(await documentState(page)).toEqual(raw);
  await label.fill('執行');
  await label.press('Enter');
  await label.pressSequentially('stage');
  await expect(label).toHaveValue('執行\nstage');
  await label.dispatchEvent('compositionstart');
  await label.press('Control+Enter');
  await expect(dialog).toBeVisible();
  expect(await documentState(page)).toEqual(raw);
  await label.dispatchEvent('compositionend');
  const zoom = await page.locator('#zoom-value').textContent();
  await label.press('Control+Enter');
  await ready(page);
  await expect(dialog).toBeHidden();
  await expect(block).toBeFocused();
  await expect(page.locator('#zoom-value')).toHaveText(zoom);
  const updated = structuredClone(raw);
  updated.modules.find((item) => item.id === 'A').label = '執行\nstage';
  expect(await documentState(page)).toEqual(updated);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  expect(await documentState(page)).toEqual(raw);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await ready(page);
  expect(await documentState(page)).toEqual(updated);
  await block.focus();
  await page.keyboard.press('Shift+F10');
  await menu.getByRole('button', { name: 'Edit label…', exact: true }).click();
  await label.fill('');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await ready(page);
  expect(await documentState(page)).toEqual(raw);
});

test('Preview label actions add and remove edge text and rename groups on narrow screens', async ({
  page,
}) => {
  const raw = previewActionsDocument();
  await importJson(page, raw);
  await ready(page);
  await previewOnly(page);
  const edge = page.locator('.connection-hit[data-edge="Source.out->B.in"]');
  const point = await visibleEdgePoint(edge);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  const menu = page.locator('#preview-actions-menu');
  const dialog = page.getByRole('dialog', { name: 'Edit label', exact: true });
  const label = dialog.getByRole('textbox', { name: 'Label', exact: true });
  await menu.getByRole('button', { name: 'Edit label…', exact: true }).click();
  await expect(dialog).toContainText('Source.out → B.in');
  await label.fill('Bus\nrequest');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await ready(page);
  await expect(edge).toBeFocused();
  expect((await documentState(page)).connections[1].label).toBe('Bus\nrequest');
  const edgeLabel = page.locator('.connection-label-hit[data-edge="Source.out->B.in"]');
  await edgeLabel.locator('tspan').first().click({ button: 'right' });
  await menu.getByRole('button', { name: 'Edit label…', exact: true }).click();
  await label.fill('Discard');
  await page.keyboard.press('Escape');
  expect((await documentState(page)).connections[1].label).toBe('Bus\nrequest');
  await edge.focus();
  await page.keyboard.press('Shift+F10');
  await menu.getByRole('button', { name: 'Edit label…', exact: true }).click();
  await label.fill('');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await ready(page);
  expect(await documentState(page)).toEqual(raw);
  await page.setViewportSize({ width: 720, height: 900 });
  await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
  const group = page.locator('.group-hit[data-module="G"]');
  await group.click({ button: 'right' });
  await expect(menu.getByRole('button', { name: 'Hide contents', exact: true })).toBeVisible();
  await menu.getByRole('button', { name: 'Edit label…', exact: true }).click();
  await expect(label).toHaveValue('Processing');
  await label.fill('計算\nPipeline');
  await page.screenshot({ path: 'output/editor/preview-label-narrow.png' });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await ready(page);
  const expected = structuredClone(raw);
  expected.groups[1].label = '計算\nPipeline';
  expect(await documentState(page)).toEqual(expected);
  await expect(page.locator('#view-scope option[value="G"]')).toHaveText('計算 / Pipeline');
  await expect(group).toBeFocused();
  await group.click({ button: 'right' });
  await menu.getByRole('button', { name: 'Edit label…', exact: true }).click();
  await label.fill('');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).groups[1].label).toBeUndefined();
  await expect(page.locator('#view-scope option[value="G"]')).toHaveText('G');
  await expect(page.locator('#workspace')).toBeHidden();
});

test('Preview actions toggle Collection and Boundary contents with arrows, context menu, keyboard and undo', async ({
  page,
}) => {
  const raw = previewActionsDocument();
  await importJson(page, raw);
  await ready(page);
  await previewOnly(page);
  await expect(page.locator('[data-preview-group="Frame"]')).toHaveCount(0);
  const control = page.locator('[data-preview-group="G"]');
  await page.locator('.group-hit[data-module="G"]').click();
  await expect(control).toHaveCSS('opacity', '1');
  await expect(control).toHaveAttribute('aria-expanded', 'true');
  const zoom = await page.locator('#zoom-value').textContent();
  await control.click();
  await ready(page);
  await expect(page.locator('.block-hit')).toHaveCount(2);
  await expect(control).toHaveAttribute('aria-expanded', 'false');
  await expect(control).toBeFocused();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('#zoom-value')).toHaveText(zoom);
  const doc = await documentState(page);
  expect(doc.modules).toEqual(raw.modules);
  expect(doc.connections).toEqual(raw.connections);
  expect(doc.groups[1].collapsed).toBe(true);
  await page.locator('.collapsed-group-hit[data-module="G"]').dblclick();
  await expect(page.getByRole('dialog')).toContainText('Processing');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(control).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await ready(page);
  await control.focus();
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(control).toBeFocused();
  await expect(page.locator('.block-hit')).toHaveCount(4);
  await page.locator('.group-hit[data-module="G"]').click({ button: 'right' });
  const menu = page.locator('#preview-actions-menu');
  await expect(menu).toHaveAttribute('open', '');
  await menu.getByRole('button', { name: 'Hide contents', exact: true }).click();
  await ready(page);
  await expect(control).toHaveAttribute('aria-expanded', 'false');
  await page.locator('.collapsed-group-hit[data-module="G"]').focus();
  await page.keyboard.press('Shift+F10');
  await menu.getByRole('button', { name: 'Edit style…', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  const event = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export SVG');
  const svg = await readFile(await (await event).path(), 'utf8');
  expect(svg).not.toContain('data-preview-group');
  expect(svg).not.toContain('preview-group-control');
  await page.setViewportSize({ width: 720, height: 900 });
  await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
  await page.screenshot({ path: 'output/editor/preview-group-actions-narrow.png' });
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze())
      .violations,
  ).toEqual([]);
  await importJson(
    page,
    JSON.parse(await readFile(new URL('../examples/boundary-groups.json', import.meta.url), 'utf8')),
  );
  await ready(page);
  await page.locator('.group-hit[data-module="Outer"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('[data-preview-group="Outer"]').focus();
  await page.keyboard.press('Space');
  await ready(page);
  await expect(page.locator('.block-hit')).toHaveCount(2);
  await expect(page.locator('[data-preview-group="Outer"]')).toHaveAttribute('aria-expanded', 'false');
});

test('Preview actions ignore blank double clicks, drag and canceled gestures and disable stale edits', async ({
  page,
}) => {
  await importJson(page, previewActionsDocument());
  await ready(page);
  await previewOnly(page);
  const canvas = page.locator('.preview-canvas'),
    box = await canvas.boundingBox();
  await page.mouse.dblclick(box.x + 8, box.y + 8);
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Preview style', exact: true })).toBeDisabled();
  await expect(page.locator('[data-action="preview-label"]')).toBeDisabled();
  const edge = page.locator('.connection-hit[data-edge="Source.out->B.in"]'),
    point = await visibleEdgePoint(edge);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 25, point.y + 15);
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toBeHidden();
  await canvas.evaluate((el) =>
    el.addEventListener('pointerdown', (event) => (window.previewCanceledPointer = event.pointerId), {
      once: true,
    }),
  );
  const canceledPoint = await visibleEdgePoint(edge);
  await page.mouse.move(canceledPoint.x, canceledPoint.y);
  await page.mouse.down();
  await canvas.dispatchEvent('pointercancel', {
    pointerId: await page.evaluate(() => window.previewCanceledPointer),
  });
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.locator('.block-hit[data-module="A"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('[data-action="cycle-view"]').click();
  await page.getByRole('textbox', { name: 'Block display name', exact: true }).fill('');
  await page.getByRole('textbox', { name: 'Block display name', exact: true }).blur();
  await page.getByRole('spinbutton', { name: 'Block width', exact: true }).fill('-1');
  await page.getByRole('spinbutton', { name: 'Block width', exact: true }).blur();
  await expect(page.getByRole('button', { name: 'Preview style', exact: true })).toBeDisabled();
  await page.locator('.block-hit[data-module="A"]').dblclick();
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('legacy local drafts restore as once layout and discard obsolete field drafts', async ({ page }) => {
  await page.locator('#diagram-name').fill('Legacy draft');
  await page.locator('#diagram-name').press('Enter');
  await ready(page);
  const original = await documentState(page),
    legacy = structuredClone(original);
  legacy.layout = { ...legacy.layout, orderMode: 'staged' };
  Object.assign(legacy.connections[0], { order: 3, alignment: true });
  await page.evaluate(
    (legacy) =>
      localStorage.setItem(
        'blockflow.editor.v1',
        JSON.stringify({
          document: legacy,
          formDrafts: [['order-0', { value: 'bad', message: 'Old order error' }]],
        }),
      ),
    legacy,
  );
  await page.reload();
  await ready(page);
  expect(await documentState(page)).toEqual(original);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('blockflow.editor.v1')).formDrafts),
  ).toEqual([]);
});

test('Convert to boundary group preserves size, appearance and links, with atomic undo and group sizing', async ({
  page,
}) => {
  const raw = JSON.parse(await readFile(new URL('../examples/block-sizes.json', import.meta.url), 'utf8'));
  raw.diagram.style = {
    module: { borderColor: '#224466', fillColor: '#e2f1ff', label: { fontSize: 18, color: '#19324a' } },
  };
  await importJson(page, raw);
  await ready(page);
  await page.locator('.block-row[data-id="Mux"] [data-action="select-block"]').click();
  const original = {
    width: await page.locator('.block-hit[data-module="Mux"]').getAttribute('width'),
    height: await page.locator('.block-hit[data-module="Mux"]').getAttribute('height'),
  };
  const height = page.getByRole('spinbutton', { name: 'Block height', exact: true });
  await height.fill('0');
  await height.blur();
  await expect(height).toHaveAttribute('aria-invalid', 'true');
  await page.locator('.block-row[data-id="Mux"]').click({ button: 'right' });
  await page.getByRole('button', { name: 'Convert to boundary group', exact: true }).click();
  await expect(page.locator('#message')).toContainText('unfinished field edits');
  expect(await documentState(page)).toEqual(raw);
  await height.fill('3.5');
  await height.blur();
  await ready(page);
  await page.locator('.block-row[data-id="Mux"]').click({ button: 'right' });
  await page.getByRole('button', { name: 'Convert to boundary group', exact: true }).click();
  await ready(page);
  const group = page.locator('.collapsed-group-hit[data-module="Mux"]');
  await expect(group).toHaveAttribute('width', original.width);
  await expect(group).toHaveAttribute('height', original.height);
  await expect(page.locator('[data-role="group"][data-group="Mux"]')).toHaveAttribute('fill', '#e2f1ff');
  await expect(page.locator('[data-role="group"][data-group="Mux"]')).toHaveAttribute('stroke', '#224466');
  await expect(page.locator('.group-select[data-id="Mux"]')).toBeFocused();
  await expect(page.getByRole('checkbox', { name: 'Hide contents', exact: true })).toBeChecked();
  await expect(page.getByRole('spinbutton', { name: 'Group height', exact: true })).toHaveValue('3.5');
  const converted = await documentState(page);
  expect(converted.groups[0]).toMatchObject({
    id: 'Mux',
    width: 1.2,
    height: 3.5,
    collapsed: true,
    type: 'boundary',
    members: [],
  });
  expect(converted.groups[0].ports).toEqual(raw.modules[3].ports);
  expect(converted.connections).toEqual(raw.connections);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  expect(await documentState(page)).toEqual(raw);
  await expect(page.getByRole('textbox', { name: 'Block key', exact: true })).toHaveValue('Mux');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await ready(page);
  expect(await documentState(page)).toEqual(converted);
  const size = page.getByRole('spinbutton', { name: 'Group height', exact: true });
  await size.fill('4.5');
  await size.blur();
  await ready(page);
  await expect(group).toHaveAttribute('height', '378');
  await page.getByRole('checkbox', { name: 'Hide contents', exact: true }).uncheck();
  await ready(page);
  expect(
    Number(await page.locator('[data-role="group"][data-group="Mux"]').getAttribute('height')),
  ).toBeGreaterThanOrEqual(377);
  let download = page.waitForEvent('download');
  await toolbarAction(page, 'file', 'Save JSON');
  const saved = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(saved.groups[0].height).toBe(4.5);
  expect(saved.connections).toEqual(raw.connections);
  download = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export SVG');
  expect(await readFile(await (await download).path(), 'utf8')).toContain('data-group="Mux"');
  await page.getByRole('checkbox', { name: 'Hide contents', exact: true }).check();
  await ready(page);
  await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
  await page.screenshot({ path: 'output/editor/converted-group.png' });
  await page.setViewportSize({ width: 720, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze())
      .violations,
  ).toEqual([]);
});

test('Hide contents collapses boundary groups while list editing, JSON, history and exports retain children', async ({
  page,
}) => {
  const raw = JSON.parse(
    await readFile(new URL('../examples/boundary-groups.json', import.meta.url), 'utf8'),
  );
  await importJson(page, raw);
  await ready(page);
  await page.locator('.group-select[data-id="Inner"]').click();
  const toggle = page.getByRole('checkbox', { name: 'Hide contents', exact: true });
  const zoom = await page.locator('#zoom-value').textContent();
  await toggle.check();
  await ready(page);
  await expect(page.locator('.block-hit')).toHaveCount(7);
  await expect(page.locator('.collapsed-group-hit[data-module="Inner"]')).toBeVisible();
  await expect(page.locator('#zoom-value')).toHaveText(zoom);
  await expect(toggle).toBeFocused();
  let doc = await documentState(page);
  expect(doc.modules).toEqual(raw.modules);
  expect(doc.connections).toEqual(raw.connections);
  expect(doc.groups[1].members).toEqual(raw.groups[1].members);
  await page.locator('.block-row[data-id="Decode"] [data-action="select-block"]').click();
  await page.getByRole('textbox', { name: 'Block display name', exact: true }).fill('Hidden decoder');
  await page.getByRole('textbox', { name: 'Block display name', exact: true }).blur();
  await ready(page);
  await expect(page.locator('.block-hit[data-module="Decode"]')).toHaveCount(0);
  await page.locator('.collapsed-group-hit[data-module="Inner"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Group details', exact: true })).toBeVisible();
  await expect(toggle).toBeChecked();
  let download = page.waitForEvent('download');
  await toolbarAction(page, 'file', 'Save JSON');
  const saved = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(saved.groups[1].collapsed).toBe(true);
  expect(saved.modules[1].label).toBe('Hidden decoder');
  expect(saved.connections).toHaveLength(19);
  download = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export SVG');
  const svg = await readFile(await (await download).path(), 'utf8');
  expect(svg).toContain('data-collapsed="true"');
  expect(svg).not.toContain('Hidden decoder');
  await toggle.uncheck();
  await ready(page);
  await expect(page.locator('.block-hit')).toHaveCount(12);
  await expect(page.locator('.preview-canvas text').filter({ hasText: 'Hidden decoder' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(toggle).toBeChecked();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await ready(page);
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await ready(page);
  await page.locator('.group-select[data-id="Outer"]').click();
  await toggle.check();
  await ready(page);
  await expect(page.locator('.block-hit')).toHaveCount(2);
  await expect(page.locator('.group-hit')).toHaveCount(1);
  await expect(page.locator('.connection-hit')).toHaveCount(2);
  download = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export PNG');
  expect((await sharp(await readFile(await (await download).path())).metadata()).width).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
  await page.screenshot({ path: 'output/editor/collapsed-editor.png' });
  await toggle.uncheck();
  await ready(page);
  await expect(page.locator('.collapsed-group-hit[data-module="Inner"]')).toHaveCount(1);
  doc = await documentState(page);
  expect(doc.groups[1].collapsed).toBe(true);
  await page.setViewportSize({ width: 720, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze())
      .violations,
  ).toEqual([]);
});

test('boundary groups edit ports, block unsafe changes, connect both faces and export', async ({ page }) => {
  const input = JSON.parse(
    await readFile(new URL('../examples/boundary-groups.json', import.meta.url), 'utf8'),
  );
  input.groups[1].ports.push({ id: 'aux', direction: 'input' });
  input.modules[1].ports.push({ id: 'aux', direction: 'input' });
  await importJson(page, input);
  await ready(page);
  await expect(page.locator('[data-role="group-port"]')).toHaveCount(6);
  await page.locator('.group-select[data-id="Outer"]').click();
  const mode = page.getByRole('combobox', { name: 'Group type', exact: true });
  await expect(mode).toHaveValue('boundary');
  await mode.selectOption('container');
  const blocked = page.getByRole('dialog', { name: 'Connections need attention' });
  await expect(blocked).toContainText('Source.out');
  await expect(blocked).toContainText('Outer.in');
  expect(await documentState(page)).toEqual(input);
  await blocked.getByRole('button', { name: 'Done' }).click();
  await expect(mode).toBeFocused();
  await expect(mode).toHaveValue('boundary');
  const key = page.getByRole('textbox', { name: 'input in Key (ID)', exact: true });
  await key.fill('data');
  await key.blur();
  await ready(page);
  expect((await documentState(page)).connections[0].to).toBe('Outer.data');
  expect((await documentState(page)).connections[1].from).toBe('Outer.data');
  await page.getByRole('button', { name: 'Input data text style', exact: true }).click();
  await page.getByRole('textbox', { name: 'Text color', exact: true }).fill('#123456');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).groups[0].ports[0].style.color).toBe('#123456');
  await page.getByRole('button', { name: 'Group style', exact: true }).click();
  await page.getByRole('tab', { name: 'All ports', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('14');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await ready(page);
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await page.getByRole('combobox', { name: 'Source port', exact: true }).selectOption('Inner.aux');
  await page.getByRole('combobox', { name: 'Target port', exact: true }).selectOption('Decode.aux');
  await page.getByRole('dialog').getByRole('button', { name: 'Add connection', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).connections.at(-1)).toEqual({ from: 'Inner.aux', to: 'Decode.aux' });
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await page.getByRole('combobox', { name: 'Source port', exact: true }).selectOption('Outer.spare');
  await page.getByRole('combobox', { name: 'Target port', exact: true }).selectOption('Inner.aux');
  await page.getByRole('dialog').getByRole('button', { name: 'Add connection', exact: true }).click();
  await ready(page);
  await page.locator('.group-port-hit[data-module="Inner"]').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Group details', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ungroup (keep contents)', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Disconnect group Inner ports');
  let download = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export SVG');
  const svg = await readFile(await (await download).path(), 'utf8');
  expect(svg.match(/data-role="group-port"/g)).toHaveLength(6);
  download = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export PNG');
  expect((await sharp(await readFile(await (await download).path())).metadata()).width).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
  await page.screenshot({ path: 'output/editor/boundary-editor.png' });
});

test('new boundary ports toggle, reorder and retain inactive definitions with undo', async ({ page }) => {
  await importJson(page, {
    version: 1,
    diagram: { name: 'Empty boundary' },
    modules: [],
    groups: [{ id: 'G', members: [], portMode: 'boundary' }],
  });
  await ready(page);
  await page.locator('.group-select[data-id="G"]').click();
  const mode = page.getByRole('combobox', { name: 'Group type', exact: true });
  await expect(mode).toHaveValue('boundary');
  await expect(page.locator('.port-empty')).toHaveCount(2);
  await mode.selectOption('container');
  await mode.selectOption('boundary');
  await page.getByRole('button', { name: 'Add input', exact: true }).click();
  await page.getByRole('button', { name: 'Add input', exact: true }).click();
  await page.getByRole('button', { name: 'Add output', exact: true }).click();
  await ready(page);
  await page
    .locator('.port-column.input [data-action="drag"]')
    .last()
    .dragTo(page.locator('.port-column.input [data-action="drag"]').first());
  await ready(page);
  expect(
    (await documentState(page)).groups[0].ports.filter((p) => p.direction === 'input').map((p) => p.id),
  ).toEqual(['in_2', 'in_1']);
  const before = await documentState(page);
  await mode.selectOption('container');
  await ready(page);
  await expect(page.getByRole('button', { name: 'Add input', exact: true })).toHaveCount(0);
  expect((await documentState(page)).groups[0].ports).toEqual(before.groups[0].ports);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(mode).toHaveValue('boundary');
  await page.setViewportSize({ width: 720, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze())
      .violations,
  ).toEqual([]);
});

test('relative block dimensions resize ports, validate, restore Auto and export raw values', async ({
  page,
}) => {
  const doc = JSON.parse(await readFile(new URL('../examples/block-sizes.json', import.meta.url), 'utf8'));
  await importJson(page, doc);
  await ready(page);
  await page.locator('.block-row[data-id="Mux"] [data-action="select-block"]').click();
  const height = page.getByRole('spinbutton', { name: 'Block height', exact: true });
  const width = page.getByRole('spinbutton', { name: 'Block width', exact: true });
  const mux = page.locator('.block-hit[data-module="Mux"]');
  await expect(height).toHaveValue('3.5');
  await expect(width).toHaveValue('1.2');
  await expect(mux).toHaveAttribute('height', '294');
  const zoom = await page.locator('#zoom-value').textContent();
  await height.fill('4.5');
  await height.press('Enter');
  await ready(page);
  await expect(mux).toHaveAttribute('height', '378');
  await expect(page.locator('#zoom-value')).toHaveText(zoom);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(mux).toHaveAttribute('height', '294');
  await height.fill('0');
  await height.press('Enter');
  await expect(height).toHaveAttribute('aria-invalid', 'true');
  expect((await documentState(page)).modules.find((block) => block.id === 'Mux').height).toBe(3.5);
  await expect(page.locator('[data-action="export-svg"]')).toBeDisabled();
  await height.fill('3.5');
  await height.press('Enter');
  await ready(page);
  await width.fill('2.2');
  await width.press('Enter');
  await ready(page);
  expect(Number(await mux.getAttribute('width'))).toBeCloseTo(308);
  let event = page.waitForEvent('download');
  await toolbarAction(page, 'file', 'Save JSON');
  const saved = JSON.parse(await readFile(await (await event).path(), 'utf8'));
  expect(saved.modules.find((block) => block.id === 'Mux').height).toBe(3.5);
  expect(saved.modules.find((block) => block.id === 'Mux').width).toBe(2.2);
  expect(saved.modules.find((block) => block.id === 'Mux').ports).toEqual(
    doc.modules.find((block) => block.id === 'Mux').ports,
  );
  event = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export SVG');
  const svg = await readFile(await (await event).path(), 'utf8');
  const { createDiagramModel, layoutDiagram, renderSvg } = await import('../src/lib/index.js');
  expect(svg).toBe(renderSvg(await layoutDiagram(createDiagramModel(saved))));
  await height.fill('');
  await height.press('Enter');
  await ready(page);
  await expect(height).toHaveValue('');
  await expect(mux).toHaveAttribute('height', '132');
  expect((await documentState(page)).modules.find((block) => block.id === 'Mux').height).toBeUndefined();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(height).toHaveValue('3.5');
  await width.fill('');
  await width.press('Enter');
  await ready(page);
  expect((await documentState(page)).modules.find((block) => block.id === 'Mux').width).toBeUndefined();
  await expect(mux).toHaveAttribute('width', '140');
  await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
  await page.screenshot({ path: 'output/editor/block-sizes.png' });
  await page.setViewportSize({ width: 720, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('startup and Load example demonstrate nested groups with root blocks and cross-group routes', async ({
  page,
}) => {
  await expect(page.locator('.group-hit')).toHaveCount(4);
  await expect(page.locator('[data-role="connection-label"]')).toHaveCount(7);
  await expect(page.locator('[data-role="connection-label"]').first().locator('tspan')).toHaveCount(2);
  await expect(page.locator('.block-row[data-id="A"]')).toHaveAttribute('data-parent-group', 'pipeline');
  await expect(page.locator('.block-row[data-id="C"]')).toHaveAttribute('data-parent-group', '');
  await expect(page.locator('.block-row[data-id="D"]')).toHaveAttribute('data-parent-group', '');
  await toolbarAction(page, 'file', 'New document');
  await expect(page.locator('.group-hit')).toHaveCount(0);
  await toolbarAction(page, 'file', 'Load example');
  if (await page.getByRole('button', { name: 'Switch document', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Switch document', exact: true }).click();
  await ready(page);
  await expect(page.locator('.group-hit')).toHaveCount(4);
  const doc = await documentState(page);
  expect(doc.groups.find((group) => group.id === 'core').members).toEqual(['pipeline', 'auxiliary']);
  expect(doc.connections.some((edge) => edge.from === 'B.c_out' && edge.to === 'C.c_in')).toBe(true);
  expect(doc.connections.some((edge) => edge.from === 'D.feedback' && edge.to === 'A.feedback')).toBe(true);
  expect(doc.connections.at(-1).label).toBe('Feedback\nreturn path');
  await expect(page.locator('#preview-error')).toBeHidden();
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await expect(page.locator('.block-row[data-id="A"]')).toBeHidden();
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await expect(page.locator('.block-row[data-id="A"]')).toBeVisible();
  const event = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export SVG');
  const svg = await readFile(await (await event).path(), 'utf8');
  expect(svg).toContain('data-group="system"');
  expect(svg).toContain('Execution result');
  expect(svg).toContain('<tspan');
  await page.screenshot({ path: 'output/editor/example-groups.png' });
});

test('port keys and multiline display names update links independently with duplicate recovery', async ({
  page,
}) => {
  const doc = JSON.parse(await readFile(new URL('../examples/agent-minimal.json', import.meta.url), 'utf8'));
  doc.modules[0].ports.push({ id: 'enable', direction: 'input' });
  await importJson(page, doc);
  await ready(page);
  await page.locator('.block-row[data-id="Source"] [data-action="select-block"]').click();
  const display = page.getByRole('textbox', { name: 'output data Display name', exact: true });
  await expect(display).toHaveValue('data');
  await display.fill('Payload');
  await display.press('Enter');
  await display.pressSequentially('Channel A');
  await expect(display).toHaveValue('Payload\nChannel A');
  expect((await documentState(page)).modules[0].ports[0].label).toBeUndefined();
  await display.blur();
  await ready(page);
  expect((await documentState(page)).modules[0].ports[0].label).toBe('Payload\nChannel A');
  await page.getByRole('textbox', { name: 'output data Key (ID)', exact: true }).fill('enable');
  await page.getByRole('textbox', { name: 'output data Key (ID)', exact: true }).press('Enter');
  await expect(page.getByRole('alertdialog')).toHaveAccessibleName('Port key adjusted');
  await expect(page.getByRole('alertdialog')).toContainText('enable_2');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await ready(page);
  let state = await documentState(page);
  expect(state.connections[0].from).toBe('Source.enable_2');
  expect(state.modules[0].ports[0].label).toBe('Payload\nChannel A');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).connections[0].from).toBe('Source.data');
  await display.fill('');
  await display.blur();
  await ready(page);
  expect((await documentState(page)).modules[0].ports[0].label).toBeUndefined();
  await expect(display).toHaveValue('data');
  await page.getByRole('textbox', { name: 'output data Key (ID)', exact: true }).fill('tx');
  await page.getByRole('textbox', { name: 'output data Key (ID)', exact: true }).press('Enter');
  await ready(page);
  await expect(page.getByRole('textbox', { name: 'output tx Display name', exact: true })).toHaveValue('tx');
  state = await documentState(page);
  expect(state.connections[0].from).toBe('Source.tx');
  const block = page.getByRole('textbox', { name: 'Block display name', exact: true });
  await block.fill('Controller\nChannel A');
  await block.blur();
  await ready(page);
  expect((await documentState(page)).modules[0].label).toBe('Controller\nChannel A');
  await block.fill('');
  await block.blur();
  await ready(page);
  expect((await documentState(page)).modules[0].label).toBeUndefined();
  await expect(block).toHaveValue('Source');
});

test('multiline block/group/port/edge text shares geometry across JSON SVG PNG and narrow forms', async ({
  page,
}) => {
  const doc = JSON.parse(
    await readFile(new URL('../examples/multiline-labels.json', import.meta.url), 'utf8'),
  );
  await importJson(page, doc);
  await ready(page);
  await expect(page.locator('.preview-canvas tspan')).not.toHaveCount(0);
  await page.locator('.group-select[data-id="pipeline"]').click();
  const group = page.getByRole('textbox', { name: 'Group name', exact: true });
  await group.fill('Pipeline\nStage A');
  await group.blur();
  await ready(page);
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  const label = page.getByRole('textbox', { name: 'Connection 1 label', exact: true });
  await label.fill('\npayload\n\nchannel A\n');
  await label.blur();
  await ready(page);
  await expect(label).toHaveValue('\npayload\n\nchannel A\n');
  await expect(page.locator('[data-role="connection-label"]').first().locator('tspan')).toHaveCount(5);
  let event = page.waitForEvent('download');
  await toolbarAction(page, 'file', 'Save JSON');
  const saved = JSON.parse(await readFile(await (await event).path(), 'utf8'));
  expect(saved.connections[0].label).toBe('\npayload\n\nchannel A\n');
  expect(saved.groups[0].label).toBe('Pipeline\nStage A');
  event = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export SVG');
  const svg = await readFile(await (await event).path(), 'utf8');
  const { createDiagramModel, layoutDiagram, renderSvg } = await import('../src/lib/index.js');
  expect(svg).toBe(renderSvg(await layoutDiagram(createDiagramModel(saved))));
  expect(svg).toContain('<tspan');
  expect(svg).not.toContain('connection-label-hit');
  event = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export PNG');
  expect((await sharp(await (await event).path()).metadata()).format).toBe('png');
  await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
  await page.screenshot({ path: 'output/editor/multiline-text.png' });
  await page.setViewportSize({ width: 720, height: 900 });
  await page.getByRole('tab', { name: 'Blocks', exact: true }).click();
  await page.locator('.block-row[data-id="A"] [data-action="select-block"]').click();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze())
      .violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/editor/multiline-text-narrow.png', fullPage: true });
});

test('connection labels create, edit, style, select and export with undo', async ({ page }) => {
  const doc = JSON.parse(await readFile(new URL('../examples/agent-minimal.json', import.meta.url), 'utf8'));
  doc.connections = [];
  await importJson(page, doc);
  await ready(page);
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await page.locator('#dialog-label').fill('payload <&>');
  await page.getByRole('dialog').getByRole('button', { name: 'Add connection', exact: true }).click();
  await ready(page);
  await expect(page.locator('[data-role="connection-label"] text')).toHaveText('payload <&>');
  const label = page.getByRole('textbox', { name: 'Connection 1 label', exact: true });
  await label.fill('data bus');
  await label.blur();
  await ready(page);
  await page.locator('[data-style-kind="connection"]').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Label', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Text color', exact: true }).fill('#123456');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await documentState(page)).connections[0].style).toBeUndefined();
  await page.locator('[data-style-kind="connection"]').click();
  await dialog.getByRole('tab', { name: 'Label', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Text color', exact: true }).fill('#123456');
  await dialog.getByRole('textbox', { name: 'Background color', exact: true }).fill('#ffffff');
  await dialog.getByRole('spinbutton', { name: 'Padding', exact: true }).fill('3');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await ready(page);
  await expect(page.locator('[data-role="connection-label"] text')).toHaveAttribute('fill', '#123456');
  await page.locator('[data-role="connection-label"] text').click();
  await expect(page.locator('.connection-row')).toHaveClass(/selected/);
  await expect(page.locator('.connection-selection-outline')).toHaveCount(1);
  const downloaded = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export SVG');
  const svg = await readFile(await (await downloaded).path(), 'utf8');
  const { createDiagramModel, layoutDiagram, renderSvg } = await import('../src/lib/index.js');
  expect(svg).toBe(renderSvg(await layoutDiagram(createDiagramModel(await documentState(page)))));
  expect(svg).not.toContain('connection-label-hit');
  await page.screenshot({ path: 'output/editor/connection-labels.png' });
  await label.fill('');
  await label.blur();
  await ready(page);
  expect((await documentState(page)).connections[0].label).toBeUndefined();
  await expect(page.locator('[data-role="connection-label"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(label).toHaveValue('data bus');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await ready(page);
  await expect(label).toHaveValue('');
});

test('labeled nested feedback remains accessible in a narrow editor', async ({ page }) => {
  const doc = JSON.parse(
    await readFile(new URL('../examples/connection-labels.json', import.meta.url), 'utf8'),
  );
  await importJson(page, doc);
  await ready(page);
  await expect(page.locator('[data-role="connection-label"]')).toHaveCount(doc.connections.length);
  await expect(page.locator('#preview-error')).toBeHidden();
  await page.setViewportSize({ width: 720, height: 900 });
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await page.locator('[data-style-kind="connection"]').first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Line', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('tab', { name: 'Label', exact: true })).toBeFocused();
  await dialog.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('0');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(dialog.getByRole('spinbutton', { name: 'Font size', exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-style-kind="connection"]').first()).toBeFocused();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze())
      .violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/editor/connection-labels-narrow.png', fullPage: true });
});

async function toolbarAction(page, menu, label) {
  const container = page.locator('#' + menu + '-menu');
  if (!(await container.evaluate((el) => el.open))) await container.locator('summary').click();
  await container.getByRole('button', { name: label, exact: true }).click();
}

async function ready(page) {
  await expect(page.locator('#layout-state')).toHaveText('Updated');
  await expect(page.locator('[data-action="export-svg"]')).toBeEnabled();
}

async function documentState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('blockflow.editor.v1')).document);
}

async function visibleEdgePoint(hit) {
  return hit.evaluate((el) => {
    const length = el.getTotalLength();
    for (let i = 1; i < 40; i++) {
      const point = el.getPointAtLength((length * i) / 40).matrixTransform(el.getScreenCTM());
      if (document.elementFromPoint(point.x, point.y)?.closest('.connection-hit') === el)
        return { x: point.x, y: point.y };
    }
    throw new Error('No visible, unobstructed segment for this connection');
  });
}

async function importJson(page, doc, filename = 'diagram.json') {
  await page.locator('#file-input').setInputFiles({
    name: filename,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  });
  if (await page.getByRole('button', { name: 'Switch document', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Switch document', exact: true }).click();
}

async function dropJsonFiles(page, files, target = '#preview-host') {
  const transfer = await page.evaluateHandle((files) => {
    const transfer = new DataTransfer();
    for (const file of files) {
      transfer.items.add(
        new File([file.text ?? ' '.repeat(file.size ?? 0)], file.name, { type: file.type ?? '' }),
      );
    }
    return transfer;
  }, files);
  try {
    expect(
      await page
        .locator(target)
        .evaluate(
          (element, transfer) =>
            !element.dispatchEvent(
              new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }),
            ),
          transfer,
        ),
    ).toBe(true);
    await page.locator(target).dispatchEvent('drop', { dataTransfer: transfer });
  } finally {
    await transfer.dispose();
  }
}

test('dropping JSON uses Open JSON validation, dirty confirmation, migration and undo', async ({ page }) => {
  const input = JSON.parse(
    await readFile(new URL('../examples/agent-minimal.json', import.meta.url), 'utf8'),
  );
  const legacy = structuredClone(input);
  legacy.layout.orderMode = 'staged';
  legacy.connections[0].order = 1;
  await page.locator('#diagram-name').fill('Keep my edits');
  await page.locator('#diagram-name').press('Enter');
  await ready(page);
  await previewOnly(page);
  const before = await documentState(page);
  const file = { name: 'diagram.JSON', text: JSON.stringify(legacy) };
  const url = page.url();
  await dropJsonFiles(page, [file], '.preview-canvas');
  const dialog = page.getByRole('dialog', { name: 'Switch documents?', exact: true });
  await expect(dialog).toBeVisible();
  expect(await documentState(page)).toEqual(before);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await documentState(page)).toEqual(before);
  await dropJsonFiles(page, [file]);
  await dialog.getByRole('button', { name: 'Switch document', exact: true }).click();
  await ready(page);
  expect(await documentState(page)).toEqual(input);
  expect(page.url()).toBe(url);
  await expect(page.locator('#workspace')).toBeHidden();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  expect(await documentState(page)).toEqual(before);
});

test('file drops reject invalid files and preserve active dialog drafts', async ({ page }) => {
  const input = JSON.parse(
    await readFile(new URL('../examples/agent-minimal.json', import.meta.url), 'utf8'),
  );
  await page.locator('#diagram-name').fill('File drop recovery');
  await page.locator('#diagram-name').press('Enter');
  await ready(page);
  const before = await documentState(page);
  const valid = { name: 'diagram.json', text: JSON.stringify(input) };
  for (const [files, message] of [
    [[{ ...valid, name: 'diagram.txt' }], 'Drop a JSON file (.json)'],
    [[valid, valid], 'Drop one JSON file at a time'],
    [[{ name: 'broken.json', text: '{broken' }], 'Invalid JSON'],
    [[{ name: 'invalid.json', text: '{"version":2}' }], 'Cannot open file'],
    [[{ name: 'large.json', size: 5 * 1024 * 1024 + 1 }], 'exceeds 5 MB'],
  ]) {
    await dropJsonFiles(page, files, '#block-list');
    await expect(page.locator('#message')).toContainText(message);
    expect(await documentState(page)).toEqual(before);
    await expect(page.getByRole('dialog')).toBeHidden();
  }
  await page.locator('.block-hit').first().dblclick();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('spinbutton', { name: 'Border width', exact: true }).fill('7');
  await dropJsonFiles(page, [valid], '#editor-dialog');
  await expect(page.locator('#message')).toContainText('Close the current dialog');
  await expect(dialog.getByRole('spinbutton', { name: 'Border width', exact: true })).toHaveValue('7');
  expect(await documentState(page)).toEqual(before);
  await page.keyboard.press('Escape');
  expect(await documentState(page)).toEqual(before);
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await ready(page);
});

test('legacy layout JSON migrates to once and matches library output', async ({ page }) => {
  const input = JSON.parse(
    await readFile(new URL('../examples/style-gallery.json', import.meta.url), 'utf8'),
  );
  input.layout.orderMode = 'staged';
  input.connections[0].order = 3;
  input.connections[0].alignment = true;
  await importJson(page, input);
  await ready(page);
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await expect(page.locator('[data-field="connection-order"], [data-field="alignment"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Layout settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Layout mode', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const download = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export SVG');
  const svg = await readFile(await (await download).path(), 'utf8');
  const { createDiagramModel, layoutDiagram, renderSvg } = await import('../src/lib/index.js');
  const { migrateLegacyLayout } = await import('../src/editor/state/legacy-layout.js');
  const migrated = migrateLegacyLayout(input);
  const expected = renderSvg(await layoutDiagram(createDiagramModel(migrated)));
  input.layout = migrated.layout;
  input.connections = migrated.connections;
  expect(svg).toBe(expected);
  expect(await documentState(page)).toEqual(input);
  await page.screenshot({ path: 'output/editor/once-layout-flat-connections.png' });
});

test('preview connection selection reveals its row and editor controls select the same route', async ({
  page,
}) => {
  await page.locator('#diagram-name').fill('Connection selection');
  await page.locator('#diagram-name').press('Enter');
  await ready(page);
  const before = await documentState(page);
  const world = page.locator('.preview-canvas > g');
  const transform = await world.getAttribute('transform');
  const hit = page.getByRole('button', { name: 'Select connection D.feedback to A.feedback', exact: true });
  const point = await visibleEdgePoint(hit);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole('tab', { name: 'Connections', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const row = page.locator('.connection-row.selected');
  await expect(row).toHaveAttribute('data-edge-key', 'D.feedback->A.feedback');
  await expect(row).toBeInViewport();
  await expect(page.locator('.selection-outline')).toHaveCount(0);
  await expect(page.locator('.block-row.selected')).toHaveCount(0);
  await expect(page.locator('.connection-selection-outline')).toHaveAttribute(
    'd',
    await hit.getAttribute('d'),
  );
  expect(await documentState(page)).toEqual(before);
  expect(await world.getAttribute('transform')).toBe(transform);
  await page.screenshot({ path: 'output/editor/selected-feedback-connection.png' });
  const source = page.getByRole('combobox', { name: 'Connection 1 source Output', exact: true });
  await source.focus();
  await expect(row).toHaveAttribute('data-edge-key', 'A.b_out->B.b_in');
  const first = page.getByRole('button', { name: 'Select connection A.b_out to B.b_in', exact: true });
  await expect(page.locator('.connection-selection-outline')).toHaveAttribute(
    'd',
    await first.getAttribute('d'),
  );
  await first.focus();
  await first.press('Enter');
  await expect(row).toBeInViewport();
  await first.press('Escape');
  await expect(page.locator('.connection-selection-outline')).toHaveCount(0);
  await expect(row).toHaveCount(0);
  await expect(page.locator('.preview-canvas')).toBeFocused();
  await page.locator('.block-hit[data-module="A"]').click();
  await expect(page.locator('.selection-outline')).toHaveCount(1);
  await expect(page.locator('.connection-selection-outline')).toHaveCount(0);
});

test('connection selection follows endpoint edits, ordering and undo; deleted edges cannot select stale indices', async ({
  page,
}) => {
  await importJson(page, {
    version: 1,
    diagram: { name: 'Selection identity' },
    modules: [
      {
        id: 'A',
        ports: [
          { id: 'out1', direction: 'output' },
          { id: 'out2', direction: 'output' },
          { id: 'back', direction: 'input' },
        ],
      },
      {
        id: 'B',
        ports: [
          { id: 'in', direction: 'input' },
          { id: 'out', direction: 'output' },
        ],
      },
      { id: 'C', ports: [{ id: 'in', direction: 'input' }] },
    ],
    connections: [
      { from: 'A.out1', to: 'B.in' },
      { from: 'A.out2', to: 'C.in' },
      { from: 'B.out', to: 'A.back' },
    ],
    layout: { direction: 'right' },
  });
  await ready(page);
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  const source = page.getByRole('combobox', { name: 'Connection 1 source Output', exact: true });
  await source.focus();
  await source.selectOption('A.out2');
  await ready(page);
  await expect(page.locator('.connection-row.selected')).toHaveAttribute('data-edge-key', 'A.out2->B.in');
  await expect(page.locator('.connection-selection-outline')).toHaveAttribute(
    'd',
    await page
      .getByRole('button', { name: 'Select connection A.out2 to B.in', exact: true })
      .getAttribute('d'),
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(page.locator('.connection-row.selected')).toHaveAttribute('data-edge-key', 'A.out1->B.in');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await ready(page);
  const selected = page.locator('.connection-row.selected');
  await selected.locator('[data-action="drag"]').focus();
  await selected.locator('[data-action="drag"]').press('Alt+ArrowDown');
  await ready(page);
  await expect(selected).toHaveAttribute('data-edge-key', 'A.out2->B.in');
  await expect(selected).toHaveAttribute('data-index', '1');
  const stale = await page
    .getByRole('button', { name: 'Select connection A.out2 to B.in', exact: true })
    .elementHandle();
  await selected.locator('[data-action="delete"]').click();
  await stale.evaluate((el) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
  await ready(page);
  await expect(page.locator('.connection-row.selected')).toHaveCount(0);
  await expect(page.locator('.connection-selection-outline')).toHaveCount(0);
});

test('connection highlighting preserves pan and export, and survives a hidden preview', async ({ page }) => {
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await page.getByRole('combobox', { name: 'Connection 1 source Output', exact: true }).focus();
  const key = 'A.b_out->B.b_in';
  await expect(page.locator('.connection-row.selected')).toHaveAttribute('data-edge-key', key);
  const canvas = page.locator('.preview-canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 35);
  await page.mouse.up();
  await expect(page.locator('.connection-row.selected')).toHaveAttribute('data-edge-key', key);
  await expect(page.locator('.connection-selection-outline')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export SVG');
  const svg = await readFile(await (await download).path(), 'utf8');
  expect(svg).not.toMatch(/connection-hit|connection-selection|editorKey/);
  const view = page.locator('[data-action="cycle-view"]');
  await view.click();
  await page.locator('.connection-row.selected [data-action="edit-style"]').click();
  await page.getByRole('textbox', { name: 'Line color', exact: true }).fill('#123456');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await ready(page);
  await view.click();
  await expect(page.locator('.connection-selection-outline')).toHaveCount(1);
  const feedback = page.getByRole('button', {
    name: 'Select connection D.feedback to A.feedback',
    exact: true,
  });
  await feedback.focus();
  await feedback.press('Enter');
  await expect(page.locator('#workspace')).toBeHidden();
  await view.click();
  await expect(page.locator('.connection-row.selected')).toHaveAttribute(
    'data-edge-key',
    'D.feedback->A.feedback',
  );
  await expect(page.locator('.connection-row.selected')).toBeInViewport();
  await canvas.click({ position: { x: 8, y: 8 } });
  await expect(page.locator('.connection-selection-outline')).toHaveCount(0);
  const row = page.locator('.connection-row[data-index="3"]');
  await row.focus();
  await row.press('Escape');
  await expect(page.locator('.connection-row.selected')).toHaveCount(0);
  await row.locator('[data-field="connection-from"]').selectOption('A.b_out');
  await ready(page);
  await expect(page.locator('.connection-row.selected')).toHaveAttribute('data-edge-key', 'A.b_out->E.e_in');
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
});

test('blank list and preview clicks clear selection without layout or history changes', async ({ page }) => {
  const originalName = await page.locator('#diagram-name').inputValue();
  await page.locator('#diagram-name').fill('Selection baseline');
  await page.locator('#diagram-name').press('Enter');
  await ready(page);
  const before = await documentState(page);
  const world = page.locator('.preview-canvas > g');
  await page.locator('[data-action="select-block"][data-id="B"]').click();
  await expect(page.locator('.selection-outline')).toHaveCount(1);
  const transform = await world.getAttribute('transform');
  const list = page.locator('#block-list');
  // The list gutter stays blank even when nested groups fill the panel.
  await list.click({ position: { x: 2, y: 10 } });
  await expect(page.locator('.selection-outline')).toHaveCount(0);
  await expect(page.locator('.block-row.selected')).toHaveCount(0);
  await expect(page.locator('#block-detail')).toContainText('Select a block to edit');
  await expect(page.locator('#block-detail input')).toHaveCount(0);
  await expect(page.locator('#layout-state')).toHaveText('Updated');
  expect(await documentState(page)).toEqual(before);
  expect(await world.getAttribute('transform')).toBe(transform);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(page.locator('#diagram-name')).toHaveValue(originalName);
  await expect(page.locator('.block-row.selected')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await ready(page);
  await expect(page.locator('.block-row.selected')).toHaveCount(0);
  await page.locator('[data-action="select-block"][data-id="C"]').click();
  await page.locator('.preview-canvas').click({ position: { x: 8, y: 8 } });
  await expect(page.locator('.selection-outline')).toHaveCount(0);
  await expect(page.locator('.block-row.selected')).toHaveCount(0);
  await expect(page.locator('#block-detail')).toContainText('Select a block to edit');
  await page.locator('#diagram-name').fill('Still unselected');
  await page.locator('#diagram-name').press('Enter');
  await ready(page);
  await expect(page.locator('.selection-outline')).toHaveCount(0);
  await expect(page.locator('.block-row.selected')).toHaveCount(0);
  await page.screenshot({ path: 'output/editor/no-block-selected.png' });
});

test('preview click tolerance, drag and canceled gestures preserve the intended selection', async ({
  page,
}) => {
  const canvas = page.locator('.preview-canvas');
  const world = page.locator('.preview-canvas > g');
  const box = await canvas.boundingBox();
  const point = { x: box.x + 12, y: box.y + 12 };
  const select = async () => {
    await page.locator('.block-hit[data-module="B"]').click();
    await expect(page.locator('#selected-id')).toHaveText('B');
  };
  await select();
  let transform = await world.getAttribute('transform');
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 2, point.y + 1);
  await page.mouse.up();
  await expect(page.locator('.selection-outline')).toHaveCount(0);
  expect(await world.getAttribute('transform')).toBe(transform);
  await select();
  transform = await world.getAttribute('transform');
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 30, point.y + 20, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('#selected-id')).toHaveText('B');
  await expect(page.locator('.selection-outline')).toHaveCount(1);
  expect(await world.getAttribute('transform')).not.toBe(transform);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 20, point.y + 10);
  await page.mouse.move(point.x, point.y);
  await page.mouse.up();
  await expect(page.locator('#selected-id')).toHaveText('B');
  await canvas.evaluate((el) =>
    el.addEventListener(
      'pointerdown',
      (event) => {
        window.testPointerId = event.pointerId;
      },
      { once: true },
    ),
  );
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await canvas.dispatchEvent('pointercancel', { pointerId: await page.evaluate(() => window.testPointerId) });
  await page.mouse.up();
  await expect(page.locator('#selected-id')).toHaveText('B');
});

test('Escape prioritizes dialogs and sort menus, preserves pending edits and clears keyboard selection', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Block editing help', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#selected-id')).toHaveText('A');
  const menu = page.locator('.block-row.selected .sort-menu');
  await menu.locator('summary').click();
  await page.keyboard.press('Escape');
  await expect(menu).not.toHaveAttribute('open', '');
  await expect(page.locator('#selected-id')).toHaveText('A');
  await page.keyboard.press('Escape');
  await expect(page.locator('.block-row.selected')).toHaveCount(0);
  await expect(page.locator('#block-list')).toBeFocused();
  const hit = page.locator('.block-hit[data-module="A"]');
  await hit.focus();
  await hit.press('Enter');
  await expect(page.locator('#selected-id')).toHaveText('A');
  await hit.press('Escape');
  await expect(page.locator('.preview-canvas')).toBeFocused();
  await expect(page.locator('.selection-outline')).toHaveCount(0);
  await page.locator('[data-action="select-block"][data-id="A"]').click();
  const port = page.getByRole('textbox', { name: 'input feedback Key (ID)', exact: true });
  await port.fill('pending.invalid');
  await port.press('Escape');
  await expect(page.locator('#block-detail')).toContainText('Select a block to edit');
  await page.locator('[data-action="select-block"][data-id="A"]').click();
  await expect(port).toHaveValue('pending.invalid');
  await expect(port).toHaveAttribute('aria-invalid', 'true');
  await port.fill('feedback');
  await port.press('Enter');
  await ready(page);
  await page.locator('#diagram-name').fill('Pending title');
  await page.locator('#diagram-name').press('Escape');
  await expect(page.locator('.block-row.selected')).toHaveCount(0);
  await expect(page.locator('#diagram-name')).toHaveValue('Pending title');
  await page.locator('#diagram-name').press('Enter');
  await ready(page);
  await expect(page.locator('.block-row.selected')).toHaveCount(0);
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
});

test('block help hides instructions and flat connections share one scrollbar', async ({ page }) => {
  const keyHelp =
    'Use the key in connections. Renaming updates existing links. Duplicate keys receive a suffix.';
  const widthHelp = 'Width is optional; only two explicit widths must match.';
  await expect(page.locator('#block-list')).not.toContainText(/\d+\s+(?:IN|OUT)\b/);
  await expect(page.getByText(keyHelp, { exact: true })).toHaveCount(0);
  await expect(page.getByText(widthHelp, { exact: true })).toHaveCount(0);
  await page.locator('#diagram-name').fill('Help and shared scroll');
  await page.locator('#diagram-name').press('Enter');
  await ready(page);
  const before = await documentState(page);
  const help = page.getByRole('button', { name: 'Block editing help', exact: true });
  await expect(help).toHaveText('[?]');
  await page.screenshot({ path: 'output/editor/compact-block-details.png' });
  await help.click();
  const dialog = page.getByRole('dialog', { name: 'Block editing help' });
  await expect(dialog.getByText(keyHelp, { exact: true })).toBeVisible();
  await expect(dialog.getByText(widthHelp, { exact: true })).toBeVisible();
  await page.screenshot({ path: 'output/editor/block-help.png' });
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  await help.click();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(help).toBeFocused();
  expect(await documentState(page)).toEqual(before);
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  const list = page.locator('#connection-list');
  await expect(list.locator(':scope > details')).toHaveCount(0);
  await expect(list.locator('.connection-row')).toHaveCount(7);
  const scrollers = await list.evaluate((el) =>
    [el, ...el.querySelectorAll('*')]
      .filter(
        (item) =>
          ['auto', 'scroll'].includes(getComputedStyle(item).overflowY) &&
          item.scrollHeight > item.clientHeight,
      )
      .map((item) => item.id || item.className),
  );
  expect(scrollers).toEqual(['connection-list']);
  await page.screenshot({ path: 'output/editor/connections-single-scroll.png' });
  const scroll = await list.evaluate((el) => {
    el.scrollTop = Math.min(100, el.scrollHeight - el.clientHeight);
    return el.scrollTop;
  });
  expect(scroll).toBeGreaterThan(0);
  await page.getByRole('tab', { name: 'Blocks', exact: true }).click();
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  expect(await list.evaluate((el) => el.scrollTop)).toBe(scroll);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  await page.screenshot({ path: 'output/editor/connections-single-scroll-mobile.png', fullPage: true });
});

test('new block display names default to the resolved key until customized', async ({ page }) => {
  await page.getByRole('button', { name: 'Add block', exact: true }).first().click();
  const name = page.getByRole('textbox', { name: 'Block display name', exact: true });
  const key = page.getByRole('textbox', { name: 'Block key', exact: true });
  await expect(name).toHaveValue('block_1');
  await page.getByRole('button', { name: 'Add input', exact: true }).click();
  await ready(page);
  await key.fill('A');
  await key.press('Enter');
  await page.getByRole('alertdialog').getByRole('button', { name: 'OK', exact: true }).click();
  await ready(page);
  await expect(name).toHaveValue('A_2');
  await key.fill('Ingress');
  await key.press('Enter');
  await ready(page);
  await expect(name).toHaveValue('Ingress');
  await expect(page.locator('.block-hit[data-module="Ingress"]')).toHaveAttribute(
    'aria-label',
    'Select Ingress',
  );
  expect((await documentState(page)).modules.at(-1).label).toBeUndefined();
  await name.fill('Front end');
  await name.blur();
  await ready(page);
  await key.fill('Capture');
  await key.press('Enter');
  await ready(page);
  await expect(name).toHaveValue('Front end');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(key).toHaveValue('Ingress');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(name).toHaveValue('Ingress');
});

test('settings tabs share a tall side-by-side workspace and retain drafts, scroll and selection', async ({
  page,
}) => {
  const blocks = page.getByRole('tab', { name: 'Blocks', exact: true });
  const connections = page.getByRole('tab', { name: 'Connections', exact: true });
  const settings = await page.locator('#workspace').boundingBox();
  const preview = await page.locator('.preview-panel').boundingBox();
  expect(preview.x).toBeGreaterThan(settings.x + settings.width);
  expect(Math.abs(preview.width - settings.width)).toBeLessThan(2);
  expect(Math.abs(preview.y - settings.y)).toBeLessThan(2);
  expect((await page.locator('.detail-panel').boundingBox()).height).toBeGreaterThan(550);
  const port = page.getByRole('textbox', { name: 'input feedback Key (ID)', exact: true });
  await port.fill('unfinished.port');
  await port.press('Tab');
  await expect(port).toHaveAttribute('aria-invalid', 'true');
  const before = await documentState(page);
  await blocks.focus();
  await blocks.press('ArrowRight');
  await expect(connections).toBeFocused();
  await expect(connections).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#blocks-settings')).toBeHidden();
  expect((await page.locator('.connections-panel').boundingBox()).height).toBeGreaterThan(550);
  const list = page.locator('#connection-list');
  const scroll = await list.evaluate((el) => {
    el.scrollTop = 100;
    return el.scrollTop;
  });
  await connections.press('Home');
  await expect(blocks).toBeFocused();
  await expect(port).toHaveValue('unfinished.port');
  expect(await documentState(page)).toEqual(before);
  await page.locator('#diagram-name').fill('Tab scroll retention');
  await page.locator('#diagram-name').press('Enter');
  await expect(page.locator('#layout-state')).toHaveText('Updated');
  await connections.click();
  expect(await list.evaluate((el) => el.scrollTop)).toBe(scroll);
  await page.reload();
  await expect(page.locator('#layout-state')).toHaveText('Updated');
  await expect(connections).toHaveAttribute('aria-selected', 'true');
  await blocks.click();
  await expect(port).toHaveValue('unfinished.port');
  await port.fill('feedback');
  await port.press('Tab');
  await ready(page);
  await page.locator('#splitter').focus();
  await page.keyboard.press('End');
  await expect(page.locator('#splitter')).toHaveAttribute('aria-valuenow', '70');
  await page.keyboard.press('Home');
  await expect(page.locator('#splitter')).toHaveAttribute('aria-valuenow', '30');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('editable block keys update endpoints, resolve duplicates and support atomic undo', async ({ page }) => {
  const originalLabel = await page
    .getByRole('textbox', { name: 'Block display name', exact: true })
    .inputValue();
  const key = page.getByRole('textbox', { name: 'Block key', exact: true });
  await key.fill('Source');
  await key.press('Enter');
  await ready(page);
  let doc = await documentState(page);
  expect(doc.modules[0].id).toBe('Source');
  expect(doc.modules[0].label).toBe(originalLabel);
  expect(doc.connections.some((c) => c.from.startsWith('Source.'))).toBe(true);
  expect(doc.connections.some((c) => c.to.startsWith('A.') || c.from.startsWith('A.'))).toBe(false);
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Add connection', exact: true }).first().click();
  await expect(page.locator('#dialog-source option[value="Source.b_out"]')).toContainText('Source.b_out');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('tab', { name: 'Blocks', exact: true }).click();
  await page.locator('[data-action="select-block"][data-id="B"]').click();
  await key.fill('Source');
  await key.press('Enter');
  const warning = page.getByRole('alertdialog', { name: 'Block key adjusted' });
  await expect(warning).toContainText('Source_2');
  await warning.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(key).toBeFocused();
  await expect(key).toHaveValue('Source_2');
  await ready(page);
  doc = await documentState(page);
  expect(doc.modules[1].id).toBe('Source_2');
  expect(doc.connections.some((c) => c.to.startsWith('Source_2.'))).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(key).toHaveValue('B');
  expect((await documentState(page)).connections.some((c) => c.to.startsWith('B.'))).toBe(true);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await ready(page);
  await expect(key).toHaveValue('Source_2');
  await key.fill('invalid.key');
  await key.press('Enter');
  await expect(key).toHaveAttribute('aria-invalid', 'true');
  expect((await documentState(page)).modules[1].id).toBe('Source_2');
  await key.fill('Source_2');
  await key.press('Enter');
  await ready(page);
  // Resolving a duplicate back to this block's own suffix is a document no-op.
  await key.fill('Source');
  await key.press('Enter');
  await warning.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(key).toHaveValue('Source_2');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('block/port/connection CRUD, atomic undo/redo, JSON/SVG/PNG downloads', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Add block', exact: true }).first().click();
  await expect(page.locator('#preview-error')).toContainText('at least one');
  await expect(page.locator('[data-action="export-svg"]')).toBeDisabled();
  await page.getByRole('textbox', { name: 'Block display name', exact: true }).fill('控制單元');
  await page.getByRole('textbox', { name: 'Block display name', exact: true }).blur();
  await page.getByRole('button', { name: 'Add input', exact: true }).click();
  await page.getByRole('button', { name: 'Add output', exact: true }).click();
  await page.getByRole('textbox', { name: 'output out_1 Key (ID)', exact: true }).fill('result');
  await page.getByRole('textbox', { name: 'output out_1 Key (ID)', exact: true }).press('Enter');
  await page.getByRole('spinbutton', { name: 'result Width', exact: true }).fill('8');
  await page.getByRole('spinbutton', { name: 'result Width', exact: true }).press('Tab');
  await ready(page);
  await expect(page.locator('.block-hit')).toHaveCount(7);
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Add connection', exact: true }).first().click();
  await page.locator('#dialog-source').selectOption('A.b_out');
  await page.locator('#dialog-target').selectOption('block_1.in_1');
  await page.getByRole('dialog').getByRole('button', { name: 'Add connection', exact: true }).click();
  await ready(page);
  await expect(page.locator('#connection-count')).toHaveText('8');
  await page.getByRole('tab', { name: 'Blocks', exact: true }).click();
  await page.getByRole('textbox', { name: 'input in_1 Key (ID)', exact: true }).fill('data');
  await page.getByRole('textbox', { name: 'input in_1 Key (ID)', exact: true }).press('Enter');
  await ready(page);
  expect((await documentState(page)).connections.some((c) => c.to === 'block_1.data')).toBe(true);
  await page.locator('.block-row.selected [data-action="delete"]').click();
  await ready(page);
  await expect(page.locator('#connection-count')).toHaveText('7');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(page.locator('.block-hit')).toHaveCount(7);
  await expect(page.locator('#connection-count')).toHaveText('8');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await ready(page);
  await expect(page.locator('.block-hit')).toHaveCount(6);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  const jsonDownload = page.waitForEvent('download');
  await toolbarAction(page, 'file', 'Save JSON');
  const file = await jsonDownload;
  const doc = JSON.parse(await readFile(await file.path(), 'utf8'));
  expect(
    doc.modules.find((m) => m.id === 'block_1').ports.find((p) => p.id === 'data').width,
  ).toBeUndefined();
  expect(doc.modules.find((m) => m.id === 'block_1').ports.find((p) => p.id === 'result').width).toBe(8);
  const svgDownload = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export SVG');
  const svgFile = await svgDownload;
  const svg = await readFile(await svgFile.path(), 'utf8');
  expect(svg).toContain('控制單元');
  expect(svg).not.toContain('selection-outline');
  expect(svg).not.toContain('block-hit');
  const pngDownload = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export PNG');
  const pngFile = await pngDownload;
  const metadata = await sharp(await pngFile.path()).metadata();
  expect(metadata.format).toBe('png');
  const width = Number(svg.match(/<svg[^>]* width="([^"]+)"/)[1]);
  expect(metadata.width).toBe(Math.round(width * 2));
  await mkdir('output/editor', { recursive: true });
  await pngFile.saveAs('output/editor/export.png');
  await page.screenshot({ path: 'output/editor/desktop.png', fullPage: true });
  await testInfo.attach('exported diagram', { path: 'output/editor/export.png', contentType: 'image/png' });
});

test('drag reorder, keyboard port reorder and logical-anchor zoom preservation', async ({ page }) => {
  // This workflow tests root block ordering independently of group membership.
  const flat = JSON.parse(await readFile(new URL('../examples/style-gallery.json', import.meta.url), 'utf8'));
  for (const block of flat.modules) for (const port of block.ports) delete port.width;
  await importJson(page, flat);
  await ready(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const scale = await page.locator('#zoom-value').textContent();
  const before = await page.locator('.block-hit[data-module="A"]').boundingBox();
  await page
    .locator('.block-row')
    .first()
    .locator('[data-action="drag"]')
    .dragTo(page.locator('.block-row').nth(2));
  await ready(page);
  expect((await documentState(page)).modules[2].id).toBe('A');
  await expect(page.locator('#zoom-value')).toHaveText(scale);
  const after = await page.locator('.block-hit[data-module="A"]').boundingBox();
  expect(Math.abs(after.x + after.width / 2 - before.x - before.width / 2)).toBeLessThan(2);
  expect(Math.abs(after.y + after.height / 2 - before.y - before.height / 2)).toBeLessThan(2);
  const handle = page.locator('.port-column.output [data-action="drag"]').first();
  await handle.focus();
  await handle.press('Alt+ArrowDown');
  await ready(page);
  expect(
    (await documentState(page)).modules
      .find((m) => m.id === 'A')
      .ports.filter((p) => p.direction === 'output')
      .map((p) => p.id),
  ).toEqual(['e_out', 'b_out']);
  const world = page.locator('.preview-canvas > g');
  const initial = await world.getAttribute('transform');
  await page.locator('.preview-canvas').focus();
  await page.keyboard.press('ArrowRight');
  expect(await world.getAttribute('transform')).not.toBe(initial);
});

test('flat list sorting preserves endpoints, styles and layout settings', async ({ page }) => {
  await page.locator('#diagram-name').fill('Flat ordering');
  await page.locator('#diagram-name').press('Enter');
  await ready(page);
  const before = await documentState(page);
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add connection', exact: true })).toBeInViewport();
  const selected = page.locator('.connection-row').first();
  await selected.locator('[data-action="drag"]').focus();
  for (let n = 0; n < 3; n++) {
    await page.locator('.connection-row.selected [data-action="drag"]').press('Alt+ArrowDown');
    await ready(page);
  }
  await expect(page.locator('.connection-row.selected')).toHaveAttribute('data-index', '3');
  const after = await documentState(page);
  const byEndpoints = (connections) =>
    Object.fromEntries(connections.map((connection) => [connection.from + '->' + connection.to, connection]));
  expect(byEndpoints(after.connections)).toEqual(byEndpoints(before.connections));
  expect(after.layout).toEqual(before.layout);
});

test('invalid import, field validation, stale preview and unknown width correction', async ({ page }) => {
  const name = await page.locator('#diagram-name').inputValue();
  await page
    .locator('#file-input')
    .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await expect(page.locator('#message')).toContainText('current document is unchanged');
  await expect(page.locator('#diagram-name')).toHaveValue(name);
  const port = page.getByRole('textbox', { name: 'input feedback Key (ID)', exact: true });
  await port.fill('invalid.name');
  await port.press('Tab');
  await expect(port).toHaveAttribute('aria-invalid', 'true');
  await expect(port).toHaveValue('invalid.name');
  await port.fill('feedback');
  await port.press('Tab');
  await expect(port).not.toHaveAttribute('aria-invalid', 'true');
  const doc = {
    version: 1,
    diagram: { name: 'Optional width' },
    modules: [
      { id: 'A', ports: [{ id: 'o', direction: 'output', width: 8 }] },
      { id: 'B', ports: [{ id: 'i', direction: 'input' }] },
    ],
    connections: [{ from: 'A.o', to: 'B.i' }],
  };
  await importJson(page, doc);
  await ready(page);
  await page.locator('[data-action="select-block"][data-id="B"]').click();
  const width = page.getByRole('spinbutton', { name: 'i Width', exact: true });
  await width.fill('16');
  await width.press('Tab');
  await expect(page.locator('#preview-error')).toContainText('widths do not match');
  await expect(page.locator('[data-action="export-svg"]')).toBeDisabled();
  await expect(page.locator('.block-hit')).toHaveCount(2);
  await page.getByRole('spinbutton', { name: 'i Width', exact: true }).fill('');
  await page.getByRole('spinbutton', { name: 'i Width', exact: true }).press('Tab');
  await ready(page);
  expect((await documentState(page)).modules[1].ports[0].width).toBeUndefined();
});

test('rapid edits, IME draft safety, recoverable local draft and splitter keyboard', async ({ page }) => {
  const label = page.getByRole('textbox', { name: 'Block display name', exact: true });
  await label.dispatchEvent('compositionstart');
  await label.fill('中文輸入中');
  await label.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(label).toBeFocused();
  await label.dispatchEvent('compositionend');
  await label.press('Tab');
  await ready(page);
  expect((await documentState(page)).modules[0].label).toBe('中文輸入中');
  for (const name of ['first', 'second', 'latest']) {
    const control = page.getByRole('textbox', { name: 'Block display name', exact: true });
    await control.fill(name);
    await control.blur();
  }
  await ready(page);
  await expect(page.locator('.block-hit[data-module="A"]')).toHaveAttribute('aria-label', 'Select latest');
  const splitter = page.getByRole('separator', { name: 'Resize editor area', exact: true });
  const before = Number(await splitter.getAttribute('aria-valuenow'));
  await splitter.focus();
  await splitter.press('ArrowRight');
  expect(Number(await splitter.getAttribute('aria-valuenow'))).toBe(before + 2);
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await ready(page);
  await expect(page.locator('#message')).toContainText('Local draft restored');
  await expect(page.getByRole('textbox', { name: 'Block display name', exact: true })).toHaveValue('latest');
});

test('empty state and dirty replacement dialog have keyboard cancellation', async ({ page }) => {
  await toolbarAction(page, 'file', 'New document');
  await expect(page.locator('#preview-empty')).toBeVisible();
  await expect(page.locator('.block-hit')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add block', exact: true }).first().click();
  await toolbarAction(page, 'file', 'Load example');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#block-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('#preview-empty')).toBeVisible();
});

test('local native select popup, reduced motion, narrow viewport and accessibility', async ({ page }) => {
  const desktop = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(desktop.violations).toEqual([]);
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Add connection', exact: true }).first().click();
  await page.locator('#dialog-source').focus();
  await page.locator('#dialog-source').click();
  await page.locator('#dialog-source').press('ArrowDown');
  await page.screenshot({ path: 'output/editor/select-open.png' });
  await page.locator('#dialog-source').press('Enter');
  await expect(page.locator('#dialog-source')).toBeFocused();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('tab', { name: 'Blocks', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#blocks-heading')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const narrow = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(narrow.violations).toEqual([]);
  await page.locator('#preview-heading').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'output/editor/narrow.png', fullPage: true });
});

test('PNG size-limit error preserves editable document and SVG export', async ({ page }) => {
  await importJson(page, {
    version: 1,
    diagram: { name: 'Wide' },
    modules: [{ id: 'A', label: 'X'.repeat(5000), ports: [{ id: 'o', direction: 'output' }] }],
    connections: [],
  });
  await ready(page);
  await toolbarAction(page, 'export', 'Export PNG');
  await expect(page.locator('#message')).toContainText('Image size exceeds');
  await expect(page.locator('[data-action="export-svg"]')).toBeEnabled();
});

test('unfinished fields survive selection and reload; cancel draft restores valid export', async ({
  page,
}) => {
  const port = page.getByRole('textbox', { name: 'input feedback Key (ID)', exact: true });
  await port.fill('unfinished.name');
  await port.press('Tab');
  await expect(port).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('[data-action="export-svg"]')).toBeDisabled();
  await page.locator('[data-action="select-block"][data-id="B"]').click();
  await page.locator('[data-action="select-block"][data-id="A"]').click();
  await expect(page.getByRole('textbox', { name: 'input feedback Key (ID)', exact: true })).toHaveValue(
    'unfinished.name',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'input feedback Key (ID)', exact: true })).toHaveValue(
    'unfinished.name',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('textbox', { name: 'input feedback Key (ID)', exact: true })).toHaveValue(
    'feedback',
  );
});

test('style edits validate, update geometry, and work offline after initial load', async ({
  page,
  context,
}) => {
  await page.getByRole('button', { name: 'Block style', exact: true }).click();
  await page.getByRole('tab', { name: 'Label', exact: true }).click();
  const size = page.locator('[data-style-group="label"][data-style-property="fontSize"]');
  await size.fill('24');
  await size.press('Tab');
  const color = page.locator('[data-style-group="label"][data-style-property="color"]');
  await color.fill('not-a-color');
  await color.press('Tab');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(color).toHaveAttribute('aria-invalid', 'true');
  await color.fill('#123456');
  await color.press('Tab');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).modules[0].style.label.color).toBe('#123456');
  await context.setOffline(true);
  const label = page.getByRole('textbox', { name: 'Block display name', exact: true });
  await label.fill('Offline block');
  await label.blur();
  await ready(page);
  await expect(page.locator('.block-hit[data-module="A"]')).toHaveAttribute(
    'aria-label',
    'Select Offline block',
  );
  await context.setOffline(false);
});

test('sort menu escapes panel clipping and repeated keyboard sorting retains focus', async ({ page }) => {
  // This workflow tests root block ordering independently of group membership.
  const flat = JSON.parse(await readFile(new URL('../examples/style-gallery.json', import.meta.url), 'utf8'));
  for (const block of flat.modules) for (const port of block.ports) delete port.width;
  await importJson(page, flat);
  await ready(page);
  await page.locator('.block-row').first().locator('.sort-menu > summary').click();
  const menu = page.locator('.sort-menu[open] .sort-popover');
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  await menu.getByRole('button', { name: 'Move down', exact: true }).click();
  await ready(page);
  const handle = page.locator('.block-row').nth(1).locator('[data-action="drag"]');
  await expect(handle).toBeFocused();
  await handle.press('Alt+ArrowDown');
  await ready(page);
  await expect(page.locator('.block-row').nth(2).locator('[data-action="drag"]')).toBeFocused();
  expect((await documentState(page)).modules[2].id).toBe('A');
});

test('legacy modes are removed before ordinary connection editing', async ({ page }) => {
  await expect(page.getByRole('switch', { name: 'Order mode', exact: true })).toHaveCount(0);
  for (const mode of ['all', 'staged', 'auto', undefined]) {
    const layout = mode ? { direction: 'right', orderMode: mode } : { direction: 'right' };
    const input = {
      version: 1,
      diagram: { name: 'Mode ' + (mode ?? 'omitted') },
      modules: [
        {
          id: 'A',
          ports: [
            { id: 'data', direction: 'output' },
            { id: 'aux', direction: 'output' },
          ],
        },
        { id: 'B', ports: [{ id: 'in', direction: 'input' }] },
        { id: 'C', ports: [{ id: 'in', direction: 'input' }] },
      ],
      connections: [{ from: 'A.data', to: 'B.in', order: 3, alignment: true }],
      layout,
    };
    await importJson(page, input);
    await ready(page);
    await page.getByRole('tab', { name: 'Connections', exact: true }).click();
    await expect(page.locator('.main-group, .others-group')).toHaveCount(0);
    await expect(page.locator('[data-field="connection-order"], [data-field="alignment"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add connection', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Add connection', exact: true }).click();
    await ready(page);
    let doc = await documentState(page);
    expect(doc.layout).toEqual({ direction: 'right' });
    expect(doc.connections[0]).toEqual({ from: 'A.data', to: 'B.in' });
    expect(doc.connections[1]).toEqual({ from: 'A.data', to: 'C.in' });
    const source = page.getByRole('combobox', { name: 'Connection 2 source Output', exact: true });
    await source.focus();
    await source.selectOption('A.aux');
    await ready(page);
    doc = await documentState(page);
    expect(doc.layout).toEqual({ direction: 'right' });
    expect(doc.connections[1]).toEqual({ from: 'A.aux', to: 'C.in' });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await ready(page);
    expect((await documentState(page)).connections[1]).toEqual({ from: 'A.data', to: 'C.in' });
    expect((await documentState(page)).layout).toEqual({ direction: 'right' });
  }
});

test('Split, Editor and Preview views preserve zoom and render edits made while hidden', async ({ page }) => {
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const scale = await page.locator('#zoom-value').textContent();
  const control = page.locator('[data-action="cycle-view"]');
  await control.click();
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('.preview-panel')).toBeHidden();
  await expect(page.locator('#splitter')).toBeHidden();
  await page.getByRole('textbox', { name: 'Block display name', exact: true }).fill('Hidden preview update');
  await page.getByRole('textbox', { name: 'Block display name', exact: true }).blur();
  await ready(page);
  await page.screenshot({ path: 'output/editor/editor-view.png', fullPage: true });
  await control.click();
  await expect(page.locator('#workspace')).toBeHidden();
  await expect(page.locator('.preview-panel')).toBeVisible();
  await expect(page.locator('.block-hit[data-module="A"]')).toHaveAttribute(
    'aria-label',
    'Select Hidden preview update',
  );
  await expect(page.locator('#zoom-value')).toHaveText(scale);
  await page.screenshot({ path: 'output/editor/preview-view.png', fullPage: true });
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await ready(page);
  await expect(page.locator('.studio')).toHaveAttribute('data-view', 'preview');
  await expect(page.locator('#workspace')).toBeHidden();
  await page.locator('[data-action="cycle-view"]').click();
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('.preview-panel')).toBeVisible();
  await expect(page.locator('#splitter')).toBeVisible();
});

test('English UI and preview dragging prevent SVG text selection without affecting form text', async ({
  page,
}) => {
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(await page.locator('body').innerText()).not.toMatch(/\p{Script=Han}/u);
  const canvas = page.locator('.preview-canvas');
  const text = page.locator('.preview-canvas text').first();
  expect(await text.evaluate((el) => getComputedStyle(el).userSelect)).toBe('none');
  const textBox = await text.boundingBox();
  await page.mouse.move(textBox.x + 2, textBox.y + 2);
  await page.mouse.down();
  await page.mouse.move(textBox.x + 200, textBox.y + 50, { steps: 15 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  const before = await canvas.locator(':scope > g').getAttribute('transform');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 108, box.y + 65, { steps: 10 });
  await page.mouse.up();
  expect(await canvas.locator(':scope > g').getAttribute('transform')).not.toBe(before);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  const selectedLength = await page.locator('#diagram-name').evaluate((el) => {
    el.focus();
    el.select();
    return {
      start: el.selectionStart,
      end: el.selectionEnd,
      length: el.value.length,
      userSelect: getComputedStyle(el).userSelect,
    };
  });
  expect(selectedLength.start).toBe(0);
  expect(selectedLength.end).toBe(selectedLength.length);
  expect(selectedLength.userSelect).not.toBe('none');
});

test('style dialogs are transactional: Cancel and Escape discard; OK creates one undo step', async ({
  page,
}) => {
  const name = page.locator('#diagram-name');
  await name.fill('Style transaction');
  await name.blur();
  await ready(page);
  const original = await documentState(page);
  const opener = page.getByRole('button', { name: 'Block style', exact: true });
  await opener.click();
  await page.getByRole('tab', { name: 'Label', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('30');
  expect(await documentState(page)).toEqual(original);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(opener).toBeFocused();
  expect(await documentState(page)).toEqual(original);
  await opener.click();
  await page.getByRole('tab', { name: 'Label', exact: true }).click();
  await page.getByRole('textbox', { name: 'Text color', exact: true }).fill('#123456');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(await documentState(page)).toEqual(original);
  await opener.click();
  await page.getByRole('spinbutton', { name: 'Border width', exact: true }).fill('4');
  await page.getByRole('tab', { name: 'Label', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('22');
  await page.getByRole('textbox', { name: 'Text color', exact: true }).fill('#123456');
  await page.getByRole('tab', { name: 'Input labels', exact: true }).click();
  await page.getByRole('textbox', { name: 'Text color', exact: true }).fill('#456789');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await ready(page);
  await expect(opener).toBeFocused();
  const changed = await documentState(page);
  expect(changed.modules[0].style.borderWidth).toBe(4);
  expect(changed.modules[0].style.label.fontSize).toBe(22);
  expect(changed.modules[0].style.label.color).toBe('#123456');
  expect(changed.modules[0].style.inputPortLabel.color).toBe('#456789');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  expect(await documentState(page)).toEqual(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await ready(page);
  expect(await documentState(page)).toEqual(changed);
});

test('individual Input and Output port text styles are independent and exported', async ({ page }) => {
  const inputStyle = page.getByRole('button', { name: 'Input feedback text style', exact: true });
  await inputStyle.click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Input port text style');
  await page.getByRole('textbox', { name: 'Text color', exact: true }).fill('#1155cc');
  await page.getByRole('textbox', { name: 'Background color', exact: true }).fill('#ddffbb');
  await page.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('18');
  await page.getByRole('spinbutton', { name: 'Padding', exact: true }).fill('6');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await ready(page);
  await expect(inputStyle).toBeFocused();
  await expect(page.locator('.preview-canvas text[fill="#1155cc"]')).toHaveText('feedback');
  await expect(page.locator('.preview-canvas text[fill="#1155cc"]')).toHaveAttribute('font-size', '18');
  await page.getByRole('button', { name: 'Output b_out text style', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Output port text style');
  await page.getByRole('textbox', { name: 'Text color', exact: true }).fill('#884422');
  await page.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('20');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await ready(page);
  const doc = await documentState(page);
  expect(doc.modules[0].ports.find((p) => p.id === 'feedback').style).toMatchObject({
    color: '#1155cc',
    backgroundColor: '#ddffbb',
    fontSize: 18,
    padding: 6,
  });
  expect(doc.modules[0].ports.find((p) => p.id === 'b_out').style).toMatchObject({
    color: '#884422',
    fontSize: 20,
  });
  expect(doc.modules[0].ports.find((p) => p.id === 'e_out').style).toBeUndefined();
  const download = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export SVG');
  const svg = await readFile(await (await download).path(), 'utf8');
  expect(svg).toContain('fill="#1155cc"');
  expect(svg).toContain('fill="#884422"');
  expect(svg).toContain('fill="#ddffbb"');
  await page.getByRole('button', { name: 'Output b_out text style', exact: true }).click();
  await page.getByRole('textbox', { name: 'Text color', exact: true }).fill('');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await ready(page);
  expect(
    (await documentState(page)).modules[0].ports.find((p) => p.id === 'b_out').style.color,
  ).toBeUndefined();
});

test('style validation reveals the invalid tab; connection modal and keyboard tabs are accessible', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Block style', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Border width', exact: true }).fill('0');
  await page.getByRole('tab', { name: 'Label', exact: true }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Block', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('spinbutton', { name: 'Border width', exact: true })).toBeFocused();
  await expect(page.getByRole('spinbutton', { name: 'Border width', exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.getByRole('spinbutton', { name: 'Border width', exact: true }).fill('2');
  await page.getByRole('tab', { name: 'Block', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Output labels', exact: true })).toBeFocused();
  await page.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('16');
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  await page.screenshot({ path: 'output/editor/block-style-dialog.png' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Connection style: A.b_out to B.b_in', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Connection style');
  await page.getByRole('textbox', { name: 'Line color', exact: true }).fill('#3344aa');
  await page.getByRole('combobox', { name: 'Line pattern', exact: true }).selectOption('dotted');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).connections[0].style).toMatchObject({
    strokeColor: '#3344aa',
    lineStyle: 'dotted',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Blocks', exact: true }).click();
  await page.locator('[data-action="select-block"][data-id="A"]').click();
  await page.getByRole('button', { name: 'Input feedback text style', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const narrow = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(narrow.violations).toEqual([]);
  await page.screenshot({ path: 'output/editor/port-style-dialog.png' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('compact toolbar gives the workbench viewport height across all desktop views', async ({ page }) => {
  const header = page.locator('.app-header');
  expect((await header.boundingBox()).height).toBeLessThanOrEqual(49);
  await expect(page.locator('.workspace-caption, .app-footer')).toHaveCount(0);
  expect((await page.locator('.workbench').boundingBox()).height).toBeGreaterThanOrEqual(925);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await page.screenshot({ path: 'output/editor/compact-workspace.png' });
  for (const view of ['editor', 'preview', 'split']) {
    await page.locator('[data-action="cycle-view"]').click();
    await expect(page.locator('.studio')).toHaveAttribute('data-view', view);
    expect((await header.boundingBox()).height).toBeLessThanOrEqual(49);
    expect((await page.locator('.workbench').boundingBox()).height).toBeGreaterThanOrEqual(925);
  }
  await page.setViewportSize({ width: 320, height: 740 });
  expect((await header.boundingBox()).height).toBeLessThanOrEqual(90);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#export-menu > summary').click();
  const popover = await page.locator('#export-menu .command-popover').boundingBox();
  expect(popover.x).toBeGreaterThanOrEqual(0);
  expect(popover.x + popover.width).toBeLessThanOrEqual(320);
  await expect(page.getByRole('combobox', { name: 'PNG scale', exact: true })).toBeVisible();
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  if (!(await page.locator('#export-menu').evaluate((el) => el.open)))
    await page.locator('#export-menu > summary').click();
  await expect(page.getByRole('combobox', { name: 'PNG scale', exact: true })).toBeVisible();
  await page.screenshot({ path: 'output/editor/compact-export-mobile.png' });
});

test('toolbar disclosures close with Escape and outside clicks and restore focus after dialogs', async ({
  page,
}) => {
  const file = page.locator('#file-menu');
  const summary = file.locator('summary');
  await summary.focus();
  await summary.press('Enter');
  await page.keyboard.press('Tab');
  await expect(file.getByRole('button', { name: 'New document', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(file).not.toHaveAttribute('open');
  await expect(summary).toBeFocused();
  await expect(page.locator('.block-row.selected')).toHaveCount(1);
  await summary.click();
  await page.locator('#export-menu > summary').click();
  await expect(file).not.toHaveAttribute('open');
  await page.getByRole('combobox', { name: 'PNG scale', exact: true }).selectOption('3');
  await page.getByRole('combobox', { name: 'PNG scale', exact: true }).press('Escape');
  await expect(page.locator('#export-menu')).toHaveAttribute('open');
  await page.locator('#export-menu > summary').focus();
  await page.keyboard.press('Escape');
  await page.locator('#export-menu > summary').click();
  await expect(page.getByRole('combobox', { name: 'PNG scale', exact: true })).toHaveValue('3');
  await page.locator('#diagram-name').click();
  await expect(page.locator('#export-menu')).not.toHaveAttribute('open');
  await page.locator('#diagram-name').fill('Compact toolbar test');
  await page.locator('#diagram-name').press('Enter');
  await ready(page);
  await toolbarAction(page, 'file', 'New document');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(summary).toBeFocused();
  await expect(page.locator('#diagram-name')).toHaveValue('Compact toolbar test');
});

test('save indicator reveals transient status and storage errors remain actionable', async ({ page }) => {
  const notice = page.locator('#notice-shell');
  const state = page.locator('#save-state');
  await expect(notice).toBeHidden();
  await state.click();
  await expect(page.locator('#message')).toHaveText('Document saved');
  await expect(notice).toBeHidden({ timeout: 6500 });
  await page.evaluate(() => {
    window.originalStorageSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('Full', 'QuotaExceededError');
    };
  });
  await page.locator('#diagram-name').fill('Storage failure');
  await page.locator('#diagram-name').press('Enter');
  await ready(page);
  await expect(state).toHaveAccessibleName('Draft storage unavailable. Download JSON.');
  await expect(page.locator('#message')).toContainText('Local storage is full or disabled');
  // Errors must outlive the four-second success timeout.
  await page.waitForTimeout(4300);
  await expect(notice).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await expect(notice).toBeHidden();
  await state.click();
  await expect(notice).toBeVisible();
  await page.evaluate(() => {
    Storage.prototype.setItem = window.originalStorageSetItem;
  });
  await page.locator('#diagram-name').fill('Storage recovered');
  await page.locator('#diagram-name').press('Enter');
  await ready(page);
  await expect(state).toHaveAccessibleName(/Unsaved changes. Draft stored locally/);
  await expect(notice).not.toHaveClass(/status-error/);
});

async function feedbackPositions(page) {
  return page
    .locator('.block-hit')
    .evaluateAll((nodes) =>
      Object.fromEntries(nodes.map((node) => [node.dataset.module, Number(node.getAttribute('x'))])),
    );
}

test('feedback checkbox controls Mux cycle direction, history, persistence and JSON/SVG exports', async ({
  page,
}) => {
  const input = JSON.parse(
    await readFile(new URL('../examples/feedback-priority.json', import.meta.url), 'utf8'),
  );
  await importJson(page, input);
  await ready(page);
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  const checkbox = page
    .locator('.connection-row')
    .nth(2)
    .getByRole('checkbox', { name: 'Feedback', exact: true });
  await expect(checkbox).toBeChecked();
  let positions = await feedbackPositions(page);
  expect(positions.InputA).toBe(positions.InputB);
  expect(positions.InputA).toBeLessThan(positions.Mux);
  const zoom = await page.locator('#zoom-value').textContent();
  await checkbox.uncheck();
  await ready(page);
  expect((await documentState(page)).connections[2]).toEqual({ from: 'Mux.c', to: 'InputA.ain' });
  positions = await feedbackPositions(page);
  expect(positions.InputA).toBeGreaterThan(positions.Mux);
  await expect(checkbox).toBeFocused();
  await checkbox.press('Space');
  await ready(page);
  await expect(checkbox).toBeChecked();
  await expect(page.locator('#zoom-value')).toHaveText(zoom);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(checkbox).not.toBeChecked();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await ready(page);
  await expect(checkbox).toBeChecked();
  const download = page.waitForEvent('download');
  await toolbarAction(page, 'file', 'Save JSON');
  const saved = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(saved).toEqual(input);
  const svgDownload = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export SVG');
  const svg = await readFile(await (await svgDownload).path(), 'utf8');
  const { createDiagramModel, layoutDiagram, renderSvg } = await import('../src/lib/index.js');
  expect(svg).toBe(renderSvg(await layoutDiagram(createDiagramModel(input))));
  await page.reload();
  await ready(page);
  await expect(checkbox).toBeChecked();
  positions = await feedbackPositions(page);
  expect(positions.InputA).toBe(positions.InputB);
  expect(positions.InputA).toBeLessThan(positions.Mux);
  await page.screenshot({ path: 'output/editor/feedback-priority.png' });
});

test('new feedback connection is a cancellable dialog draft and works on narrow screens', async ({
  page,
}) => {
  const input = JSON.parse(
    await readFile(new URL('../examples/feedback-priority.json', import.meta.url), 'utf8'),
  );
  input.connections.pop();
  await importJson(page, input);
  await ready(page);
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  const before = await documentState(page);
  const open = page.getByRole('button', { name: 'Add connection', exact: true });
  await open.click();
  let dialog = page.getByRole('dialog', { name: 'Add connection', exact: true });
  const checkbox = dialog.getByRole('checkbox', { name: 'Feedback', exact: true });
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  expect(await documentState(page)).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  expect(await documentState(page)).toEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  await open.click();
  dialog = page.getByRole('dialog', { name: 'Add connection', exact: true });
  await expect(checkbox).not.toBeChecked();
  await page.locator('#dialog-source').selectOption('Mux.c');
  await page.locator('#dialog-target').selectOption('InputA.ain');
  await checkbox.check();
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  await page.screenshot({ path: 'output/editor/feedback-dialog-mobile.png' });
  await dialog.getByRole('button', { name: 'Add connection', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).connections[2]).toEqual({
    from: 'Mux.c',
    to: 'InputA.ain',
    feedback: true,
  });
  await expect(page.locator('.connection-row').nth(2).getByRole('checkbox')).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).connections).toEqual(before.connections);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).connections[2].feedback).toBe(true);
});

test('single-level groups keep root blocks, move by drag/menu, collapse without layout and undo ungroup', async ({
  page,
}) => {
  const input = JSON.parse(
    await readFile(new URL('../examples/feedback-priority.json', import.meta.url), 'utf8'),
  );
  await importJson(page, input);
  await ready(page);
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  await page.getByRole('textbox', { name: 'Group name', exact: true }).fill('Inputs');
  await page.getByRole('textbox', { name: 'Group name', exact: true }).blur();
  await ready(page);
  const group = page.locator('.group-section');
  await page.locator('.block-row[data-id="InputA"] [data-action="drag"]').dragTo(group.locator('.group-row'));
  await ready(page);
  await expect(group.locator('.block-row')).toHaveCount(1);
  await page.locator('.block-row[data-id="InputB"]').click({ button: 'right' });
  await page.getByRole('button', { name: 'Move to group...', exact: true }).click();
  await page.getByRole('combobox', { name: 'Group', exact: true }).selectOption('group_1');
  await page.getByRole('dialog').getByRole('button', { name: 'Move block', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).groups[0].members).toEqual(['InputA', 'InputB']);
  await expect(page.locator('#block-list > .block-row')).toHaveCount(1);
  const before = await documentState(page);
  await page.evaluate(() => {
    window.groupLayoutPosts = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args) {
      window.groupLayoutPosts++;
      return post.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Collapse Inputs', exact: true }).click();
  await expect(group.locator('.group-members')).toBeHidden();
  await page.locator('#block-list-splitter').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#block-list-splitter')).toHaveAttribute('aria-valuenow', '270');
  expect(await page.evaluate(() => window.groupLayoutPosts)).toBe(0);
  expect(await documentState(page)).toEqual(before);
  await page.locator('.block-hit[data-module="InputA"]').focus();
  await page.keyboard.press('Enter');
  await expect(group.locator('.group-members')).toBeVisible();
  await expect(page.locator('[data-field="module-key"]')).toHaveValue('InputA');
  await page.locator('.group-hit').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Group details', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Group style', exact: true }).click();
  await page.getByRole('textbox', { name: 'Border color', exact: true }).fill('#336699');
  await page.getByRole('tab', { name: 'Label', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('18');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('button', { name: 'Group style', exact: true })).toBeFocused();
  await page.screenshot({ path: 'output/editor/groups-editor.png' });
  await page.getByRole('button', { name: 'Ungroup (keep contents)', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).groups).toBeUndefined();
  expect((await documentState(page)).connections).toEqual(input.connections);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).groups[0].style.label.fontSize).toBe(18);
  await page
    .locator('.block-row[data-id="InputB"] [data-action="drag"]')
    .dragTo(page.locator('.root-drop-zone'));
  await ready(page);
  expect((await documentState(page)).groups[0].members).toEqual(['InputA']);
  await page.locator('.group-select[data-id="group_1"]').click();
  await page.getByRole('textbox', { name: 'Group name', exact: true }).fill('');
  await page.getByRole('textbox', { name: 'Group name', exact: true }).blur();
  await expect(page.locator('[data-field="group-label"]')).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Ungroup (keep contents)', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).groups).toBeUndefined();
});

test('groups preserve references on key edits, export styled geometry, and reject cyclic groups', async ({
  page,
}) => {
  const input = JSON.parse(
    await readFile(new URL('../examples/grouped-feedback.json', import.meta.url), 'utf8'),
  );
  await importJson(page, input);
  await ready(page);
  const key = page.locator('[data-field="module-key"]');
  await key.fill('Source');
  await key.press('Enter');
  await ready(page);
  let doc = await documentState(page);
  expect(doc.groups[0].members).toEqual(['Source', 'B']);
  expect(doc.connections[0].from).toBe('Source.b_out');
  let event = page.waitForEvent('download');
  await toolbarAction(page, 'file', 'Save JSON');
  expect(JSON.parse(await readFile(await (await event).path(), 'utf8'))).toEqual(doc);
  event = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export SVG');
  const svg = await readFile(await (await event).path(), 'utf8');
  const { createDiagramModel, layoutDiagram, renderSvg } = await import('../src/lib/index.js');
  expect(svg).toBe(renderSvg(await layoutDiagram(createDiagramModel(doc))));
  expect(svg).toContain('data-role="group"');
  expect(svg).not.toContain('group-hit');
  const bad = structuredClone(doc);
  bad.groups[0].members.push('auxiliary');
  bad.groups[1].members.push('pipeline');
  await importJson(page, bad);
  await expect(page.locator('#message')).toContainText('Group hierarchy contains a cycle');
  expect(await documentState(page)).toEqual(doc);
  await page.reload();
  await ready(page);
  await expect(page.locator('.group-section')).toHaveCount(2);
  await page.getByRole('button', { name: 'Select group Pipeline', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Group style', exact: true }).click();
  await page.getByRole('textbox', { name: 'Group fill', exact: true }).fill('#ffccaa');
  await page.keyboard.press('Escape');
  expect(await documentState(page)).toEqual(doc);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({ path: 'output/editor/groups-mobile.png', fullPage: true });
});

test('empty groups render and new blocks join a selected group; create-group action is keyboard accessible', async ({
  page,
}) => {
  await toolbarAction(page, 'file', 'New document');
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  await ready(page);
  await expect(page.locator('.group-hit')).toHaveCount(1);
  await expect(page.locator('#preview-empty')).toBeHidden();
  await page.getByRole('button', { name: 'Add block', exact: true }).first().click();
  await page.getByRole('button', { name: 'Add input', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).groups[0].members).toEqual(['block_1']);
  await page.locator('.block-row .block-menu summary').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Create group with this block', exact: true }).click();
  await ready(page);
  const doc = await documentState(page);
  expect(doc.groups).toHaveLength(2);
  expect(doc.groups[0].members).toEqual(['group_2']);
  expect(doc.groups[1].members).toEqual(['block_1']);
});

test('group-aware deletion and sorting address block keys instead of visible row indices', async ({
  page,
}) => {
  const input = JSON.parse(
    await readFile(new URL('../examples/grouped-feedback.json', import.meta.url), 'utf8'),
  );
  await importJson(page, input);
  await ready(page);
  const row = (id) => page.locator('.block-row[data-id="' + id + '"]');
  await row('C').getByLabel('Reorder options', { exact: true }).click();
  await row('C').getByRole('button', { name: 'Move down', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).groups).toEqual(input.groups);
  await row('D').getByRole('button', { name: 'Delete', exact: true }).click();
  await ready(page);
  let doc = await documentState(page);
  expect(doc.modules.some((m) => m.id === 'D')).toBe(false);
  expect(doc.modules.some((m) => m.id === 'A')).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await row('E').getByRole('button', { name: 'Delete', exact: true }).click();
  await ready(page);
  doc = await documentState(page);
  expect(doc.groups[1].members).toEqual(['F']);
  expect(doc.modules.some((m) => m.id === 'A')).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).groups[1].members).toEqual(['E', 'F']);
});

test('nested hierarchy search, paths, collapse and editor width preserve document and split views', async ({
  page,
}) => {
  const input = JSON.parse(
    await readFile(new URL('../examples/nested-groups.json', import.meta.url), 'utf8'),
  );
  await importJson(page, input);
  await ready(page);
  const before = await documentState(page);
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await expect(page.locator('.group-select[data-id="core"]')).toBeHidden();
  const search = page.getByRole('searchbox', { name: 'Search blocks and groups', exact: true });
  await search.fill('no-such-item');
  await expect(page.getByText('No matching blocks or groups.', { exact: true })).toBeVisible();
  await search.fill('Source');
  await expect(page.locator('.block-row[data-id="A"]')).toBeVisible();
  await page.locator('.block-row[data-id="A"] [data-action="select-block"]').click();
  await expect(search).toHaveValue('');
  await expect(page.locator('.item-path')).toContainText('System');
  await expect(page.locator('.item-path')).toContainText('Core');
  await expect(page.locator('.item-path')).toContainText('Pipeline');
  await page.getByRole('button', { name: 'Open group Core', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Group name', exact: true })).toHaveValue('Core');
  await page.locator('[data-action="cycle-view"]').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-view', 'editor');
  expect((await page.locator('.block-panel').boundingBox()).width).toBeGreaterThanOrEqual(350);
  await page.locator('#block-list-splitter').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#block-list-splitter')).toHaveAttribute('aria-valuenow', '370');
  await page.screenshot({ path: 'output/editor/nested-groups-editor.png' });
  await page.locator('[data-action="cycle-view"]').click();
  await page.locator('[data-action="cycle-view"]').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-view', 'split');
  await expect(page.locator('#block-list-splitter')).toHaveAttribute('aria-valuenow', '260');
  expect(await documentState(page)).toEqual(before);
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await page.locator('.group-select[data-id="system"]').click();
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).groups.find((g) => g.id === 'system').members).toContain('group_1');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await page.reload();
  await ready(page);
  await page.locator('[data-action="cycle-view"]').click();
  await expect(page.locator('#block-list-splitter')).toHaveAttribute('aria-valuenow', '370');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze())
      .violations,
  ).toEqual([]);
});

test('nested group moves reject descendants and ungroup promotes contents without touching endpoints', async ({
  page,
}) => {
  const input = JSON.parse(
    await readFile(new URL('../examples/nested-groups.json', import.meta.url), 'utf8'),
  );
  await importJson(page, input);
  await ready(page);
  await page
    .locator('.group-section[data-group-id="auxiliary"] > .group-row [data-action="drag"]')
    .dragTo(page.locator('.group-section[data-group-id="system"] > .group-row'));
  await ready(page);
  let doc = await documentState(page);
  expect(doc.groups.find((g) => g.id === 'system').members).toEqual(['core', 'auxiliary']);
  const before = structuredClone(doc);
  await page
    .locator('.group-section[data-group-id="system"] > .group-row [data-action="drag"]')
    .dragTo(page.locator('.group-section[data-group-id="pipeline"] > .group-row'));
  expect(await documentState(page)).toEqual(before);
  await page.locator('.group-section[data-group-id="core"] > .group-row .group-menu summary').click();
  await page.getByRole('button', { name: 'Move to group...', exact: true }).click();
  await expect(page.locator('#move-group option[value="pipeline"]')).toHaveCount(0);
  await expect(page.locator('#move-group option[value="core"]')).toHaveCount(0);
  await page.locator('#move-group').selectOption('');
  await page.getByRole('dialog').getByRole('button', { name: 'Move group', exact: true }).click();
  await ready(page);
  expect((await documentState(page)).groups.find((g) => g.id === 'system').members).toEqual(['auxiliary']);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await page.locator('.group-select[data-id="core"]').click();
  await page.getByRole('button', { name: 'Ungroup (keep contents)', exact: true }).click();
  await ready(page);
  doc = await documentState(page);
  expect(doc.groups.find((g) => g.id === 'system').members).toEqual(['pipeline', 'auxiliary']);
  expect(doc.connections).toEqual(input.connections);
  const event = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export SVG');
  const svg = await readFile(await (await event).path(), 'utf8');
  const { createDiagramModel, layoutDiagram, renderSvg } = await import('../src/lib/index.js');
  expect(svg).toBe(renderSvg(await layoutDiagram(createDiagramModel(doc))));
  await page.screenshot({ path: 'output/editor/nested-groups-preview.png' });
});

test('Collection group type preserves individual links, expands with history and exports stacked cards', async ({
  page,
}) => {
  const raw = JSON.parse(
    await readFile(new URL('../examples/collection-instances.json', import.meta.url), 'utf8'),
  );
  await importJson(page, raw);
  await ready(page);
  await page.locator('.group-select[data-id="PEs"]').click();
  const type = page.getByRole('combobox', { name: 'Group type', exact: true });
  await expect(type).toHaveValue('collection');
  await expect(page.locator('.block-hit')).toHaveCount(2);
  await expect(page.locator('.connection-hit')).toHaveCount(32);
  await expect(page.locator('[data-role="collection-layer"]')).toHaveCount(2);
  await expect(
    page.locator('.preview-canvas text').filter({ hasText: 'Processing elements \u00d716' }),
  ).toHaveCount(1);
  await page.locator('.connection-hit[data-edge="Source.out->PE_0.in"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.connection-row.selected')).toHaveAttribute(
    'data-edge-key',
    'Source.out->PE_0.in',
  );
  await page.getByRole('tab', { name: 'Blocks', exact: true }).click();
  await page.locator('.group-select[data-id="PEs"]').click();
  const hide = page.getByRole('checkbox', { name: 'Hide contents', exact: true });
  await hide.uncheck();
  await ready(page);
  await expect(page.locator('.block-hit')).toHaveCount(18);
  await expect(page.locator('.connection-hit')).toHaveCount(47);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(hide).toBeChecked();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await ready(page);
  await hide.check();
  await ready(page);
  let event = page.waitForEvent('download');
  await toolbarAction(page, 'file', 'Save JSON');
  expect(JSON.parse(await readFile(await (await event).path(), 'utf8'))).toEqual(raw);
  event = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export SVG');
  expect(await readFile(await (await event).path(), 'utf8')).toContain('data-role="collection-layer"');
  event = page.waitForEvent('download');
  await toolbarAction(page, 'export', 'Export PNG');
  expect((await sharp(await readFile(await (await event).path())).metadata()).width).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
  await page.screenshot({ path: 'output/editor/collection-editor.png' });
  await page.setViewportSize({ width: 720, height: 900 });
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze())
      .violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await type.selectOption('container');
  await ready(page);
  await expect(hide).toHaveCount(0);
  await expect(page.locator('.block-hit')).toHaveCount(18);
  await type.selectOption('boundary');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Source.out');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(type).toBeFocused();
  await expect(type).toHaveValue('container');
});
