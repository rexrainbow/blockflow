// Presentation player core: shared by Studio's Story mode and the exported presentation HTML.
// It has no imports on purpose: the exporter inlines this file's text into a standalone page.
// It never lays out or renders the diagram. It takes the runtime's SVG unchanged, finds wires and
// blocks through the SVG identity metadata (data-role, data-module, data-from/data-to and
// data-endpoints; docs/blockchart-layout.md#rendered-svg-identity-contract) and adds a dimming
// mask, highlights, chips and a camera on top.

const PV_NS = 'http://www.w3.org/2000/svg';
const PV_KINDS = ['event', 'level', 'data', 'control'];
const PV_KIND_LABEL = { event: 'Trigger', level: 'Waveform', data: 'Data', control: 'Stop' };
let pvCount = 0;

/**
 * Builds the stage, timing strip and playback controls inside `root`.
 * options: { data, edit, onStep(index), onPick({ type: 'wire'|'module', id, shift }) }
 */
export function createPlayer(root, options = {}) {
  const uid = ++pvCount;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = (tag, attrs = {}, parent, text) => {
    const n = document.createElementNS(PV_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  };
  const html = (tag, attrs = {}, text) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };

  root.classList.add('pv-root');
  root.classList.toggle('pv-edit-mode', Boolean(options.edit));
  root.replaceChildren();
  const stage = html('div', { class: 'pv-stage' });
  const tip = html('div', { class: 'pv-tip', role: 'tooltip', hidden: '' });
  const placeholder = html('div', { class: 'pv-placeholder', hidden: '' });
  const wave = el('svg', { class: 'pv-wave', 'aria-label': 'Timing diagram' });
  const controls = html('div', { class: 'pv-controls' });
  stage.append(placeholder, tip);
  root.append(stage, wave, controls);

  const btn = (label, title, onclick, cls) => {
    const b = html('button', { type: 'button', class: cls ?? 'pv-btn', title, 'aria-label': title }, label);
    b.addEventListener('click', onclick);
    return b;
  };
  const prevBtn = btn('◀', 'Previous step (←)', () => show(cur - 1));
  const playBtn = btn('▶ Play', 'Play all steps (P)', () => setPlaying(!playing));
  playBtn.setAttribute('aria-pressed', 'false');
  const nextBtn = btn('▶', 'Next step (→)', () => show(cur + 1));
  const replayBtn = btn('↻ Replay', 'Replay this step (R)', () => show(cur));
  const progress = html('div', { class: 'pv-progress' });
  const count = html('span', { class: 'pv-count' });
  const speedSel = html('select', { class: 'pv-select', title: 'Speed', 'aria-label': 'Speed' });
  for (const v of ['0.5', '1', '2']) speedSel.append(Object.assign(html('option', { value: v }, v + '×'), { selected: v === '1' }));
  const fitBtn = btn('Whole', 'Always show the whole diagram (A)', () => setFitAll(!fitAll));
  fitBtn.setAttribute('aria-pressed', 'false');
  controls.append(prevBtn, playBtn, nextBtn, replayBtn, progress, count, speedSel, fitBtn);

  let data = null, steps = [], svg = null, V = null, layers = null, idx = { modules: {}, wires: {} };
  let cur = 0, playing = false, fitAll = false, raf = 0, holdTimer = 0, camAnim = 0, timeline = null;
  let cam = null, stageRect = stage.getBoundingClientRect(), scaled = [];
  const color = (kind) => getComputedStyle(root).getPropertyValue('--pv-' + (PV_KINDS.includes(kind) ? kind : 'event')).trim();
  const speed = () => Number(speedSel.value) || 1;

  // ---------- data ----------
  function setData(next, { index = cur, instant = true, keepCamera = false, hop = null } = {}) {
    clearTimeline();
    data = next;
    steps = [];
    (data?.chapters ?? []).forEach((ch, ci) => (ch.steps ?? []).forEach((s, si) => steps.push({ ...s, ci, si, hops: s.hops ?? [], notes: s.notes ?? [] })));
    svg?.remove();
    svg = null;
    if (!data?.svg) {
      placeholder.textContent = data?.message ?? 'Nothing to show yet.';
      placeholder.hidden = false;
      buildProgress();
      return;
    }
    placeholder.hidden = true;
    const holder = html('div');
    holder.innerHTML = data.svg;
    svg = holder.querySelector('svg');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.classList.add('pv-svg');
    stage.prepend(svg);
    V = data.view;
    idx = buildIndex();
    const keep = keepCamera && cam;
    if (!keep) cam = { ...V };
    buildLayers();
    setView(cam);
    buildProgress();
    if (steps.length) show(index, { instant, keepCamera: keep, hop });
    else {
      count.textContent = '0 / 0';
      drawWave(null);
    }
  }

  // ---------- SVG identity ----------
  const near = (a, b) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
  const ptsOf = (d) => {
    const n = (d.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number), out = [];
    for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i], y: n[i + 1] });
    return out;
  };
  // Bounding box in diagram coordinates, through any transforms between the node and the sheet.
  function boxIn(node) {
    const b = node.getBBox();
    let m = new DOMMatrix();
    for (let n = node; n && n !== svg; n = n.parentNode) {
      const t = n.transform?.baseVal?.consolidate?.();
      if (t) m = DOMMatrix.fromMatrix(t.matrix).multiply(m);
    }
    const c = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => m.transformPoint(new DOMPoint(x, y)));
    const xs = c.map((q) => q.x), ys = c.map((q) => q.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  // A shared path lists every owner in data-endpoints; otherwise data-from/data-to name the one owner.
  function owners(n) {
    const list = n.getAttribute('data-endpoints');
    if (list)
      try {
        const v = JSON.parse(list);
        if (Array.isArray(v)) return v.filter((e) => e && e.from && e.to);
      } catch {
        /* fall back to the singular attributes */
      }
    const from = n.getAttribute('data-from'), to = n.getAttribute('data-to');
    return from && to ? [{ from, to }] : [];
  }
  function buildIndex() {
    const modules = {}, wires = {}, pieces = {}, arrows = {};
    const ref = (o) => `${o.from} -> ${o.to}`;
    for (const n of svg.querySelectorAll('[data-role="block"][data-module], [data-role="block-body"][data-module]')) {
      const id = n.getAttribute('data-module');
      if (modules[id]) continue;
      const label = [...svg.querySelectorAll('[data-role="block-label"][data-module]')].find((t) => t.getAttribute('data-module') === id);
      const lines = label ? [...label.querySelectorAll('tspan')].map((t) => t.textContent) : [];
      modules[id] = { ...boxIn(n), label: (lines.length ? lines.join('\n') : label?.textContent) || id };
    }
    for (const n of svg.querySelectorAll('[data-role="terminal"][data-terminal]')) modules['@terminal:' + n.getAttribute('data-terminal')] ??= { ...boxIn(n), label: n.getAttribute('data-terminal') };
    const moduleOf = (end) => (modules[end] ? end : [end.slice(0, end.indexOf('.')), end.slice(0, end.lastIndexOf('.'))].find((id) => modules[id]) ?? end);
    for (const n of svg.querySelectorAll('[data-role="connection-path"]'))
      for (const o of owners(n)) {
        const d = n.getAttribute('d') ?? '', pts = ptsOf(d);
        if (pts.length > 1) (pieces[ref(o)] ??= { ...o, segs: [] }).segs.push({ d, pts });
      }
    for (const n of svg.querySelectorAll('[data-role="connection-arrow"], [data-role="connection-start-arrow"]')) for (const o of owners(n)) (arrows[ref(o)] ??= []).push(n.getAttribute('points'));
    for (const [r, { from, to, segs }] of Object.entries(pieces)) {
      // A branch draws one path per section; chain them source to target so a dot can travel the route.
      const ordered = [];
      let next = segs.find((s) => !segs.some((o) => o !== s && near(o.pts.at(-1), s.pts[0]))) ?? segs[0];
      while (next) {
        ordered.push(next);
        segs.splice(segs.indexOf(next), 1);
        const end = next.pts.at(-1);
        next = segs.find((s) => near(s.pts[0], end)) ?? segs[0];
      }
      const pts = [];
      for (const sg of ordered) for (const q of sg.pts) if (!pts.length || !near(pts.at(-1), q)) pts.push(q);
      wires[r] = { from: moduleOf(from), to: moduleOf(to), d: ordered.map((sg) => sg.d).join(' '), pts, arrows: arrows[r] ?? [] };
    }
    return { modules, wires };
  }

  function buildLayers() {
    const defs = el('defs', {}, svg);
    const mask = el('mask', { id: `pv-spot-${uid}`, maskUnits: 'userSpaceOnUse', x: V.x, y: V.y, width: V.w, height: V.h }, defs);
    el('rect', { x: V.x, y: V.y, width: V.w, height: V.h, fill: '#fff' }, mask);
    const holes = el('g', {}, mask);
    const dim = el('rect', { class: 'pv-dim', x: V.x, y: V.y, width: V.w, height: V.h, mask: `url(#pv-spot-${uid})` }, svg);
    layers = { holes, dim, trail: el('g', {}, svg), outlines: el('g', {}, svg), fx: el('g', {}, svg), chips: el('g', {}, svg), hits: el('g', {}, svg) };
    for (const [id, m] of Object.entries(idx.modules)) {
      const r = el('rect', { class: 'pv-hit pv-module-hit', x: m.x, y: m.y, width: m.w, height: m.h, 'data-module': id }, layers.hits);
      r.addEventListener('pointermove', (e) => showTip(e, `${m.label}\n— ${id}`));
      r.addEventListener('pointerleave', hideTip);
      r.addEventListener('click', (e) => options.onPick?.({ type: 'module', id, shift: e.shiftKey }));
    }
    if (options.edit)
      for (const [id, w] of Object.entries(idx.wires)) {
        const p = el('path', { class: 'pv-hit pv-wire-hit', d: w.d, 'data-wire': id }, layers.hits);
        p.addEventListener('pointermove', (e) => showTip(e, id));
        p.addEventListener('pointerleave', hideTip);
        p.addEventListener('click', (e) => options.onPick?.({ type: 'wire', id, shift: e.shiftKey }));
      }
  }

  function showTip(e, text) {
    tip.textContent = text;
    tip.hidden = false;
    const r = stage.getBoundingClientRect();
    tip.style.left = Math.min(e.clientX - r.left + 14, r.width - tip.offsetWidth - 8) + 'px';
    tip.style.top = Math.min(e.clientY - r.top + 14, r.height - tip.offsetHeight - 8) + 'px';
  }
  function hideTip() {
    tip.hidden = true;
  }

  // ---------- camera ----------
  const setView = (v) => svg?.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  const upp = (v) => Math.min(3, Math.max(0.6, Math.max(v.w / Math.max(stageRect.width, 1), v.h / Math.max(stageRect.height, 1))));
  function frame(box) {
    const aspect = stageRect.width / Math.max(stageRect.height, 1) || 1.6;
    const pad = 70;
    let w = Math.max(box.x1 - box.x0 + pad * 2, 640), h = Math.max(box.y1 - box.y0 + pad * 2, 400);
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    return { x: (box.x0 + box.x1) / 2 - w / 2, y: (box.y0 + box.y1) / 2 - h / 2, w, h };
  }
  function moveCamera(target, instant) {
    cancelAnimationFrame(camAnim);
    const from = { ...cam }, t0 = performance.now(), dur = instant || reduced ? 0 : 750;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const tick = (now) => {
      const t = dur ? Math.min(1, (now - t0) / dur) : 1, k = ease(t);
      cam = Object.fromEntries(Object.keys(target).map((key) => [key, from[key] + (target[key] - from[key]) * k]));
      setView(cam);
      rescale();
      if (t < 1) camAnim = requestAnimationFrame(tick);
    };
    if (dur) camAnim = requestAnimationFrame(tick);
    else tick(t0);
  }
  function boxOf(moduleIds, wireIds) {
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const add = (x, y) => {
      b.x0 = Math.min(b.x0, x);
      b.y0 = Math.min(b.y0, y);
      b.x1 = Math.max(b.x1, x);
      b.y1 = Math.max(b.y1, y);
    };
    for (const id of moduleIds) {
      const m = idx.modules[id];
      if (m) add(m.x, m.y - 30), add(m.x + m.w, m.y + m.h);
    }
    for (const id of wireIds) for (const p of idx.wires[id]?.pts ?? []) add(p.x, p.y);
    return b.x0 === Infinity ? { x0: V.x, y0: V.y, x1: V.x + V.w, y1: V.y + V.h } : b;
  }
  // Wheel zoom and drag pan, so an author can reach any wire while editing.
  stage.addEventListener(
    'wheel',
    (e) => {
      if (!svg || !cam) return;
      e.preventDefault();
      cancelAnimationFrame(camAnim);
      const r = stage.getBoundingClientRect();
      const k = Math.exp(e.deltaY * 0.0015);
      const s = Math.max(cam.w / r.width, cam.h / r.height);
      const px = cam.x + (cam.w - r.width * s) / 2 + (e.clientX - r.left) * s;
      const py = cam.y + (cam.h - r.height * s) / 2 + (e.clientY - r.top) * s;
      cam = { x: px - (px - cam.x) * k, y: py - (py - cam.y) * k, w: cam.w * k, h: cam.h * k };
      setView(cam);
      rescale();
    },
    { passive: false },
  );
  let pan = null;
  stage.addEventListener('pointerdown', (e) => {
    if (!svg || e.button !== 0 || e.target.closest?.('.pv-hit')) return;
    cancelAnimationFrame(camAnim);
    pan = { x: e.clientX, y: e.clientY, cam: { ...cam }, s: Math.max(cam.w / stageRect.width, cam.h / stageRect.height) };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('pv-panning');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pan) return;
    cam = { ...pan.cam, x: pan.cam.x - (e.clientX - pan.x) * pan.s, y: pan.cam.y - (e.clientY - pan.y) * pan.s };
    setView(cam);
  });
  const endPan = () => {
    pan = null;
    stage.classList.remove('pv-panning');
  };
  stage.addEventListener('pointerup', endPan);
  stage.addEventListener('pointercancel', endPan);

  // Chips and dots keep a constant on-screen size: they are rescaled on every camera frame.
  function rescale() {
    if (!cam) return;
    const k = upp(cam);
    scaled = scaled.filter((c) => c.node.isConnected);
    for (const c of scaled)
      if (c.r) c.node.setAttribute('r', c.r * k);
      else c.node.setAttribute('transform', `translate(${c.x} ${c.y + c.dy * k}) scale(${k}) translate(${-c.x} ${-c.y})`);
  }
  function chip(group, x, y, text, cls, tint, dy = 0) {
    const outer = el('g', {}, group);
    scaled.push({ node: outer, x, y, dy });
    const g = el('g', { class: cls }, outer);
    const t = el('text', { x, y }, g, text);
    if (tint) t.style.fill = tint;
    const w = Math.max(28, t.getComputedTextLength() + 16);
    const r = el('rect', { x: x - w / 2, y: y - 11, width: w, height: 22, rx: 11 });
    if (tint) r.style.stroke = tint;
    g.insertBefore(r, t);
    rescale();
    return g;
  }

  // ---------- steps ----------
  const stepWires = (s) => s.hops.flatMap((h) => h.wires).filter((w) => idx.wires[w]);
  const chapterWires = (ci) => steps.filter((s) => s.ci === ci && !s.scope).flatMap((s) => s.hops.flatMap((h) => h.wires.filter((w) => idx.wires[w]).map((w) => [w, h.kind])));
  const ends = (ids) => [...new Set(ids.flatMap((w) => [idx.wires[w].from, idx.wires[w].to]))].filter((id) => idx.modules[id]);
  const PAD = 7;
  function hole(moduleIds, wireIds, shade) {
    for (const id of moduleIds) {
      const m = idx.modules[id];
      el('rect', { x: m.x - PAD, y: m.y - PAD, width: m.w + PAD * 2, height: m.h + PAD * 2, rx: 8, fill: shade }, layers.holes);
    }
    for (const id of wireIds) el('path', { d: idx.wires[id].d, fill: 'none', stroke: shade, 'stroke-width': 26, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, layers.holes);
  }
  function clearTimeline() {
    cancelAnimationFrame(raf);
    clearTimeout(holdTimer);
    timeline = null;
    if (layers) for (const g of [layers.holes, layers.trail, layers.outlines, layers.fx, layers.chips]) g.replaceChildren();
  }

  function show(i, { instant = false, keepCamera = false, hop = null } = {}) {
    if (!svg || !steps.length) return;
    clearTimeline();
    cur = Math.max(0, Math.min(steps.length - 1, i));
    const s = steps[cur];
    updateControls();
    drawWave(s);

    const prior = steps.filter((p) => p.ci === s.ci && p.si < s.si && !p.scope);
    const priorWires = prior.flatMap((p) => p.hops.flatMap((h) => h.wires.filter((w) => idx.wires[w]).map((w) => [w, h.kind])));
    hole(ends(priorWires.map(([w]) => w)), priorWires.map(([w]) => w), '#5a5a5a');
    for (const [w, kind] of priorWires) el('path', { class: 'pv-trail', d: idx.wires[w].d, stroke: color(kind) }, layers.trail);

    let activeWires, activeModules;
    if (s.scope) {
      const all = chapterWires(s.ci);
      activeWires = all.map(([w]) => w);
      activeModules = ends(activeWires);
      hole(activeModules, activeWires, '#000');
      for (const [w, kind] of all) el('path', { class: 'pv-core', d: idx.wires[w].d, stroke: color(kind), 'stroke-width': 3, opacity: 0.85 }, layers.fx);
    } else {
      activeWires = stepWires(s);
      activeModules = [...new Set([...ends(activeWires), ...s.notes.map((n) => n.module).filter((id) => idx.modules[id])])];
      hole(activeModules, activeWires, '#000');
    }
    layers.dim.classList.toggle('pv-off', (s.camera === 'all' && !s.scope) || (!activeWires.length && !activeModules.length));

    const outlineOf = {};
    for (const id of activeModules) {
      const m = idx.modules[id];
      outlineOf[id] = el('rect', { class: 'pv-outline', x: m.x - 3, y: m.y - 3, width: m.w + 6, height: m.h + 6, rx: 6, 'stroke-opacity': s.scope ? 0 : 0.55 }, layers.outlines);
    }
    const target = fitAll || s.camera === 'all' || !activeWires.length && !activeModules.length ? { ...V } : frame(boxOf(activeModules, activeWires));
    for (const n of s.notes) {
      const m = idx.modules[n.module];
      if (m && n.text) chip(layers.chips, m.x + m.w / 2, m.y, n.text, 'pv-chip', null, -22).style.animationDelay = instant || reduced ? '0s' : '.25s';
    }
    const still = instant || reduced;
    if (!keepCamera && (still || !s.hops.length)) moveCamera(target, instant);
    buildTimeline(s, outlineOf, still, keepCamera ? null : target, hop);
    options.onStep?.(cur);
  }

  // Each hop starts when the previous one arrives; wires inside a hop travel together. When a
  // step spans far-apart blocks, the camera follows each hop, then pulls back to the whole step.
  function buildTimeline(s, outlineOf, still, stepView, editHop) {
    const items = [], cams = [];
    let t = 0, view = null;
    s.hops.forEach((hop, hi) => {
      const wires = hop.wires.filter((w) => idx.wires[w]);
      if (!wires.length) return;
      let hv = stepView;
      if (stepView && !fitAll && s.camera !== 'all' && s.hops.length > 1) {
        const f = frame(boxOf(ends(wires), wires));
        if (f.w < stepView.w * 0.7) hv = f;
      }
      if (!still && hv && hv !== view) {
        cams.push({ at: t, view: hv });
        t += 700;
      }
      view = hv;
      let hopDur = 0;
      for (const w of wires) {
        const tint = color(hop.kind);
        const d = idx.wires[w].d;
        const arrows = idx.wires[w].arrows.map((points) => el('polygon', { class: 'pv-arrow', points, fill: tint, opacity: 0 }, layers.fx));
        const glow = el('path', { class: 'pv-glow', d, stroke: tint }, layers.fx);
        const core = el('path', { class: 'pv-core', d, stroke: tint, 'stroke-width': 3.4 }, layers.fx);
        if (editHop != null) core.classList.toggle('pv-dimmed', editHop !== hi), glow.classList.toggle('pv-edit', editHop === hi);
        const L = core.getTotalLength();
        const dur = Math.min(1500, Math.max(500, L * 1.4));
        hopDur = Math.max(hopDur, dur);
        for (const p of [glow, core]) {
          p.style.strokeDasharray = `${L} ${L}`;
          p.style.strokeDashoffset = L;
        }
        const dot = el('circle', { class: 'pv-dot', r: 6, stroke: tint, opacity: 0 }, layers.fx);
        scaled.push({ node: dot, r: 6 });
        items.push({ w, hop, tint, glow, core, dot, arrows, L, start: t, dur, arrived: false });
      }
      t += hopDur + 180;
    });
    if (!still && stepView && view && view !== stepView) {
      cams.push({ at: t + 400, view: stepView });
      t += 1100;
    }
    timeline = { items, cams, end: t + 300, t0: performance.now(), outlineOf };
    rescale();
    if (still) {
      for (const it of items) finish(it, true);
      tickWave(1);
      return afterTimeline();
    }
    raf = requestAnimationFrame(tick);
  }
  function finish(it, quiet) {
    it.arrived = true;
    it.glow.style.strokeDashoffset = it.core.style.strokeDashoffset = 0;
    it.dot.setAttribute('opacity', 0);
    for (const a of it.arrows) a.setAttribute('opacity', 1);
    const wire = idx.wires[it.w];
    const end = wire.pts.at(-1);
    if (it.hop.kind === 'level' || it.hop.kind === 'data') {
      it.core.style.strokeDasharray = '10 8';
      it.core.classList.add('pv-flow');
    }
    for (const id of [wire.from, wire.to]) {
      const out = timeline.outlineOf[id];
      if (!out) continue;
      out.style.stroke = it.tint;
      out.setAttribute('stroke-opacity', 1);
      if (!quiet && id === wire.to) {
        out.classList.remove('pv-pulse');
        void out.getBBox();
        out.classList.add('pv-pulse');
      }
    }
    if (!quiet && it.hop.kind !== 'level' && it.hop.kind !== 'data') {
      scaled.push({ node: el('circle', { class: 'pv-burst', cx: end.x, cy: end.y, r: 5, stroke: it.tint }, layers.fx), r: 5 });
      rescale();
    }
    if (it.hop.badge) {
      const at = it.core.getPointAtLength(Math.max(0, it.L - 36 * upp(cam)));
      const g = chip(layers.fx, at.x, at.y, it.hop.badge, 'pv-chip pv-badge', it.tint, -15);
      if (quiet) g.style.animationDuration = '0s';
    }
  }
  function tick(now) {
    const tl = timeline;
    if (!tl) return;
    const t = (now - tl.t0) * speed();
    for (const c of tl.cams)
      if (!c.done && t >= c.at) {
        c.done = true;
        moveCamera(c.view);
      }
    for (const it of tl.items) {
      if (it.arrived || t < it.start) continue;
      const p = Math.min(1, (t - it.start) / it.dur);
      it.glow.style.strokeDashoffset = it.core.style.strokeDashoffset = it.L * (1 - p);
      const pt = it.core.getPointAtLength(it.L * p);
      it.dot.setAttribute('cx', pt.x);
      it.dot.setAttribute('cy', pt.y);
      it.dot.setAttribute('opacity', 1);
      const src = tl.outlineOf[idx.wires[it.w].from];
      if (src && p > 0) {
        src.style.stroke = it.tint;
        src.setAttribute('stroke-opacity', 1);
      }
      if (p >= 1) finish(it);
    }
    tickWave(Math.min(1, t / tl.end));
    if (t < tl.end) raf = requestAnimationFrame(tick);
    else afterTimeline();
  }
  function afterTimeline() {
    if (playing) holdTimer = setTimeout(() => (cur < steps.length - 1 ? show(cur + 1) : setPlaying(false)), 2600 / speed());
  }

  // ---------- controls ----------
  let dots = [];
  function buildProgress() {
    progress.replaceChildren();
    dots = steps.map((s, i) => {
      if (i && s.ci !== steps[i - 1].ci) progress.append(html('span', { class: 'pv-gap' }));
      const title = `${data.chapters[s.ci].title ?? ''} · ${s.title ?? ''}`;
      const d = btn('', title, () => show(i), 'pv-dot-btn');
      progress.append(d);
      return d;
    });
    for (const b of [prevBtn, nextBtn, playBtn, replayBtn]) b.disabled = !steps.length || !svg;
  }
  function updateControls() {
    count.textContent = `${cur + 1} / ${steps.length}`;
    dots.forEach((b, i) => {
      b.setAttribute('aria-current', String(i === cur));
      b.classList.toggle('pv-done', i < cur);
    });
    prevBtn.disabled = cur <= 0;
    nextBtn.disabled = cur >= steps.length - 1;
  }
  function setPlaying(on) {
    playing = on;
    playBtn.setAttribute('aria-pressed', String(on));
    playBtn.textContent = on ? '❚❚ Pause' : '▶ Play';
    if (on) show(cur >= steps.length - 1 ? 0 : cur + 1);
    else clearTimeout(holdTimer);
  }
  function setFitAll(on) {
    fitAll = on;
    fitBtn.setAttribute('aria-pressed', String(on));
    show(cur);
  }
  /** Handles a keydown; returns true when the key belonged to the player. */
  function key(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return false;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') show(cur + 1);
    else if (k === 'ArrowLeft' || k === 'PageUp') show(cur - 1);
    else if (k === 'Home') show(0);
    else if (k === 'End') show(steps.length - 1);
    else if (k === 'r' || k === 'R') show(cur);
    else if (k === 'p' || k === 'P') setPlaying(!playing);
    else if (k === 'a' || k === 'A') setFitAll(!fitAll);
    else return false;
    return true;
  }

  // ---------- timing strip ----------
  let waveHead = null, waveSpan = null;
  function drawWave(s) {
    const W = s ? data.chapters[s.ci]?.wave : null;
    wave.replaceChildren();
    waveHead = null;
    if (!W?.rows?.length || !W.bits?.length || !(W.period > 0)) return wave.setAttribute('hidden', '');
    wave.removeAttribute('hidden');
    const width = wave.clientWidth || root.clientWidth || 800, LAB = 112, RIGHT = 16, ROW = 24, TOP = 22;
    const total = W.period * W.bits.length;
    const x = (t) => LAB + (Math.max(0, Math.min(total, t)) / total) * (width - LAB - RIGHT);
    const height = TOP + W.rows.length * ROW + 8;
    wave.setAttribute('height', height);
    wave.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const focus = s.wave?.rows?.length ? s.wave.rows : null;
    const span = s.wave && Number.isFinite(s.wave.from) && Number.isFinite(s.wave.to) ? s.wave : null;
    if (span) el('rect', { class: 'pv-wave-band', x: x(span.from), y: 4, width: Math.max(2, x(span.to) - x(span.from)), height: height - 8 }, wave);
    W.bits.forEach((b, i) => {
      el('line', { class: 'pv-wave-grid', x1: x(i * W.period), x2: x(i * W.period), y1: 4, y2: height - 4 }, wave);
      el('text', { class: 'pv-wave-bit', x: x((i + 0.5) * W.period), y: 13 }, wave, `bit ${b}`);
    });
    W.rows.forEach((row, r) => {
      const y0 = TOP + r * ROW, hi = y0 + 4, lo = y0 + ROW - 6;
      const on = !focus || focus.includes(row.name);
      const g = el('g', { class: on && focus ? 'pv-wave-row pv-on' : on ? 'pv-wave-row' : 'pv-wave-row pv-off' }, wave);
      el('text', { class: 'pv-wave-name', x: 12, y: (hi + lo) / 2 }, g, row.name);
      if (row.tick != null) {
        W.bits.forEach((b, i) => {
          const tx = x(i * W.period + row.tick);
          el('line', { class: 'pv-wave-tick', x1: tx, x2: tx, y1: hi - 2, y2: lo + 2 }, g);
          if (row.showBit) el('text', { class: 'pv-wave-tick-text', x: tx + 6, y: (hi + lo) / 2 }, g, `→ ${b}`);
        });
        return;
      }
      let d = `M${x(0)} ${lo}`;
      W.bits.forEach((b, i) => {
        for (const [a, z] of row.perBit?.[String(b)] ?? row.perBit?.['*'] ?? []) {
          const xa = x(i * W.period + a), xz = Math.max(x(i * W.period + z), xa + 2.5);
          d += ` L${xa} ${lo} L${xa} ${hi} L${xz} ${hi} L${xz} ${lo}`;
        }
      });
      el('path', { class: 'pv-wave-line', d: d + ` L${x(total)} ${lo}` }, g);
    });
    if (span) {
      waveSpan = [x(span.from), x(span.to)];
      waveHead = el('line', { class: 'pv-wave-head', x1: waveSpan[0], x2: waveSpan[0], y1: 4, y2: height - 4 }, wave);
    }
  }
  function tickWave(p) {
    if (!waveHead) return;
    const xh = waveSpan[0] + (waveSpan[1] - waveSpan[0]) * p;
    waveHead.setAttribute('x1', xh);
    waveHead.setAttribute('x2', xh);
  }

  const resizer = new ResizeObserver(() => {
    const before = stageRect;
    stageRect = stage.getBoundingClientRect();
    if (!svg || !steps.length || (before.width === stageRect.width && before.height === stageRect.height && wave.clientWidth)) return;
    drawWave(steps[cur]);
    rescale();
  });
  resizer.observe(root);

  setData(options.data ?? null, { index: options.index ?? 0 });
  return {
    get index() {
      return cur;
    },
    get steps() {
      return steps;
    },
    get playing() {
      return playing;
    },
    show,
    setData,
    setPlaying,
    key,
    stage,
    kindLabel: (kind) => PV_KIND_LABEL[kind] ?? kind,
    destroy() {
      clearTimeline();
      cancelAnimationFrame(camAnim);
      resizer.disconnect();
      root.replaceChildren();
    },
  };
}
