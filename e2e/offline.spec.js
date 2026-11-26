// Offline build (dist-offline: studio/ and story/ opened from file://): the portable build must work with no
// server and no network, for every diagram kind. Feature behavior is covered against the web
// build by studio/flowchart/statechart/alignment specs; this suite checks what only the
// offline bundle can break: classic scripts, inline Blob workers, file:// downloads and drops,
// browser drafts, storage failures and worker recovery. The canvas must equal each converter.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, readdir, cp, rm } from 'node:fs/promises';
import { Script } from 'node:vm';
import sharp from 'sharp';
import { convertDiagram } from '../src/agent-kit/blockchart-converter.js';
import { convertFlowchart } from '../src/agent-kit/flowchart-converter.js';
import { convertStatechart } from '../src/agent-kit/statechart-converter.js';

// Copy the complete artifact to a folder with spaces and Unicode before opening.
const source = new URL('../dist-offline/', import.meta.url);
const portable = new URL('../output/editor/offline copy 測試/', import.meta.url);
const fileUrl = new URL('studio/index.html', portable).href;
const storyUrl = new URL('story/index.html', portable).href;
const example = (path) => readFile(new URL('../examples/' + path, import.meta.url), 'utf8');
const fixture = (path) => readFile(new URL('../tests/fixtures/' + path, import.meta.url), 'utf8');

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
    { timeout: 60000 },
  );
}
const doc = (page) => page.evaluate(() => window.__studio.store.document);
const kind = (page) => page.evaluate(() => window.__studio.kind);
async function parity(page, label) {
  await ready(page);
  const { kind, svg, document } = await page.evaluate(() => ({
    kind: window.__studio.kind,
    svg: window.__studio.store.layout.svg,
    document: window.__studio.store.document,
  }));
  expect(svg, label).toBe(await CONVERT[kind](structuredClone(document)));
}
async function openText(page, name, text, mimeType = 'application/json') {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType, buffer: Buffer.from(text) });
  await expect(page.locator('.toast', { hasText: 'Opened ' + name })).toBeVisible();
  await ready(page);
}
async function download(page, command) {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate((c) => window.__studio.run(c), command),
  ]);
  return { name: file.suggestedFilename(), path: await file.path() };
}
async function drop(page, name, text, type) {
  const transfer = await page.evaluateHandle(
    ([name, text, type]) => {
      const t = new DataTransfer();
      t.items.add(new File([text], name, { type }));
      return t;
    },
    [name, text, type],
  );
  try {
    await page.locator('.studio').dispatchEvent('dragover', { dataTransfer: transfer });
    await page.locator('.studio').dispatchEvent('drop', { dataTransfer: transfer });
  } finally {
    await transfer.dispose();
  }
}

const failures = new WeakMap();
test.beforeAll(async () => {
  await rm(portable, { recursive: true, force: true });
  await cp(source, portable, { recursive: true });
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
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await ready(page);
});

test.afterEach(async ({ page }) => {
  expect(failures.get(page)).toEqual([]);
});

test('portable folder opens as classic scripts with inline Blob workers and no server', async ({ page }) => {
  // One folder per page plus a chooser that links both.
  expect((await readdir(source)).sort()).toEqual(['index.html', 'story', 'studio']);
  for (const page of ['studio', 'story'])
    expect((await readdir(new URL(page + '/', source))).sort()).toEqual([
      'app.js',
      'index.html',
      'style.css',
    ]);
  const chooser = await readFile(new URL('index.html', source), 'utf8');
  expect(chooser).toContain('href="./studio/index.html"');
  expect(chooser).toContain('href="./story/index.html"');
  const html = await readFile(new URL('studio/index.html', source), 'utf8');
  expect(html).toContain('src="./app.js"');
  expect(html).toContain('href="./style.css"');
  expect(html).not.toMatch(/type="module"|modulepreload|crossorigin/);
  // A classic-script parser rejects any remaining top-level import or import.meta.
  new Script(await readFile(new URL('studio/app.js', source), 'utf8'));
  expect(page.url()).toBe(fileUrl);
  expect(page.workers().length).toBeGreaterThan(0);
  expect(page.workers().every((worker) => worker.url().startsWith('blob:'))).toBe(true);
  expect(await page.locator('.studio').count()).toBe(1);
  expect(await kind(page)).toBe('blockchart');
  await parity(page, 'starter');
  await page.screenshot({ path: 'output/editor/offline-startup.png' });
});

test('every bundled example of every kind equals its converter offline', async ({ page }) => {
  test.setTimeout(300000);
  const examples = await page.evaluate(() =>
    window.__studio.allExamples().map((ex) => ({ kind: ex.kind, name: ex.name })),
  );
  for (const k of ['blockchart', 'flowchart', 'statechart'])
    expect(
      examples.some((ex) => ex.kind === k),
      k,
    ).toBe(true);
  for (const ex of examples) {
    await page.evaluate(
      ({ kind, name }) =>
        window.__studio.loadExample(
          window.__studio.allExamples().find((e) => e.kind === kind && e.name === name),
        ),
      ex,
    );
    await page.waitForFunction((k) => window.__studio.kind === k, ex.kind);
    await parity(page, `${ex.kind}: ${ex.name}`);
  }
  // Every session ran on an inline worker; no worker file was fetched.
  expect(page.workers().every((worker) => worker.url().startsWith('blob:'))).toBe(true);
});

test('Block diagram: edit, Undo/Redo, JSON/SVG/PNG downloads and draft restoration', async ({ page }) => {
  test.setTimeout(120000);
  const text = await example('blockchart/feedback-priority.json');
  await openText(page, 'feedback-priority.json', text);
  const source = JSON.parse(text);
  const id = source.modules[0].id;
  await page.evaluate((x) => window.__studio.select({ type: 'block', id: x }), id);
  const label = page.locator('[data-fid="b-label"]');
  await label.fill('Offline label');
  await label.press('Control+Enter');
  await ready(page);
  expect((await doc(page)).modules[0].label).toBe('Offline label');
  await parity(page, 'edited');
  await page.evaluate(() => window.__studio.undo());
  await ready(page);
  expect(await doc(page)).toEqual(source);
  await page.evaluate(() => window.__studio.redo());
  await ready(page);
  const json = await download(page, 'save');
  expect(json.name).toMatch(/\.json$/);
  const saved = JSON.parse(await readFile(json.path, 'utf8'));
  expect(saved).toEqual(await doc(page));
  const svg = await download(page, 'export-svg');
  expect(await readFile(svg.path, 'utf8')).toBe((await CONVERT.blockchart(structuredClone(saved))) + '\n');
  const png = await download(page, 'export-png');
  const meta = await sharp(await readFile(png.path)).metadata();
  expect(meta.format).toBe('png');
  expect(meta.width).toBeGreaterThan(0);
  await page.reload();
  await ready(page);
  await expect(page.locator('.toast', { hasText: 'Restored your last diagram' })).toBeVisible();
  expect(await doc(page)).toEqual(saved);
  await page.screenshot({ path: 'output/editor/offline-editor.png' });
});

test('Flowchart and Statechart open by file and drop, switch kinds and keep separate drafts', async ({
  page,
}) => {
  test.setTimeout(150000);
  // Flowchart JSON dropped onto the window.
  const order = await example('flowchart/order-approval.json');
  await drop(page, 'order-approval.json', order, 'application/json');
  await page.waitForFunction(() => window.__studio.kind === 'flowchart');
  await expect(page.locator('.toast', { hasText: 'Opened order-approval.json' })).toBeVisible();
  expect(await doc(page)).toEqual(JSON.parse(order));
  await parity(page, 'flowchart dropped');
  const before = (await doc(page)).nodes.length;
  const from = (await doc(page)).nodes.find((n) => !n.type || n.type === 'process').id;
  await page.evaluate((x) => window.__studio.select({ type: 'node', id: x }), from);
  await page.evaluate(() => window.__studio.run('add-next'));
  await ready(page);
  await page.keyboard.press('Escape'); // leave the inline rename the new step opens
  expect((await doc(page)).nodes).toHaveLength(before + 1);
  await parity(page, 'flowchart next step');
  const flowDraft = await doc(page);
  // Statechart Mermaid opened with the file input.
  await openText(page, 'timer-fsm.mmd', await fixture('statechart/timer-fsm.mmd'), 'text/plain');
  expect(await kind(page)).toBe('statechart');
  await expect(page.locator('.toast', { hasText: 'Imported from Mermaid' })).toBeVisible();
  await parity(page, 'statechart mermaid');
  await page.evaluate(() => window.__studio.select(null));
  await page.getByRole('tab', { name: 'Layout' }).click();
  const width = page.locator('[data-fid="sl-lw"]');
  await width.fill('90');
  await width.press('Enter');
  await ready(page);
  expect((await doc(page)).layout.labelMaxWidth).toBe(90);
  await parity(page, 'statechart label width');
  const svg = await download(page, 'export-svg');
  expect(await readFile(svg.path, 'utf8')).toBe(await page.evaluate(() => window.__studio.store.layout.svg));
  const stateDraft = await doc(page);
  // Reload restores the last kind; each kind keeps its own draft.
  await page.reload();
  await ready(page);
  expect(await kind(page)).toBe('statechart');
  expect(await doc(page)).toEqual(stateDraft);
  await page.evaluate(() => window.__studio.switchTo('flowchart'));
  await ready(page);
  expect(await doc(page)).toEqual(flowDraft);
  await parity(page, 'flowchart restored');
  expect(await page.locator('.studio').count()).toBe(1);
  expect(page.workers().every((worker) => worker.url().startsWith('blob:'))).toBe(true);
});

test('a refused file keeps the current diagram and reports the runtime path', async ({ page }) => {
  const before = await doc(page);
  await page.locator('input[type=file]').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, diagram: { name: 'x' }, states: [], nodes: [] })),
  });
  await expect(page.locator('.toast.error', { hasText: 'Could not open broken.json' })).toContainText(
    'a diagram is one kind',
  );
  await page.locator('input[type=file]').setInputFiles({
    name: 'not-json.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ nope'),
  });
  await expect(page.locator('.toast.error', { hasText: 'Could not open not-json.json' })).toBeVisible();
  expect(await kind(page)).toBe('blockchart');
  expect(await doc(page)).toEqual(before);
});

test('edits survive when browser storage is unavailable; Save JSON still works; narrow layout is accessible', async ({
  page,
}) => {
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Blocked', 'SecurityError');
    };
  });
  await page.evaluate(() => window.__studio.select(null));
  const name = page.locator('[data-fid="d-name"]');
  await name.fill('Offline storage unavailable');
  await name.press('Enter');
  await ready(page);
  await expect(page.locator('.save-state')).toHaveClass(/error/);
  const json = await download(page, 'save');
  expect(JSON.parse(await readFile(json.path, 'utf8')).diagram.name).toBe('Offline storage unavailable');
  // Phone width: every top-bar control stays on screen and the page never scrolls sideways
  // (closed drawers wait off-canvas inside the clipped body).
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  const offscreen = await page.evaluate(() =>
    [...document.querySelectorAll('.topbar > *')]
      .filter((e) => e.getBoundingClientRect().width > 0)
      .filter((e) => e.getBoundingClientRect().left < 0 || e.getBoundingClientRect().right > innerWidth)
      .map((e) => e.getAttribute('aria-label') ?? e.className),
  );
  expect(offscreen).toEqual([]);
  expect(await page.evaluate(() => (scrollTo(500, 0), scrollX))).toBe(0);
  await page.getByRole('button', { name: 'Toggle inspector' }).click();
  // After the slide-in, the drawer lies inside the window.
  await expect
    .poll(async () => {
      const box = await page.locator('.pane.inspector').boundingBox();
      return box.x >= 0 && box.x + box.width <= 390;
    })
    .toBe(true);
  await page.getByRole('button', { name: 'Toggle inspector' }).click();
  await expect(page.locator('.pane.inspector')).toBeHidden();
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByRole('menu', { name: 'Export' })).toBeVisible();
  await page.keyboard.press('Escape');
  const { violations } = await new AxeBuilder({ page })
    .options({ preload: false })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  await page.screenshot({ path: 'output/editor/offline-mobile.png' });
});

test('a crashed Blob worker reports the failure; the next edit recovers and the latest result wins', async ({
  page,
}) => {
  test.setTimeout(90000);
  const worker = page.workers()[0];
  // The crash is expected; it must not count as an unexpected page error.
  await worker.evaluate(() =>
    setTimeout(() => {
      throw new Error('Offline worker test failure');
    }, 0),
  );
  await expect(page.locator('.st.error')).toContainText('Layout failed');
  failures.set(page, []);
  const id = (await doc(page)).modules[0].id;
  await page.evaluate((x) => window.__studio.select({ type: 'block', id: x }), id);
  const label = page.locator('[data-fid="b-label"]');
  for (const value of ['Offline first', 'Offline second', 'Offline final']) {
    await label.fill(value);
    await label.press('Control+Enter');
  }
  await ready(page);
  await expect(page.locator('.st.ok')).toBeVisible();
  await parity(page, 'recovered');
  const svg = await download(page, 'export-svg');
  expect(await readFile(svg.path, 'utf8')).toContain('Offline final');
  expect(page.workers().every((w) => w.url().startsWith('blob:'))).toBe(true);
});

test.describe('Story editor offline', () => {
  const STORY_DIAGRAM = 'story/signal-path.json';
  const STORY_FILE = 'story/signal-path.story.json';
  const laidOut = (page) =>
    page.waitForFunction(() => window.__story?.layout && !window.__story.layoutPending, null, {
      timeout: 60000,
    });
  const watch = (page) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    return errors;
  };

  test('opens from file:// with a Blob worker, draws the runtime SVG, exports and reopens its page', async ({
    context,
  }) => {
    const page = await context.newPage();
    const errors = watch(page);
    await page.goto(storyUrl);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    expect(page.url()).toBe(storyUrl);
    await expect(page.locator('.story-start')).toBeVisible();
    const html = await readFile(new URL('story/index.html', source), 'utf8');
    expect(html).toContain('src="./app.js"');
    expect(html).not.toMatch(/type="module"|modulepreload|crossorigin/);
    new Script(await readFile(new URL('story/app.js', source), 'utf8'));

    const diagram = JSON.parse(await fixture(STORY_DIAGRAM));
    await page.locator('input[type=file]').setInputFiles({
      name: 'signal-path.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(diagram)),
    });
    await laidOut(page);
    expect(page.workers().length).toBeGreaterThan(0);
    expect(page.workers().every((worker) => worker.url().startsWith('blob:'))).toBe(true);
    expect(await page.evaluate(() => window.__story.layout.svg)).toBe(
      await CONVERT.blockchart(structuredClone(diagram)),
    );
    await page.locator('input[type=file]').setInputFiles({
      name: 'signal-path.story.json',
      mimeType: 'application/json',
      buffer: Buffer.from(await fixture(STORY_FILE)),
    });
    await expect(page.locator('.story-step')).toHaveCount(5);
    await expect(page.locator('.story-step.warn')).toHaveCount(0);

    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export HTML' }).click(),
    ]);
    const exported = await readFile(await file.path(), 'utf8');
    expect(exported).toContain('id="blockflow-sources"');
    await page.reload();
    await laidOut(page);
    await expect(page.locator('.story-step')).toHaveCount(5);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator('input[type=file]').setInputFiles({
      name: 'p.html',
      mimeType: 'text/html',
      buffer: Buffer.from(exported),
    });
    await laidOut(page);
    expect(await page.evaluate(() => JSON.stringify(window.__story.diagram))).toBe(JSON.stringify(diagram));
    await expect(page.locator('.story-step')).toHaveCount(5);
    await page.screenshot({ path: 'output/editor/offline-story.png' });
    expect(errors).toEqual([]);
  });

  test('the offline Studio hands the whole diagram to the offline Story editor next to it', async ({
    page,
    context,
  }) => {
    const diagram = await fixture(STORY_DIAGRAM);
    await openText(page, 'signal-path.json', diagram);
    await page.getByRole('button', { name: 'Export' }).click();
    const [story] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('menuitem', { name: 'Open in Story editor' }).click(),
    ]);
    const errors = watch(story);
    await laidOut(story);
    expect(story.url()).toBe(storyUrl);
    expect(await story.evaluate(() => JSON.stringify(window.__story.diagram))).toBe(
      JSON.stringify(JSON.parse(diagram)),
    );
    // And back: File › Open the Studio opens the sibling folder.
    await story.getByRole('button', { name: 'File' }).click();
    const [studio] = await Promise.all([
      context.waitForEvent('page'),
      story.getByRole('menuitem', { name: 'Open the Studio' }).click(),
    ]);
    await studio.waitForLoadState();
    expect(studio.url()).toBe(fileUrl);
    expect(errors).toEqual([]);
  });
});
