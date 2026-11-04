import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import sharp from 'sharp';

// Move the complete artifact to a folder with spaces and Unicode before opening.
const source = new URL('../dist-offline/', import.meta.url);
const portable = new URL('../output/editor/offline copy \u6e2c\u8a66/', import.meta.url);
const fileUrl = new URL('index.html', portable).href;
const feedbackFile = fileURLToPath(new URL('../examples/feedback-priority.json', import.meta.url));

test('offline Group view expands hidden contents for scoped SVG while JSON retains the full graph', async ({
  page,
}) => {
  const raw = JSON.parse(
    await readFile(new URL('../examples/boundary-groups.json', import.meta.url), 'utf8'),
  );
  raw.groups.forEach((group) => (group.collapsed = true));
  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file', 'Open JSON');
  await (
    await chooser
  ).setFiles({
    name: 'group-view.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(raw)),
  });
  await ready(page);
  await page.getByRole('combobox', { name: 'View target', exact: true }).selectOption('Inner');
  await ready(page);
  await expect(page.locator('.block-hit')).toHaveCount(5);
  await expect(page.locator('[data-preview-group="Inner"]')).toHaveCount(0);
  let event = page.waitForEvent('download');
  await command(page, 'export', 'Export SVG');
  const svg = await readFile(await (await event).path(), 'utf8');
  expect(svg).toContain('Decode / execute core');
  expect(svg).not.toContain('Processing subsystem');
  expect(svg).not.toContain('Source');
  event = page.waitForEvent('download');
  await command(page, 'file', 'Save JSON');
  expect(JSON.parse(await readFile(await (await event).path(), 'utf8'))).toEqual(raw);
  await page.getByRole('button', { name: 'View Top', exact: true }).click();
  await ready(page);
  await expect(page.locator('.block-hit')).toHaveCount(2);
});

test('offline Preview actions edit styles and toggle group contents without the settings panel', async ({
  page,
}) => {
  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file', 'Open JSON');
  await (
    await chooser
  ).setFiles(fileURLToPath(new URL('../examples/collection-instances.json', import.meta.url)));
  await ready(page);
  for (
    let attempt = 0;
    attempt < 3 && (await page.locator('.studio').getAttribute('data-view')) !== 'preview';
    attempt++
  )
    await page.locator('[data-action="cycle-view"]').click();
  const group = page.locator('.collapsed-group-hit[data-module="PEs"]');
  await group.dblclick();
  await page.getByRole('textbox', { name: 'Border color', exact: true }).fill('#556677');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await ready(page);
  await expect(group).toBeFocused();
  await expect(page.locator('#workspace')).toBeHidden();
  await group.click({ button: 'right' });
  await page
    .locator('#preview-actions-menu')
    .getByRole('button', { name: 'Edit label…', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: 'Label', exact: true })
    .fill('Processing\narray');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await ready(page);
  await expect(group).toBeFocused();
  await page.locator('[data-preview-group="PEs"]').focus();
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(page.locator('.block-hit')).toHaveCount(18);
  const event = page.waitForEvent('download');
  await command(page, 'file', 'Save JSON');
  const saved = JSON.parse(await readFile(await (await event).path(), 'utf8'));
  expect(saved.groups[0]).toMatchObject({
    collapsed: false,
    label: 'Processing\narray',
    style: { borderColor: '#556677' },
  });
  expect(saved.modules).toHaveLength(18);
  expect(saved.connections).toHaveLength(47);
});

test('offline conversion keeps block dimensions and endpoints and restores its type with Undo', async ({
  page,
}) => {
  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file', 'Open JSON');
  const legacy = JSON.parse(await readFile(new URL('../examples/block-sizes.json', import.meta.url), 'utf8'));
  legacy.layout.orderMode = 'staged';
  legacy.connections[0].order = 3;
  await (
    await chooser
  ).setFiles({
    name: 'legacy-sizes.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
  await ready(page);
  await page.locator('.block-row[data-id="Mux"]').click({ button: 'right' });
  await page.getByRole('button', { name: 'Convert to boundary group', exact: true }).click();
  await ready(page);
  await expect(page.locator('.collapsed-group-hit[data-module="Mux"]')).toHaveAttribute('height', '294');
  const download = page.waitForEvent('download');
  await command(page, 'file', 'Save JSON');
  const doc = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(doc.layout).not.toHaveProperty('orderMode');
  expect(doc.connections[0]).not.toHaveProperty('order');
  expect(doc.groups[0]).toMatchObject({
    id: 'Mux',
    collapsed: true,
    type: 'boundary',
    width: 1.2,
    height: 3.5,
  });
  expect(doc.groups[0].ports).toHaveLength(4);
  expect(doc.connections).toHaveLength(3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(page.locator('.block-hit[data-module="Mux"]')).toHaveAttribute('height', '294');
});

test('offline Hide contents renders a compact group and restores children through undo', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file', 'Open JSON');
  await (await chooser).setFiles(fileURLToPath(new URL('../examples/boundary-groups.json', import.meta.url)));
  await ready(page);
  await page.locator('.group-select[data-id="Outer"]').click();
  await page.getByRole('checkbox', { name: 'Hide contents', exact: true }).check();
  await ready(page);
  await expect(page.locator('.block-hit')).toHaveCount(2);
  await expect(page.locator('.collapsed-group-hit')).toHaveCount(1);
  let download = page.waitForEvent('download');
  await command(page, 'file', 'Save JSON');
  const doc = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(doc.modules).toHaveLength(12);
  expect(doc.connections).toHaveLength(19);
  expect(doc.groups[0].collapsed).toBe(true);
  download = page.waitForEvent('download');
  await command(page, 'export', 'Export SVG');
  const svg = await readFile(await (await download).path(), 'utf8');
  expect(svg).toContain('data-collapsed="true"');
  expect(svg).not.toContain('Dispatch');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(page.locator('.block-hit')).toHaveCount(12);
});

test('offline editor imports, edits and exports nested boundary ports', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file', 'Open JSON');
  await (await chooser).setFiles(fileURLToPath(new URL('../examples/boundary-groups.json', import.meta.url)));
  await ready(page);
  await expect(page.locator('[data-role="group-port"]')).toHaveCount(5);
  await page.locator('.group-select[data-id="Inner"]').click();
  await page.getByRole('textbox', { name: 'input in Display name', exact: true }).fill('Payload\ninput');
  await page.getByRole('textbox', { name: 'input in Display name', exact: true }).blur();
  await ready(page);
  const download = page.waitForEvent('download');
  await command(page, 'export', 'Export SVG');
  const svg = await readFile(await (await download).path(), 'utf8');
  expect(svg).toContain('Payload');
  expect(svg.match(/data-role="group-port"/g)).toHaveLength(5);
});

test('file editor supports relative block dimensions and exports the resized diagram', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file', 'Open JSON');
  await (await chooser).setFiles(fileURLToPath(new URL('../examples/block-sizes.json', import.meta.url)));
  await ready(page);
  await page.locator('.block-row[data-id="Mux"] [data-action="select-block"]').click();
  const height = page.getByRole('spinbutton', { name: 'Block height', exact: true });
  await height.fill('4.5');
  await height.press('Enter');
  await ready(page);
  await expect(page.locator('.block-hit[data-module="Mux"]')).toHaveAttribute('height', '378');
  let event = page.waitForEvent('download');
  await command(page, 'file', 'Save JSON');
  const doc = JSON.parse(await readFile(await (await event).path(), 'utf8'));
  expect(doc.modules.find((block) => block.id === 'Mux').height).toBe(4.5);
  event = page.waitForEvent('download');
  await command(page, 'export', 'Export SVG');
  const svg = await readFile(await (await event).path(), 'utf8');
  const { createDiagramModel, layoutDiagram, renderSvg } = await import('../src/lib/index.js');
  expect(svg).toBe(renderSvg(await layoutDiagram(createDiagramModel(doc))));
  await page.screenshot({ path: 'output/editor/offline-block-sizes.png' });
});

test('file editor preserves multiline names and port labels through exports', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file', 'Open JSON');
  await (
    await chooser
  ).setFiles(fileURLToPath(new URL('../examples/multiline-labels.json', import.meta.url)));
  await ready(page);
  await expect(page.locator('.preview-canvas tspan')).not.toHaveCount(0);
  await page.locator('.block-row[data-id="A"] [data-action="select-block"]').click();
  const label = page.getByRole('textbox', { name: 'output b_out Display name', exact: true });
  await label.fill('Offline\nPayload');
  await label.blur();
  await ready(page);
  let event = page.waitForEvent('download');
  await command(page, 'file', 'Save JSON');
  const doc = JSON.parse(await readFile(await (await event).path(), 'utf8'));
  expect(doc.modules[0].ports.find((port) => port.id === 'b_out').label).toBe('Offline\nPayload');
  event = page.waitForEvent('download');
  await command(page, 'export', 'Export SVG');
  const svg = await readFile(await (await event).path(), 'utf8');
  expect(svg).toContain('<tspan');
  expect(svg).toContain('Payload[7:0]');
  await page.screenshot({ path: 'output/editor/offline-multiline-text.png' });
});

test('file editor renders and exports editable connection labels without network', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file', 'Open JSON');
  await (
    await chooser
  ).setFiles(fileURLToPath(new URL('../examples/connection-labels.json', import.meta.url)));
  await ready(page);
  await expect(page.locator('[data-role="connection-label"]')).toHaveCount(7);
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  const label = page.getByRole('textbox', { name: 'Connection 1 label', exact: true });
  await label.fill('offline payload');
  await label.blur();
  await ready(page);
  let event = page.waitForEvent('download');
  await command(page, 'file', 'Save JSON');
  const doc = JSON.parse(await readFile(await (await event).path(), 'utf8'));
  expect(doc.connections[0].label).toBe('offline payload');
  event = page.waitForEvent('download');
  await command(page, 'export', 'Export SVG');
  const svg = await readFile(await (await event).path(), 'utf8');
  expect(svg).toContain('offline payload');
  expect(svg).not.toContain('connection-label-hit');
  await page.screenshot({ path: 'output/editor/offline-connection-labels.png' });
});

async function ready(page) {
  await expect(page.locator('#layout-state')).toHaveText('Updated');
  await expect(page.locator('[data-action="export-svg"]')).toBeEnabled();
}

async function command(page, menu, label) {
  const details = page.locator('#' + menu + '-menu');
  if (!(await details.evaluate((el) => el.open))) await details.locator('summary').click();
  await details.getByRole('button', { name: label, exact: true }).click();
}

async function openFeedback(page) {
  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file', 'Open JSON');
  await (await chooser).setFiles(feedbackFile);
  await expect(page.locator('#diagram-name')).toHaveValue('Input / Mux feedback');
  await ready(page);
}

const failures = new WeakMap();
test.beforeAll(async () => {
  await mkdir(portable, { recursive: true });
  for (const name of ['index.html', 'app.js', 'style.css'])
    await copyFile(new URL(name, source), new URL(name, portable));
});

test.beforeEach(async ({ page, context }) => {
  const errors = [];
  failures.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  context.on('request', (request) => {
    if (/^https?:/.test(request.url())) errors.push('Unexpected network request: ' + request.url());
  });
  await page.goto(fileUrl);
  await ready(page);
});

test.afterEach(async ({ page }) => {
  expect(failures.get(page)).toEqual([]);
});

test('portable folder opens as classic scripts and runs a Blob layout worker with no server', async ({
  page,
}) => {
  expect((await readdir(source)).sort()).toEqual(['app.js', 'index.html', 'style.css']);
  const html = await readFile(new URL('index.html', source), 'utf8');
  expect(html).toContain('<script defer src="./app.js"></script>');
  expect(html).toContain('href="./style.css"');
  expect(html).not.toMatch(/type="module"|modulepreload|crossorigin/);
  // A classic-script parser rejects any remaining top-level imports/import.meta.
  new Script(await readFile(new URL('app.js', source), 'utf8'));
  expect(page.url()).toBe(fileUrl);
  expect(page.workers().length).toBeGreaterThan(0);
  expect(page.workers().every((worker) => worker.url().startsWith('blob:'))).toBe(true);
  await expect(page.locator('.block-hit')).toHaveCount(6);
  await expect(page.locator('.group-hit')).toHaveCount(4);
  await expect(page.locator('[data-role="connection-label"]')).toHaveCount(7);
  expect(await page.locator('.workbench').evaluate((el) => getComputedStyle(el).display)).toBe('grid');
  await expect(page.locator('.brand')).toHaveAttribute('href', './index.html');
  await page.screenshot({ path: 'output/editor/offline-startup.png' });
});

test('file editor supports Feedback, undo/redo, JSON/SVG/PNG downloads and draft restoration', async ({
  page,
}) => {
  await openFeedback(page);
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  const checkbox = page
    .locator('.connection-row')
    .nth(2)
    .getByRole('checkbox', { name: 'Feedback', exact: true });
  await expect(checkbox).toBeChecked();
  const xs = await page
    .locator('.block-hit')
    .evaluateAll((nodes) =>
      Object.fromEntries(nodes.map((node) => [node.dataset.module, Number(node.getAttribute('x'))])),
    );
  expect(xs.InputA).toBe(xs.InputB);
  expect(xs.InputA).toBeLessThan(xs.Mux);
  await checkbox.uncheck();
  await ready(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(checkbox).toBeChecked();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await ready(page);
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await ready(page);
  let event = page.waitForEvent('download');
  await command(page, 'file', 'Save JSON');
  const document = JSON.parse(await readFile(await (await event).path(), 'utf8'));
  expect(document).toEqual(JSON.parse(await readFile(feedbackFile, 'utf8')));
  event = page.waitForEvent('download');
  await command(page, 'export', 'Export SVG');
  const svg = await readFile(await (await event).path(), 'utf8');
  const { createDiagramModel, layoutDiagram, renderSvg } = await import('../src/lib/index.js');
  expect(svg).toBe(renderSvg(await layoutDiagram(createDiagramModel(document))));
  event = page.waitForEvent('download');
  await command(page, 'export', 'Export PNG');
  const png = await readFile(await (await event).path());
  const metadata = await sharp(png).metadata();
  expect(metadata.format).toBe('png');
  expect(metadata.width).toBeGreaterThan(0);
  expect(metadata.height).toBeGreaterThan(0);
  await page.reload();
  await ready(page);
  await expect(checkbox).toBeChecked();
  await page.screenshot({ path: 'output/editor/offline-editor.png' });
});

test('file editor preserves edits when storage is unavailable and keeps narrow dialogs accessible', async ({
  page,
}) => {
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Blocked', 'SecurityError');
    };
  });
  await page.locator('#diagram-name').fill('Offline storage unavailable');
  await page.locator('#diagram-name').press('Enter');
  await ready(page);
  await expect(page.locator('#save-state')).toHaveAccessibleName('Draft storage unavailable. Download JSON.');
  await expect(page.locator('#message')).toContainText('Download JSON');
  const event = page.waitForEvent('download');
  await command(page, 'file', 'Save JSON');
  const saved = JSON.parse(await readFile(await (await event).path(), 'utf8'));
  expect(saved.diagram.name).toBe('Offline storage unavailable');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add connection', exact: true });
  await expect(dialog.getByRole('checkbox', { name: 'Feedback', exact: true })).not.toBeChecked();
  await page.locator('#dialog-source').click();
  await page.locator('#dialog-source').press('ArrowDown');
  await page.locator('#dialog-source').press('Enter');
  expect(
    (
      await new AxeBuilder({ page })
        .options({ preload: false })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: 'output/editor/offline-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Blob worker failure retries cleanly and rapid edits retain the latest result', async ({ page }) => {
  const initial = page.workers()[0];
  await initial.evaluate(() => {
    setTimeout(() => {
      throw new Error('Offline worker test failure');
    }, 0);
  });
  await expect(page.locator('#layout-state')).toHaveText('Layout failed');
  await expect(page.locator('#preview-error')).toContainText('Re-layout to retry');
  await page.getByRole('button', { name: 'Re-layout', exact: true }).click();
  await ready(page);
  await expect(page.locator('#preview-error')).toBeHidden();
  for (const name of ['Offline first', 'Offline second', 'Offline final']) {
    await page.locator('[data-field="module-label"]').fill(name);
    await page.locator('[data-field="module-label"]').blur();
  }
  await ready(page);
  const event = page.waitForEvent('download');
  await command(page, 'export', 'Export SVG');
  expect(await readFile(await (await event).path(), 'utf8')).toContain('Offline final');
});

test('file editor groups support cross-hierarchy layout, membership changes and exports', async ({
  page,
}) => {
  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file', 'Open JSON');
  await (
    await chooser
  ).setFiles(fileURLToPath(new URL('../examples/grouped-feedback.json', import.meta.url)));
  await expect(page.locator('#diagram-name')).toHaveValue('Grouped pipeline and feedback');
  await ready(page);
  await expect(page.locator('.group-hit')).toHaveCount(2);
  await page
    .locator('.block-row[data-id="C"] [data-action="drag"]')
    .dragTo(page.locator('.group-section[data-group-id="pipeline"] .group-row'));
  await ready(page);
  await page.locator('.group-hit[data-module="pipeline"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Group details', exact: true })).toBeVisible();
  let event = page.waitForEvent('download');
  await command(page, 'file', 'Save JSON');
  const doc = JSON.parse(await readFile(await (await event).path(), 'utf8'));
  expect(doc.groups[0].members).toEqual(['A', 'B', 'C']);
  event = page.waitForEvent('download');
  await command(page, 'export', 'Export SVG');
  const svg = await readFile(await (await event).path(), 'utf8');
  const { createDiagramModel, layoutDiagram, renderSvg } = await import('../src/lib/index.js');
  expect(svg).toBe(renderSvg(await layoutDiagram(createDiagramModel(doc))));
  expect(svg).toContain('data-role="group"');
  await page.screenshot({ path: 'output/editor/offline-groups.png' });
});

test('file editor supports nested groups, search and parent-first SVG export', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file', 'Open JSON');
  await (await chooser).setFiles(fileURLToPath(new URL('../examples/nested-groups.json', import.meta.url)));
  await expect(page.locator('#diagram-name')).toHaveValue('Nested groups and feedback');
  await ready(page);
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search blocks and groups', exact: true }).fill('Source');
  await page.locator('.block-row[data-id="A"] [data-action="select-block"]').click();
  await expect(page.locator('.item-path')).toContainText('System');
  await expect(page.locator('.group-hit')).toHaveCount(4);
  const event = page.waitForEvent('download');
  await command(page, 'export', 'Export SVG');
  const svg = await readFile(await (await event).path(), 'utf8');
  expect(svg.indexOf('data-group="system"')).toBeLessThan(svg.indexOf('data-group="pipeline"'));
});

test('offline Collection groups retain JSON while exporting the stacked overview', async ({ page }) => {
  const raw = JSON.parse(
    await readFile(new URL('../examples/collection-instances.json', import.meta.url), 'utf8'),
  );
  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file', 'Open JSON');
  await (
    await chooser
  ).setFiles({
    name: 'collection.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(raw)),
  });
  await ready(page);
  await page.locator('.group-select[data-id="PEs"]').click();
  await expect(page.getByRole('combobox', { name: 'Group type', exact: true })).toHaveValue('collection');
  await expect(page.locator('.connection-hit')).toHaveCount(32);
  await expect(page.locator('[data-role="collection-layer"]')).toHaveCount(2);
  let event = page.waitForEvent('download');
  await command(page, 'file', 'Save JSON');
  expect(JSON.parse(await readFile(await (await event).path(), 'utf8'))).toEqual(raw);
  event = page.waitForEvent('download');
  await command(page, 'export', 'Export SVG');
  expect(await readFile(await (await event).path(), 'utf8')).toContain('Processing elements \u00d716');
  await page.getByRole('checkbox', { name: 'Hide contents', exact: true }).uncheck();
  await ready(page);
  await expect(page.locator('.block-hit')).toHaveCount(18);
  await expect(page.locator('.connection-hit')).toHaveCount(47);
});
