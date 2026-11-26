// Presentation story: plain data, no DOM. A story names wires by their endpoints
// ("Module.port -> Module.port", terminals as "@terminal:ID"), never by layout ids, so it
// survives connection reordering. The same endpoint pairs are what the runtime SVG exposes.

import { validateDiagram } from '../blockchart/model.js';
import { parseWaveform, layoutWaveform, renderWaveformSvg } from '../waveform/index.js';

export const STORY_FORMAT = 'blockflow-story';
export const STORY_KINDS = ['event', 'level', 'data', 'control'];

export const normalizeRef = (ref) =>
  String(ref)
    .replace(/\s*->\s*/, ' -> ')
    .trim();

export const newStep = (title = 'New step') => ({ title, body: '', hops: [] });
export const newHop = (kind = 'event') => ({ kind, wires: [] });
export const newChapter = (title = 'New chapter') => ({ title, steps: [newStep()] });
export const emptyStory = (title = 'Presentation') => ({
  format: STORY_FORMAT,
  version: 1,
  title,
  chapters: [newChapter('Chapter 1')],
});

export function validateStory(value) {
  parseStory(value);
  return { ok: true };
}

const fail = (path, message) => {
  throw Object.assign(new Error(`${path}: ${message}`), { path });
};
const text = (value, path, fallback = '') => {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') fail(path, 'must be text.');
  return value;
};
const list = (value, path) => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(path, 'must be a list.');
  return value;
};

/** Validates a story file (or the earlier prototype format) and returns a clean copy. */
export function parseStory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('story', 'must be an object.');
  if (value.format !== undefined && value.format !== STORY_FORMAT)
    fail('format', `must be "${STORY_FORMAT}".`);
  if (value.version !== undefined && value.version !== 1) fail('version', 'must be 1.');
  if (!Array.isArray(value.chapters)) fail('chapters', 'must be a list.');
  const story = { format: STORY_FORMAT, version: 1, title: text(value.title, 'title', 'Presentation') };
  if (value.diagram !== undefined) {
    if (!value.diagram || typeof value.diagram !== 'object' || Array.isArray(value.diagram))
      fail('diagram', 'must be an object.');
    story.diagram = { name: text(value.diagram.name, 'diagram.name') };
    if (value.diagram.sha256 !== undefined)
      story.diagram.sha256 = text(value.diagram.sha256, 'diagram.sha256');
  }
  return {
    ...story,
    chapters: value.chapters.map((ch, ci) => {
      const at = `chapters[${ci}]`;
      if (!ch || typeof ch !== 'object' || Array.isArray(ch)) fail(at, 'must be an object.');
      const chapter = { title: text(ch.title, `${at}.title`), steps: [] };
      if (ch.waveform !== undefined) {
        try {
          chapter.waveform = parseWaveform(ch.waveform);
        } catch (error) {
          const path = (error.path ?? '').replace(/^waveform(?:\.|$)/, '');
          fail(`${at}.waveform${path ? '.' + path : ''}`, error.message);
        }
      }
      chapter.steps = list(ch.steps, `${at}.steps`).map((s, si) => parseStep(s, `${at}.steps[${si}]`));
      return chapter;
    }),
  };
}

function parseStep(s, at) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) fail(at, 'must be an object.');
  const step = { title: text(s.title, `${at}.title`), body: text(s.body, `${at}.body`) };
  if (s.scope) step.scope = true;
  if (s.camera === 'all') step.camera = 'all';
  else if (s.camera !== undefined && s.camera !== 'step') fail(`${at}.camera`, 'must be "all" or "step".');
  step.hops = list(s.hops, `${at}.hops`).map((hop, hi) => {
    const hp = `${at}.hops[${hi}]`;
    if (!hop || typeof hop !== 'object' || Array.isArray(hop)) fail(hp, 'must be an object.');
    const kind = hop?.kind ?? 'event';
    if (!STORY_KINDS.includes(kind)) fail(`${hp}.kind`, `must be one of ${STORY_KINDS.join(', ')}.`);
    const out = {
      kind,
      wires: list(hop.wires, `${hp}.wires`).map((w, wi) => normalizeRef(text(w, `${hp}.wires[${wi}]`))),
    };
    if (hop.badge) out.badge = text(hop.badge, `${hp}.badge`);
    return out;
  });
  const notes = list(s.notes, `${at}.notes`).map((n, ni) => ({
    module: text(n?.module, `${at}.notes[${ni}].module`),
    text: text(n?.text, `${at}.notes[${ni}].text`),
  }));
  if (notes.length) step.notes = notes;
  if (s.waveform !== undefined) {
    const w = s.waveform,
      wp = `${at}.waveform`;
    if (!w || typeof w !== 'object' || Array.isArray(w)) fail(wp, 'must be an object.');
    step.waveform = {};
    for (const k of ['from', 'to']) {
      if (w[k] !== undefined) {
        if (!Number.isSafeInteger(w[k])) fail(`${wp}.${k}`, 'must be a safe integer tick.');
        step.waveform[k] = w[k];
      }
    }
    for (const k of ['signals', 'links', 'markers']) {
      if (w[k] !== undefined)
        step.waveform[k] = list(w[k], `${wp}.${k}`).map((ref, i) => {
          const value = text(ref, `${wp}.${k}[${i}]`);
          return k === 'links' ? normalizeRef(value) : value;
        });
    }
  }
  return step;
}

/** A chapter timing strip: { period, bits: [0|1], rows: [{ name, perBit } | { name, tick, showBit }] }. */
export function parseWave(w, at = 'wave') {
  if (!w || typeof w !== 'object' || Array.isArray(w)) fail(at, 'must be an object.');
  if (!(Number(w.period) > 0) || !Number.isFinite(Number(w.period)))
    fail(`${at}.period`, 'must be a positive finite number.');
  const bits = list(w.bits, `${at}.bits`);
  if (!bits.length) fail(`${at}.bits`, 'needs at least one bit.');
  bits.forEach((bit, i) => {
    if (bit !== 0 && bit !== 1) fail(`${at}.bits[${i}]`, 'must be 0 or 1.');
  });
  const rows = list(w.rows, `${at}.rows`).map((r, ri) => {
    if (!r || typeof text(r.name, `${at}.rows[${ri}].name`) !== 'string' || !r.name)
      fail(`${at}.rows[${ri}].name`, 'is required.');
    if (r.tick === undefined && (typeof r.perBit !== 'object' || !r.perBit))
      fail(`${at}.rows[${ri}]`, 'needs perBit or tick.');
    if (r.tick !== undefined && !Number.isFinite(r.tick)) fail(`${at}.rows[${ri}].tick`, 'must be finite.');
    if (r.showBit !== undefined && typeof r.showBit !== 'boolean')
      fail(`${at}.rows[${ri}].showBit`, 'must be a boolean.');
    if (r.perBit !== undefined) {
      if (!r.perBit || typeof r.perBit !== 'object' || Array.isArray(r.perBit))
        fail(`${at}.rows[${ri}].perBit`, 'must be an object.');
      for (const [bit, ranges] of Object.entries(r.perBit)) {
        const path = `${at}.rows[${ri}].perBit.${bit}`;
        if (!Array.isArray(ranges)) fail(path, 'must be a list of intervals.');
        ranges.forEach((range, i) => {
          if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite))
            fail(`${path}[${i}]`, 'must be a pair of finite numbers.');
        });
      }
    }
    return structuredClone(r);
  });
  return { ...structuredClone(w), period: Number(w.period), bits: structuredClone(bits), rows };
}

/** Flat step list in presentation order. */
export const flatSteps = (story) =>
  story.chapters.flatMap((chapter, ci) => chapter.steps.map((step, si) => ({ ci, si, step })));

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (v) =>
  v.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi, (m, e) =>
    e[0] === '#'
      ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      : XML_ENTITIES[e.toLowerCase()],
  );
const attrsOf = (tag) =>
  Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, unescapeXml(v)]));

/** Endpoint pairs a rendered path or arrow belongs to (rendered SVG identity contract). */
export function ownersOf(attrs) {
  if (attrs['data-endpoints']) {
    try {
      const list = JSON.parse(attrs['data-endpoints']);
      if (Array.isArray(list)) return list.filter((e) => e?.from && e?.to);
    } catch {
      /* fall through to the singular attributes */
    }
  }
  return attrs['data-from'] && attrs['data-to'] ? [{ from: attrs['data-from'], to: attrs['data-to'] }] : [];
}
export const endpointRef = ({ from, to }) => `${from} -> ${to}`;

/**
 * Wires and blocks the runtime SVG identifies, read from its data-* metadata without a DOM:
 * { wires: { "A.out -> B.in": { from, to } }, modules: { id: { label } } }.
 */
export function svgIndex(svg) {
  const wires = Object.create(null),
    modules = Object.create(null);
  for (const [tag] of String(svg ?? '').matchAll(
    /<(?:path|polygon)\b[^>]*\bdata-role="connection-path"[^>]*>/g,
  ))
    for (const owner of ownersOf(attrsOf(tag)))
      wires[endpointRef(owner)] ??= { from: owner.from, to: owner.to };
  for (const [tag] of String(svg ?? '').matchAll(
    /<(?:rect|g)\b[^>]*\bdata-role="(?:block|block-body)"[^>]*>/g,
  )) {
    const id = attrsOf(tag)['data-module'];
    if (id) modules[id] ??= { label: id };
  }
  for (const [, tag, body] of String(svg ?? '').matchAll(
    /(<text\b[^>]*\bdata-role="block-label"[^>]*>)([\s\S]*?)<\/text>/g,
  )) {
    const id = attrsOf(tag)['data-module'];
    const lines = [...body.matchAll(/<tspan\b[^>]*>([\s\S]*?)<\/tspan>/g)].map(([, t]) => t);
    const label = unescapeXml((lines.length ? lines.join('\n') : body).replace(/<[^>]*>/g, ''));
    if (modules[id] && label) modules[id].label = label;
  }
  for (const [tag] of String(svg ?? '').matchAll(/<g\b[^>]*\bdata-role="terminal"[^>]*>/g)) {
    const id = attrsOf(tag)['data-terminal'];
    if (id) modules[`@terminal:${id}`] ??= { label: id };
  }
  return { wires, modules };
}

export function viewOf(svg) {
  const m = /viewBox="([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([-\d.e]+)"/.exec(svg ?? '');
  return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
}

/** References in the story that the rendered diagram does not identify (index from svgIndex). */
export function storyProblems(story, geo) {
  const problems = [];
  story.chapters.forEach((chapter, ci) => {
    const waveform = chapter.waveform;
    const signals = new Set(waveform?.signals.map((s) => s.id));
    const links = new Set(waveform?.links?.map(endpointRef));
    const markers = new Set(waveform?.markers?.map((m) => m.id));
    chapter.steps.forEach((step, si) => {
      for (const hop of step.hops ?? [])
        for (const ref of hop.wires)
          if (!Object.hasOwn(geo.wires, ref)) problems.push({ ci, si, type: 'wire', ref });
      for (const n of step.notes ?? [])
        if (!Object.hasOwn(geo.modules, n.module)) problems.push({ ci, si, type: 'module', ref: n.module });
      const focus = step.waveform;
      if (!focus) return;
      if (!waveform) {
        problems.push({ ci, si, type: 'waveform', ref: 'waveform' });
        return;
      }
      const from = focus.from ?? 0,
        to = focus.to ?? waveform.length;
      if (from < 0 || from >= to || to > waveform.length)
        problems.push({ ci, si, type: 'window', ref: `${from} -> ${to}` });
      for (const [key, type, ids] of [
        ['signals', 'signal', signals],
        ['links', 'link', links],
        ['markers', 'marker', markers],
      ])
        for (const ref of focus[key] ?? []) if (!ids.has(ref)) problems.push({ ci, si, type, ref });
    });
  });
  return problems;
}

/** All rendered branches touching an exact port, including every fan-out destination.
 * An absent or unconnected port yields an empty list, without a missing-port problem. */
export function wiresForPort(index, port) {
  return Object.values(index.wires)
    .filter((wire) => wire.from === port || wire.to === port)
    .map(({ from, to }) => ({ from, to }));
}

/** Stable authoring identities available to step focus and Agent Kit inspection. */
export function waveformIndex(value) {
  const waveform = parseWaveform(value);
  return {
    signals: waveform.signals.map(({ id, label, port }) => ({ id, label, ...(port ? { port } : {}) })),
    edges: waveform.signals.flatMap((signal) =>
      signal.changes.flatMap(([t, , id], i) => (id && i > 0 ? [{ id, signal: signal.id, t }] : [])),
    ),
    links: (waveform.links ?? []).map((link) => ({ ref: endpointRef(link), ...link })),
    markers: structuredClone(waveform.markers ?? []),
  };
}

/** Offline player data: owned Story, pre-rendered chapter waveforms and cursor geometry. */
export function presentationData({ svg, story }) {
  story = parseStory(story);
  const index = svgIndex(svg);
  const chapters = story.chapters.map((chapter, ci) => {
    if (!chapter.waveform) return chapter;
    const options = { idPrefix: `blockflow-story-waveform-${ci}` };
    const l = layoutWaveform(chapter.waveform, options);
    return {
      ...chapter,
      waveformView: {
        svg: renderWaveformSvg(chapter.waveform, options),
        left: l.left,
        pixelsPerTick: l.pixelsPerTick,
        from: l.from,
        to: l.to,
        right: l.right,
        width: l.width,
        height: l.height,
        top: l.top,
        lanes: Object.fromEntries(l.lanes.map((lane) => [lane.id, lane.y])),
        portWires: Object.fromEntries(
          chapter.waveform.signals
            .filter((signal) => signal.port)
            .map((signal) => [signal.id, wiresForPort(index, signal.port)]),
        ),
      },
    };
  });
  return { title: story.title, svg, view: viewOf(svg), chapters, problems: storyProblems(story, index) };
}

/** Id of the script element in an exported presentation that holds its editable sources. */
export const SOURCES_ID = 'blockflow-sources';

/** True when the value is a story file rather than a diagram. */
export const isStoryFile = (value) =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (value.format === STORY_FORMAT || (Array.isArray(value.chapters) && !Array.isArray(value.modules)));

/**
 * The Block diagram and story an exported presentation was made from. The exporter writes them
 * as JSON in `<script type="application/json" id="blockflow-sources">`, with `<` escaped, so
 * the element ends at the first closing script tag.
 */
export function readPresentationSources(html) {
  html = String(html ?? '');
  const open = new RegExp(`<script\\b[^>]*\\bid="${SOURCES_ID}"[^>]*>`, 'i').exec(String(html ?? ''));
  if (!open)
    fail(
      'presentation',
      'has no editable sources. Only presentations exported by the Story editor can be reopened.',
    );
  const start = open.index + open[0].length;
  const end = html.toLowerCase().indexOf('</script', start);
  let value;
  try {
    value = JSON.parse(html.slice(start, end < 0 ? undefined : end));
  } catch (error) {
    fail('presentation', `sources are not valid JSON (${error.message}).`);
  }
  if (!value?.diagram || typeof value.diagram !== 'object' || !Array.isArray(value.diagram.modules))
    fail('presentation.diagram', 'must be a Block diagram.');
  try {
    validateDiagram(value.diagram);
  } catch (error) {
    fail('presentation.diagram' + (error.path ? '.' + error.path : ''), error.message);
  }
  return { diagram: value.diagram, story: parseStory(value.story) };
}

/** Short fingerprint of a diagram document, saved in a story to notice a different diagram. */
export async function diagramFingerprint(diagram) {
  const bytes = new TextEncoder().encode(JSON.stringify(diagram));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
