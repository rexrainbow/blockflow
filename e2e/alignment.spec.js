// Text alignment (docs/text-alignment.md) in the style editors of all three diagram kinds.
// Alignment changes only the SVG text anchors; the canvas must still equal each converter.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { convertDiagram } from '../src/agent-kit/blockchart-converter.js';
import { convertFlowchart } from '../src/agent-kit/flowchart-converter.js';
import { convertStatechart } from '../src/agent-kit/statechart-converter.js';

const read = async (name) =>
  readFile(new URL(`../examples/text-alignment/${name}.json`, import.meta.url), 'utf8');
const CONVERT = {
  blockchart: async (d) => (await convertDiagram(d, { format: 'svg' })).text.trimEnd(),
  flowchart: async (d) => (await convertFlowchart(d, { format: 'svg' })).text,
  statechart: async (d) => (await convertStatechart(d, { format: 'svg' })).text,
};

async function ready(page) {
  await page.waitForTimeout(250);
  await page.waitForFunction(
    () => window.__studio?.store.layout && !window.__studio.store.layoutPending,
    null,
    { timeout: 30000 },
  );
}
const doc = (page) => page.evaluate(() => window.__studio.store.document);
async function parity(page, label) {
  await ready(page);
  const { kind, svg, document } = await page.evaluate(() => ({
    kind: window.__studio.kind,
    svg: window.__studio.store.layout.svg,
    document: window.__studio.store.document,
  }));
  expect(svg, label).toBe(await CONVERT[kind](structuredClone(document)));
}
async function open(page, name, kind) {
  await page.locator('input[type=file]').setInputFiles({
    name: name + '.json',
    mimeType: 'application/json',
    buffer: Buffer.from(await read(name)),
  });
  await page.waitForFunction((k) => window.__studio.kind === k, kind);
  await parity(page, name + ' opened');
}
/** Picks an alignment in a style select; '' inherits (removes the field). */
async function align(page, fid, value) {
  const control = page.locator(`select[data-fid="${fid}"]`);
  // Style sections without values on this item start collapsed: open the section first.
  if (!(await control.isVisible())) await control.locator('xpath=ancestor::details[1]/summary').click();
  await control.selectOption(value);
  await ready(page);
}
/** Anchors of the <text> elements whose content includes `text`. */
const anchors = (page, text) =>
  page.evaluate(
    (t) =>
      [...document.querySelectorAll('.art:not(.leaving) svg text')]
        .filter((el) => el.textContent.includes(t))
        .map((el) => el.getAttribute('text-anchor')),
    text,
  );

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await ready(page);
});

test('Blockchart: label, port and default text alignment; removing inherits; Undo, Save/reload', async ({
  page,
}) => {
  test.setTimeout(90000);
  await open(page, 'blockchart', 'blockchart');
  const source = await doc(page);
  const geometry = await page.evaluate(() =>
    JSON.stringify(window.__studio.store.layout.layout.modules.map((m) => [m.x, m.y, m.width, m.height])),
  );
  await page.evaluate(() => window.__studio.select({ type: 'block', id: 'Source' }));
  await page.getByRole('tab', { name: 'Style' }).click();
  for (const value of ['left', 'center', 'right']) {
    await align(page, 'ms-label-textAlign', value);
    expect((await doc(page)).modules[0].style.label.textAlign).toBe(value);
    await parity(page, 'block label ' + value);
  }
  expect(await anchors(page, 'Core A')).toEqual(['end']);
  // Alignment never moves geometry.
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.__studio.store.layout.layout.modules.map((m) => [m.x, m.y, m.width, m.height])),
    ),
  ).toBe(geometry);
  await align(page, 'ms-label-textAlign', '');
  expect((await doc(page)).modules[0].style).toBeUndefined();
  await expect(page.locator('select[data-fid="ms-label-textAlign"] option').first()).toHaveText(/^Inherit/);
  await align(page, 'ms-portLabel-textAlign', 'right');
  expect((await doc(page)).modules[0].style.portLabel.textAlign).toBe('right');
  await parity(page, 'port labels');
  // Diagram default for all text.
  await page.evaluate(() => window.__studio.select(null));
  await page.getByRole('tab', { name: 'Defaults' }).click();
  await page.locator('[data-fid="dcat-text"]').click();
  await align(page, 'ds-text-text-textAlign', 'right');
  expect((await doc(page)).diagram.style.text.textAlign).toBe('right');
  await parity(page, 'all text right');
  // Six edits since opening: three alignments, the removal, port labels, all text.
  for (let i = 0; i < 6; i++) await page.evaluate(() => window.__studio.undo());
  await ready(page);
  expect(await doc(page)).toEqual(source);
  for (let i = 0; i < 6; i++) await page.evaluate(() => window.__studio.redo());
  await page.reload();
  await ready(page);
  expect((await doc(page)).modules[0].style.portLabel.textAlign).toBe('right');
  await parity(page, 'reloaded');
});

test('Flowchart: node, note, edge and group alignment with defaults', async ({ page }) => {
  test.setTimeout(90000);
  await open(page, 'flowchart', 'flowchart');
  await page.evaluate(() => window.__studio.select({ type: 'node', id: 'Start' }));
  await page.getByRole('tab', { name: 'Style' }).click();
  await align(page, 'ns-text-textAlign', 'right');
  expect((await doc(page)).nodes[0].style.textAlign).toBe('right');
  expect(await anchors(page, 'step 1')).toEqual(['end']);
  await parity(page, 'node right');
  await align(page, 'ns-text-textAlign', '');
  expect((await doc(page)).nodes[0].style).toBeUndefined();
  // The inherited value is the diagram's step default (left).
  await expect(page.locator('select[data-fid="ns-text-textAlign"] option').first()).toHaveText(
    'Inherit (Left)',
  );
  await page.evaluate(() => window.__studio.select({ type: 'edge', key: 'edge_1' }));
  await page.getByRole('tab', { name: 'Style' }).click();
  await align(page, 'es-label-textAlign', 'center');
  expect((await doc(page)).edges[0].style.textAlign).toBe('center');
  await page.evaluate(() => window.__studio.select({ type: 'group', id: 'Steps' }));
  await page.getByRole('tab', { name: 'Style' }).click();
  await align(page, 'gs-text-textAlign', 'left');
  await parity(page, 'edge and group');
  await page.evaluate(() => window.__studio.select(null));
  await page.getByRole('tab', { name: 'Defaults' }).click();
  await page.locator('[data-fid="fd-cat-note"]').click();
  await align(page, 'fd-note-text-textAlign', 'center');
  expect((await doc(page)).diagram.style.note.textAlign).toBe('center');
  await parity(page, 'note default');
});

test('Statechart: centered name with a left or right description; transitions; defaults', async ({
  page,
}) => {
  test.setTimeout(90000);
  await open(page, 'statechart', 'statechart');
  const id = (await doc(page)).states.find((s) => s.description && (s.kind ?? 'state') === 'state').id;
  await page.evaluate((x) => window.__studio.select({ type: 'node', id: x }), id);
  await page.getByRole('tab', { name: 'Style' }).click();
  await align(page, 'ss-text-textAlign', 'center');
  await align(page, 'ss-text-descriptionAlign', 'right');
  expect((await doc(page)).states.find((s) => s.id === id).style).toMatchObject({
    textAlign: 'center',
    descriptionAlign: 'right',
  });
  await parity(page, 'state center/right');
  // Removing the description alignment follows the line alignment (no explicit value).
  await align(page, 'ss-text-descriptionAlign', '');
  expect((await doc(page)).states.find((s) => s.id === id).style.descriptionAlign).toBeUndefined();
  await parity(page, 'description inherits');
  const key = await page.evaluate(() => {
    const d = window.__studio.store.document;
    return (
      d.transitions.find((t) => t.label)?.id ?? 'transition_' + (d.transitions.findIndex((t) => t.label) + 1)
    );
  });
  await page.evaluate((k) => window.__studio.select({ type: 'edge', key: k }), key);
  await page.getByRole('tab', { name: 'Style' }).click();
  await align(page, 'ts-label-textAlign', 'left');
  await expect(page.locator('select[data-fid="ts-label-descriptionAlign"]')).toHaveCount(0);
  await parity(page, 'transition left');
  await page.evaluate(() => window.__studio.select(null));
  await page.getByRole('tab', { name: 'Defaults' }).click();
  await align(page, 'fd-state-text-descriptionAlign', 'left');
  expect((await doc(page)).diagram.style.state.descriptionAlign).toBe('left');
  await parity(page, 'state default');
  const saved = await doc(page);
  await page.reload();
  await ready(page);
  expect(await doc(page)).toEqual(saved);
});
