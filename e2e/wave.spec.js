// End-to-end checks for the Waveform editor (wave.html, src/wave).
// Format, edits, drawing and VCD import are the runtime's (src/lib/waveform): the page must
// show the runtime SVG and turn pointer input into its operations.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { renderWaveformSvg, parseWaveform } from '../src/lib/waveform/index.js';

const fixture = async (name) =>
  readFile(new URL(`../tests/fixtures/waveform/${name}`, import.meta.url), 'utf8');
const DSHOT = JSON.parse(await fixture('dshot.json'));

/** Page coordinates of tick `t` on lane `lane` (offset `dy` from the lane centre). */
const at = (page, lane, t, dy = 0) =>
  page.evaluate(
    ([lane, t, dy]) => {
      const w = window.__wave,
        r = w.canvas.getBoundingClientRect(),
        l = w.geo.lanes.find((x) => x.id === lane);
      return { x: r.left + w.x(t), y: r.top + l.y + dy };
    },
    [lane, t, dy],
  );
const changes = (page, id) =>
  page.evaluate((id) => window.__wave.doc.signals.find((s) => s.id === id).changes, id);
const doc = (page) => page.evaluate(() => window.__wave.doc);
async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, to.y, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}
async function openExample(page) {
  await page.getByRole('button', { name: 'DShot example' }).click();
  await expect(page.locator('.wv-sheet svg')).toBeVisible();
  await page.evaluate(() => {
    window.__wave.zoom = 30;
    window.__wave.render();
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/wave.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('start screen, then the runtime drawing of the DShot example; diagrams are refused', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.locator('.story-start')).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({
    name: 'diagram.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, modules: [] })),
  });
  await expect(page.locator('.toast.error')).toContainText('Diagrams open in the Studio');
  await openExample(page);
  expect(await doc(page)).toEqual(parseWaveform(DSHOT));
  const { svg, options } = await page.evaluate(() => ({
    svg: window.__wave.sheet.innerHTML,
    options: window.__wave.viewOptions(),
  }));
  // The browser serializes the same markup the renderer wrote.
  const reference = await page.evaluate(
    (text) => {
      const box = document.createElement('div');
      box.innerHTML = text;
      return box.innerHTML;
    },
    renderWaveformSvg(DSHOT, options),
  );
  expect(svg).toBe(reference);
  await expect(page.locator('.wv-list .row')).toHaveCount(1 + DSHOT.signals.length + 2 + 2);
  await expect(page.locator('.statusbar')).toContainText('No problems');
  expect(errors).toEqual([]);
});

test('pointer edits: locked drag, refused drag, range values, double-click, links, Undo and reload', async ({
  page,
}) => {
  await openExample(page);
  // Dragging hi_start 3 → 2 moves sample_edge 5 → 4 through the locked link.
  await drag(page, await at(page, 'hi', 3), await at(page, 'hi', 2));
  expect(await changes(page, 'hi')).toEqual([
    [0, 0],
    [2, 1, 'hi_start'],
    [7, 0, 'hi_done'],
  ]);
  expect((await changes(page, 'sample')).slice(0, 2)).toEqual([
    [0, 0],
    [4, 1, 'sample_edge'],
  ]);
  await expect(page.locator('.statusbar')).toContainText('1 problem'); // trigger_start → hi_start delay
  // Dragging it to 4 would push sample_edge onto its own fall: refused, nothing changes.
  const before = JSON.stringify(await doc(page));
  await drag(page, await at(page, 'hi', 2), await at(page, 'hi', 4));
  await expect(page.locator('.toast.error').first()).toBeVisible();
  expect(JSON.stringify(await doc(page))).toBe(before);
  await page.keyboard.press('Control+z');
  expect((await changes(page, 'hi'))[1]).toEqual([3, 1, 'hi_start']);

  // A drag along a lane selects ticks; X sets them.
  await drag(page, await at(page, 'tx', 12.1, 10), await at(page, 'tx', 16, 10));
  expect(await page.evaluate(() => window.__wave.sel)).toEqual({
    type: 'range',
    signalId: 'tx',
    from: 12,
    to: 16,
  });
  await page.keyboard.press('x');
  expect(await changes(page, 'tx')).toContainEqual([12, 'x']);

  // Double-click flips a bit segment; a named transition in the way refuses.
  const c = await at(page, 'clock', 12, 10);
  await page.mouse.dblclick(c.x, c.y);
  expect(await changes(page, 'clock')).toEqual([
    [0, 0],
    [1, 1, 'clock_start'],
    [2, 0],
    [8, 1],
    [17, 0],
  ]);
  const n = await at(page, 'trigger', 10, 10);
  await page.mouse.dblclick(n.x, n.y);
  await expect(page.locator('.toast.error').first()).toContainText('trigger_done');

  // Link two unnamed transitions: both are named and the link is locked at their distance.
  const c8 = await at(page, 'clock', 8);
  await page.mouse.click(c8.x, c8.y);
  await page.getByRole('button', { name: 'Link to…' }).click();
  const t8 = await at(page, 'tx', 8);
  await page.mouse.click(t8.x, t8.y);
  expect((await doc(page)).links.at(-1)).toEqual({ from: 'clock_8', to: 'tx_8', delay: 0, locked: true });
  // Its drawing selects it; Delete removes it.
  const box = await page.evaluate(() => {
    const g = [...window.__wave.sheet.querySelectorAll('[data-link]')].find(
      (x) => x.dataset.fromEdge === 'clock_8',
    );
    const b = g.querySelector('path').getBoundingClientRect();
    return { x: b.right - 1, y: b.top + b.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  expect(await page.evaluate(() => window.__wave.sel.type)).toBe('link');
  await page.keyboard.press('Delete');
  expect((await doc(page)).links).toHaveLength(2);

  // Reload keeps the waveform; Undo history starts over.
  const kept = JSON.stringify(await doc(page));
  await page.reload();
  await expect(page.locator('.wv-sheet svg')).toBeVisible();
  expect(JSON.stringify(await doc(page))).toBe(kept);
});

test('inspector edits: bus value, generated bits, markers, signals; SVG export equals the renderer', async ({
  page,
}) => {
  await openExample(page);
  const p = await at(page, 'bus', 4);
  await page.mouse.click(p.x, p.y);
  await page.locator('[data-fid="r-value"]').fill('0xF');
  await page.locator('[data-fid="r-value"]').press('Enter');
  expect((await changes(page, 'bus'))[0]).toEqual([0, '0xF']);

  await page.locator('.wv-list .row', { hasText: 'TX 1 / 0 / 1' }).click();
  await page.locator('[data-fid="enc-bits"]').fill('010');
  await page.getByRole('button', { name: 'Generate' }).click();
  expect(await changes(page, 'tx')).toEqual([
    [0, 1],
    [3, 0],
    [8, 1],
    [14, 0],
    [16, 1],
    [19, 0],
  ]);

  await drag(page, await at(page, 'tx', 0.1, 12), await at(page, 'tx', 8, 12));
  await page.getByRole('button', { name: 'Span marker' }).click();
  expect((await doc(page)).markers.at(-1)).toMatchObject({ from: 0, to: 8 });

  await page.getByRole('button', { name: 'Add signal' }).click();
  await page.getByRole('menuitem', { name: 'Bus (8 bits)' }).click();
  await page.locator('[data-fid="s-id"]').fill('addr');
  await page.locator('[data-fid="s-id"]').press('Enter');
  expect((await doc(page)).signals.at(-1)).toMatchObject({ id: 'addr', width: 8 });
  // A lane id the runtime refuses shows its message in the field.
  await page.locator('[data-fid="s-id"]').fill('9bad');
  await page.locator('[data-fid="s-id"]').press('Enter');
  await expect(page.locator('.toast.error').first()).toBeVisible();

  // Without a bit grid the snap switch leaves the canvas head and nothing prints in its place.
  await page.locator('.wv-list .row', { hasText: 'Waveform settings' }).click();
  await page.getByText('Show a bit grid').click();
  await expect(page.locator('[data-fid="snap-tick"]')).toHaveCount(0);
  await expect(page.locator('.canvas-tools')).not.toContainText('null');
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-fid="snap-tick"]')).toHaveCount(1);

  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.__wave.exportSvg()),
  ]);
  const svg = await readFile(await file.path(), 'utf8');
  const { current, options } = await page.evaluate(() => ({
    current: window.__wave.doc,
    options: window.__wave.exportOptions(),
  }));
  expect(svg).toBe(renderWaveformSvg(current, options) + '\n');
  const [json] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  expect(JSON.parse(await readFile(await json.path(), 'utf8'))).toEqual(current);
});

test('VCD import: a checklist from the runtime, the capture window by default, errors in the dialog', async ({
  page,
}) => {
  const vcd = await fixture('small.vcd');
  // Unreadable VCDs are reported before any dialog.
  await page.locator('input[type=file]').setInputFiles({
    name: 'broken.vcd',
    mimeType: 'text/plain',
    buffer: Buffer.from('$timescale 1ns $end\n$var wire 1 ! clk $end\n$enddefinitions $end\n#5\n1?\n'),
  });
  await expect(page.locator('.toast.error')).toContainText('Could not read broken.vcd');

  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'small.vcd', mimeType: 'text/plain', buffer: Buffer.from(vcd) });
  const dialog = page.locator('.modal');
  await expect(dialog).toContainText('3 signals · timescale 1ns · ticks 0–16');
  const rows = dialog.locator('.wv-vcd-row');
  await expect(rows).toHaveText([
    /top\.clk.*1 bit · wire/,
    /top\.data\[3:0\].*4 bits · reg/,
    /top\.ready.*1 bit · wire/,
  ]);
  await expect(rows.locator('input')).toHaveCount(3);
  await expect(dialog.locator('.wv-vcd-list')).not.toContainText('null');
  for (const box of await rows.locator('input').all()) await expect(box).toBeChecked();
  await expect(page.locator('[data-fid="vcd-from"]')).toHaveValue('0');
  await expect(page.locator('[data-fid="vcd-to"]')).toHaveValue('16');

  // Filter, None and an empty choice.
  await page.locator('[data-fid="vcd-filter"]').fill('data');
  await expect(rows).toHaveCount(1);
  await dialog.getByRole('button', { name: 'None' }).click();
  await page.locator('[data-fid="vcd-filter"]').fill('');
  await expect(dialog.locator('.count')).toHaveText('2 of 3');
  await dialog.getByRole('button', { name: 'All' }).click();
  await expect(dialog.locator('.count')).toHaveText('3 of 3');
  await rows.filter({ hasText: 'top.ready' }).locator('input').uncheck();
  // A window the runtime refuses keeps the dialog open with its message.
  await page.locator('[data-fid="vcd-timescale"]').fill('1us');
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(dialog.locator('.field-error')).toBeVisible();
  await page.locator('[data-fid="vcd-timescale"]').fill('');
  await page.locator('[data-fid="vcd-from"]').fill('2');
  await page.locator('[data-fid="vcd-to"]').fill('10');
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(page.locator('.wv-sheet svg')).toBeVisible();
  const imported = await doc(page);
  expect(imported.title).toBe('small');
  expect(imported.length).toBe(8);
  expect(imported.signals).toHaveLength(2);
  expect(imported.signals[0].changes[0]).toEqual([0, 1]); // held value at the window start
  // The first document of the page has nothing to undo to.
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('marker labels at the same and nearby ticks stack without overlapping and stay selectable', async ({
  page,
}) => {
  await openExample(page);
  // DShot has a span "packet" at 0 and a cursor "bit 1" at 8; add a span and a cursor at 0 and 1.
  await page.evaluate(() =>
    window.__wave.apply([
      {
        op: 'setMarkers',
        markers: [
          ...window.__wave.doc.markers,
          { id: 'head', from: 0, to: 4, label: 'header' },
          { id: 'near', t: 1, label: 'near the start' },
        ],
      },
    ]),
  );
  const labels = await page.evaluate(() =>
    [...window.__wave.sheet.querySelectorAll('[data-role="marker-label"]')].map((t) => {
      const b = t.getBoundingClientRect();
      return { id: t.closest('[data-marker]').dataset.marker, x: b.x, y: b.y, r: b.right, bottom: b.bottom };
    }),
  );
  expect(labels.map((l) => l.id).sort()).toEqual(['cursor', 'head', 'near', 'packet']);
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i],
        b = labels[j];
      const overlap = a.x < b.r && b.x < a.r && a.y < b.bottom && b.y < a.bottom;
      expect(overlap, `${a.id} and ${b.id}`).toBe(false);
    }
  // The canvas grows with the label rows, so every label is inside it and clickable.
  const canvas = await page.locator('.wv-canvas').boundingBox();
  for (const l of labels) {
    expect(l.bottom).toBeLessThanOrEqual(canvas.y + canvas.height + 0.5);
    await page.mouse.click(l.x + 2, (l.y + l.bottom) / 2);
    expect(await page.evaluate(() => window.__wave.sel), l.id).toEqual({ type: 'marker', id: l.id });
  }
  // SVG download equals the renderer with the stacked rows.
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.__wave.exportSvg()),
  ]);
  const { current, options } = await page.evaluate(() => ({
    current: window.__wave.doc,
    options: window.__wave.exportOptions(),
  }));
  expect(await readFile(await file.path(), 'utf8')).toBe(renderWaveformSvg(current, options) + '\n');
});

test('links: local drawing by default, every part selects its link, linked transitions still drag, route option', async ({
  page,
}) => {
  await openExample(page);
  const routes = () =>
    page.evaluate(() => [...window.__wave.sheet.querySelectorAll('[data-link]')].map((g) => g.dataset.route));
  expect(await routes()).toEqual(['local', 'local']);
  // A real click on the label, the delay dimension or the path selects "start HI"; its arrow
  // sits on hi_start, so a click there selects that transition (the one to drag).
  const parts = await page.evaluate(() => {
    const g = window.__wave.sheet.querySelector('[data-link]');
    const centre = (el) => {
      const b = el.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    };
    const path = g.querySelector('[data-role="link-path"]');
    const p = path.getPointAtLength(path.getTotalLength() * 0.5);
    const m = path.getScreenCTM();
    return {
      arrow: centre(g.querySelector('[data-role="link-arrow"]')),
      label: centre(g.querySelector('[data-role="link-label"]')),
      dimension: centre(g.querySelector('[data-role="delay-dimension"]')),
      path: { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f },
    };
  });
  for (const [part, at] of Object.entries(parts)) {
    await page.keyboard.press('Escape');
    await page.mouse.click(at.x, at.y);
    expect(await page.evaluate(() => window.__wave.sel), part).toEqual(
      part === 'arrow' ? { type: 'edge', signalId: 'hi', t: 3, id: 'hi_start' } : { type: 'link', index: 0 },
    );
  }
  // trigger_start starts a link path, yet its transition still drags (and the link follows its rule).
  await page.keyboard.press('Escape');
  const from = await at(page, 'hi', 7);
  const to = await at(page, 'hi', 6);
  await drag(page, from, to);
  expect(await changes(page, 'hi')).toContainEqual([6, 0, 'hi_done']);
  // The route option is a view preference: never written into the waveform, kept after reload.
  await page.locator('[data-fid="link-route-rail"]').click();
  expect(await routes()).toEqual(['rail', 'rail']);
  await page.reload();
  await expect(page.locator('.wv-sheet svg')).toBeVisible();
  expect(await routes()).toEqual(['rail', 'rail']);
  expect(JSON.stringify(await doc(page))).not.toContain('linkRoute');
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.__wave.exportSvg()),
  ]);
  const { current, options } = await page.evaluate(() => ({
    current: window.__wave.doc,
    options: window.__wave.exportOptions(),
  }));
  expect(options.linkRoute).toBe('rail');
  expect(await readFile(await file.path(), 'utf8')).toBe(renderWaveformSvg(current, options) + '\n');
  await page.locator('[data-fid="link-route-auto"]').click();
});
