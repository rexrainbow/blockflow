// End-to-end checks for the Story editor (story.html, src/story).
// The diagram is input only: the player must show exactly the Block runtime's SVG.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { convertDiagram } from '../src/agent-kit/blockchart-converter.js';

// The Story editor's own test diagram and story (tests/fixtures/story): terminals at both
// ends, a group and a start Net that fans out over a shared trunk.
const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`../tests/fixtures/story/${name}`, import.meta.url), 'utf8'));
const DIAGRAM = await fixture('signal-path.json');
const STORY = await fixture('signal-path.story.json');
const json = (name, value) => ({
  name,
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(value)),
});

async function laidOut(page) {
  await page.waitForFunction(() => window.__story?.layout && !window.__story.layoutPending, null, {
    timeout: 30000,
  });
}
async function openDiagram(page, doc, name = 'diagram.json') {
  await page.locator('input[type=file]').setInputFiles(json(name, doc));
  await laidOut(page);
}
const blur = (page) => page.evaluate(() => document.activeElement?.blur());

test.beforeEach(async ({ page }) => {
  await page.goto('/story.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('start screen, then a Block diagram drawn exactly as the runtime draws it', async ({ page }) => {
  await expect(page.locator('.story-start')).toBeVisible();
  await expect(page.locator('.story-stage')).toBeHidden();
  await expect(page.locator('.workspace > .outline')).toBeHidden();

  // Other diagram kinds belong to the Studio.
  await page
    .locator('input[type=file]')
    .setInputFiles(json('flow.json', { version: 1, nodes: [{ id: 'a', label: 'A' }], edges: [] }));
  await expect(page.locator('.toast.error')).toContainText('Flowcharts and statecharts open in the Studio');

  const doc = structuredClone(DIAGRAM);
  await openDiagram(page, doc);
  await expect(page.locator('.story-start')).toBeHidden();
  await expect(page.locator('.story-stage .pv-svg')).toBeVisible();
  await expect(page.locator('.workspace > .outline')).toBeVisible();
  await expect(page.locator('.workspace > .inspector')).toBeVisible();
  const reference = await convertDiagram(doc, { format: 'svg' });
  expect(await page.evaluate(() => window.__story.layout.svg)).toBe(reference.text.trimEnd());
  expect(await page.locator('.story-stage .pv-svg [data-role="connection-layer"]').count()).toBe(1);
  await expect(page.locator('.story-source')).toHaveText(doc.diagram.name);
});

test('authoring: picks, notes, story Undo/Redo, reload, story JSON with its diagram, export and reopening the export', async ({
  page,
  context,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const doc = structuredClone(DIAGRAM);
  await openDiagram(page, doc);

  // Wires: a click adds to the selected hop, Shift+click starts a new hop.
  const refs = await page.locator('.pv-wire-hit').evaluateAll((els) => els.map((e) => e.dataset.wire));
  expect(refs.length).toBeGreaterThan(1);
  await page.locator(`.pv-wire-hit[data-wire="${refs[0]}"]`).dispatchEvent('click');
  await page.locator(`.pv-wire-hit[data-wire="${refs[1]}"]`).dispatchEvent('click', { shiftKey: true });
  await expect(page.locator('.story-hop')).toHaveCount(2);
  await expect(page.locator('.story-hop.selected .story-wires li')).toHaveText([refs[1]]);

  // Blocks: a real click adds a note and focuses its text.
  await page.locator('.pv-module-hit').first().click();
  await expect(page.locator('[data-fid="story-note-0"]')).toBeFocused();
  await page.keyboard.type('Hello');
  await page.keyboard.press('Enter');
  await page.locator('[data-fid="story-step-title"]').fill('Start');
  await page.locator('[data-fid="story-step-title"]').press('Enter');
  await expect(page.locator('.story-step.selected .row-label')).toHaveText('Start');
  await expect(page.locator('.pv-chip text', { hasText: 'Hello' })).toHaveCount(1);

  // Undo/Redo keys and buttons apply to the story.
  await blur(page);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.story-step.selected .row-label')).toHaveText('New step');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.story-step.selected .row-label')).toHaveText('Start');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.story-step.selected .row-label')).toHaveText('New step');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('.story-step.selected .row-label')).toHaveText('Start');

  // Reload: the diagram and its story come back from this browser.
  await page.reload();
  await laidOut(page);
  await expect(page.locator('.story-step.selected .row-label')).toHaveText('Start');
  await expect(page.locator('.story-hop')).toHaveCount(2);

  // Story JSON names the diagram it was made for.
  await blur(page);
  const [saved] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const story = JSON.parse(await readFile(await saved.path(), 'utf8'));
  expect(saved.suggestedFilename()).toMatch(/\.story\.json$/);
  expect(story.format).toBe('blockflow-story');
  expect(story.diagram.name).toBe(doc.diagram.name);
  expect(story.diagram.sha256).toMatch(/^[0-9a-f]{16}$/);

  // Export: one offline HTML page with the same player, steps and both sources.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export HTML' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/-presentation\.html$/);
  const html = await readFile(await download.path(), 'utf8');
  expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
  expect(html).toContain('id="blockflow-sources"');
  const shown = await context.newPage();
  const exportErrors = [];
  shown.on('pageerror', (e) => exportErrors.push(e.message));
  await shown.setContent(html);
  await expect(shown.locator('.pp-caption h2')).toHaveText('Start');
  await expect(shown.locator('.pv-svg [data-role="connection-layer"]')).toHaveCount(1);
  await expect(shown.locator('.pv-chip text', { hasText: 'Hello' })).toHaveCount(1);
  expect(await shown.locator('.pv-wire-hit').count()).toBe(0);
  expect(exportErrors).toEqual([]);
  await shown.close();

  // The exported page opens here again with its diagram and story, even in a fresh browser.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.story-start')).toBeVisible();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'p.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  await laidOut(page);
  expect(await page.evaluate(() => JSON.stringify(window.__story.diagram))).toBe(JSON.stringify(doc));
  expect(await page.evaluate(() => JSON.stringify(window.__story.story.chapters))).toBe(
    JSON.stringify(story.chapters),
  );
  await expect(page.locator('.story-step.selected .row-label')).toHaveText('Start');
  expect(errors).toEqual([]);
});

test('a story for another diagram keeps its references and marks the missing ones', async ({ page }) => {
  await openDiagram(page, structuredClone(DIAGRAM));
  const foreign = {
    format: 'blockflow-story',
    title: 'Other',
    diagram: { name: 'Another diagram' },
    chapters: [
      {
        title: 'C',
        steps: [
          {
            title: 'S',
            hops: [{ kind: 'data', wires: ['Gone.out -> Nowhere.in'] }],
            notes: [{ module: 'Missing', text: 'x' }],
          },
        ],
      },
    ],
  };
  await page.locator('input[type=file]').setInputFiles(json('other.story.json', foreign));
  await expect(page.locator('.toast.error')).toContainText('made for “Another diagram”');
  await expect(page.locator('.story-step.warn')).toHaveCount(1);
  await expect(page.locator('.statusbar')).toContainText('2 missing references');
  await expect(page.locator('.story-wires li.missing')).toHaveText(['Gone.out -> Nowhere.in']);
  // Undo returns to the previous story.
  await blur(page);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.story-step.warn')).toHaveCount(0);
});

test('the test story plays over the test diagram: terminals, a shared fan-out and an overview', async ({
  page,
}) => {
  await openDiagram(page, structuredClone(DIAGRAM));
  // Every wire is pickable, including the later owner of the shared start trunk and both terminals.
  const refs = await page.locator('.pv-wire-hit').evaluateAll((els) => els.map((e) => e.dataset.wire));
  expect(refs.sort()).toEqual(
    [
      '@terminal:Clock -> Timer.clk',
      'Controller.start -> FIFO.start',
      'Controller.start -> Serializer.start',
      'FIFO.q -> Serializer.q',
      'Serializer.line -> @terminal:Pad',
      'Source.data -> FIFO.data',
      'Timer.tick -> Controller.tick',
    ].sort(),
  );
  await page.locator('input[type=file]').setInputFiles(json('signal-path.story.json', STORY));
  await expect(page.locator('.story-step')).toHaveCount(5);
  await expect(page.locator('.story-step.warn')).toHaveCount(0);
  await expect(page.locator('.statusbar')).toContainText('2 chapters · 5 steps');
  await expect(page.locator('.statusbar')).not.toContainText('missing');

  // The fan-out step draws both branches, shared trunk included, with their arrows.
  await page.locator('.story-step', { hasText: 'Start both stages' }).click();
  const fan = await page.evaluate(() => {
    const stage = window.__story.player.stage;
    const trunk = stage
      .querySelector('svg.pv-svg [data-role="connection-path"][data-endpoints]')
      .getAttribute('d');
    return {
      cores: stage.querySelectorAll('.pv-core').length,
      arrows: stage.querySelectorAll('.pv-arrow[opacity="1"]').length,
      trunkCovered: [...stage.querySelectorAll('.pv-core')].some((p) => p.getAttribute('d').includes(trunk)),
    };
  });
  expect(fan).toEqual({ cores: 3, arrows: 3, trunkCovered: true });
  await expect(page.locator('.pv-chip text', { hasText: 'Starts a bit' })).toHaveCount(1);
  await expect(page.locator('.pv-wave-row.pv-on .pv-wave-name')).toHaveText(['tick']);

  // The overview shows every wire of its chapter; a terminal takes a note like a block.
  await page.locator('.story-step', { hasText: 'Overview' }).click();
  expect(await page.locator('.story-stage .pv-core').count()).toBe(7);
  await page.locator('.story-step', { hasText: 'Line to pad' }).click();
  await expect(page.locator('.pv-chip text', { hasText: 'Output pin' })).toHaveCount(1);
});
