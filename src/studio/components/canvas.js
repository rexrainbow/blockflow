import { h, s } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { connectionLabels } from '../../lib/blockchart/layout/edge-labels.js';
import { endpointKey } from '../../lib/blockchart/endpoints.js';
import { descendants } from '../../lib/blockchart/hierarchy.js';
import { planConnection } from '../state/actions.js';

const MARGIN = 20;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Prefixes every id in `root` and rewrites url(#id) / href="#id" references to match. */
function isolateIds(root, prefix) {
  const ids = new Set([...root.querySelectorAll('[id]')].map((el) => el.id));
  if (!ids.size) return;
  for (const el of root.querySelectorAll('[id]')) el.id = prefix + el.id;
  const ref = /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g;
  for (const el of root.querySelectorAll('*'))
    for (const attr of [...el.attributes]) {
      if (attr.value.includes('url(')) {
        const next = attr.value.replace(ref, (all, id) => (ids.has(id) ? `url(#${prefix}${id})` : all));
        if (next !== attr.value) el.setAttribute(attr.name, next);
      } else if ((attr.name === 'href' || attr.name === 'xlink:href') && attr.value.startsWith('#') && ids.has(attr.value.slice(1)))
        el.setAttribute(attr.name, '#' + prefix + attr.value.slice(1));
    }
}

const selKey = (sel) =>
  !sel ? '' : sel.type === 'port' ? `port:${sel.owner}.${sel.port}` : sel.type === 'net' ? `net:${sel.index}` : `${sel.type}:${sel.id}`;

/**
 * The canvas shows the exact SVG produced by the shared renderer (same output as the
 * agent-kit converter) and lays an interaction overlay on top using the layout geometry.
 */
export class Canvas {
  constructor(store, callbacks) {
    this.store = store;
    this.cb = callbacks;
    this.fadeSerial = 0;
    this.camera = { x: 40, y: 40, z: 1 };
    this.layout = null;
    this.svgText = '';
    this.needsFit = true;
    this.anchor = null;
    this.space = false;
    this.el = h('div', { class: 'canvas', tabindex: '0', role: 'application', 'aria-label': 'Diagram canvas. Arrow keys select, Enter renames, Delete removes.' });
    this.stage = h('div', { class: 'stage' });
    this.overlay = s('svg', { class: 'overlay', 'aria-hidden': 'true' });
    this.ghost = s('g', { class: 'ghost-layer' });
    this.stage.append(this.overlay);
    this.empty = h('div', { class: 'canvas-empty', hidden: true });
    this.toolbar = h('div', { class: 'floatbar', role: 'toolbar', 'aria-label': 'Selection actions', hidden: true });
    this.tip = h('div', { class: 'drag-tip', hidden: true });
    this.busy = h('div', { class: 'canvas-busy', hidden: true }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Laying out…');
    this.mini = h('div', { class: 'minimap', title: 'Overview — drag to move the view' });
    this.miniImg = h('img', { alt: '', draggable: 'false' });
    this.miniView = h('div', { class: 'minimap-view' });
    this.mini.append(this.miniImg, this.miniView);
    this.zoomLabel = h('button', { type: 'button', class: 'zoom-label', title: 'Reset to 100%', onclick: () => this.zoomTo(1) }, '100%');
    this.zoomBar = h(
      'div',
      { class: 'zoombar' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zoom out', title: 'Zoom out (-)', onclick: () => this.zoomBy(1 / 1.25) }, icon('minus')),
      this.zoomLabel,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zoom in', title: 'Zoom in (+)', onclick: () => this.zoomBy(1.25) }, icon('plus')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zoom to selection', title: 'Zoom to selection (Shift+2)', onclick: () => this.zoomToSelection() }, icon('target')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fit diagram', title: 'Fit diagram (Shift+1)', onclick: () => this.fit() }, icon('fit')),
    );
    this.el.append(this.stage, this.empty, this.busy, this.toolbar, this.tip, this.mini, this.zoomBar);
    this.bind();
    new ResizeObserver(() => {
      if (this.needsFit && this.layout) this.fit();
      else this.applyCamera();
    }).observe(this.el);
  }

  /* ---------------- data ---------------- */
  setLayout(result) {
    const previous = this.layout;
    const sel = this.store.selection;
    const oldCenter = previous && sel ? this.centerOf(sel, previous) : null;
    this.layout = result.layout;
    this.svgText = result.svg;
    const art = h('div', { class: 'art' });
    art.innerHTML = result.svg; // trusted: produced by the shared renderer, all text XML-escaped
    const old = this.stage.querySelector('.art:not(.leaving)');
    this.stage.insertBefore(art, this.overlay);
    if (old) {
      if (reduceMotion()) old.remove();
      else {
        // Both drawings use the renderer's default ids (masks, markers) during the fade, and
        // url(#id) resolves to the first match in the page. Rename the leaving copy's ids so
        // the new drawing, which is exactly the exported SVG, always uses its own definitions.
        isolateIds(old, `leaving-${++this.fadeSerial}-`);
        old.classList.add('leaving');
        art.classList.add('entering');
        requestAnimationFrame(() => art.classList.remove('entering'));
        setTimeout(() => old.remove(), 220);
      }
    }
    const svg = art.querySelector('svg');
    const w = Number(svg.getAttribute('width')),
      hgt = Number(svg.getAttribute('height'));
    this.size = { w, h: hgt };
    for (const el of [this.overlay]) {
      el.setAttribute('width', w);
      el.setAttribute('height', hgt);
      el.setAttribute('viewBox', `${-MARGIN} ${-MARGIN} ${w} ${hgt}`);
    }
    this.stage.style.width = w + 'px';
    this.stage.style.height = hgt + 'px';
    this.buildOverlay();
    this.updateMinimap();
    if (this.needsFit) this.fit();
    else if (oldCenter) {
      const next = this.centerOf(sel, this.layout);
      if (next) {
        this.camera.x += (oldCenter.x - next.x) * this.camera.z;
        this.camera.y += (oldCenter.y - next.y) * this.camera.z;
      }
      this.applyCamera();
    } else this.applyCamera();
    this.empty.hidden = true;
  }

  setBusy(busy) {
    this.busy.hidden = !busy;
  }

  showEmpty(message, actions = []) {
    this.empty.hidden = false;
    this.empty.replaceChildren(h('p', message), h('div', { class: 'canvas-empty-actions' }, actions));
  }

  requestFit() {
    this.needsFit = true;
  }

  /* ---------------- overlay ---------------- */
  buildOverlay() {
    const L = this.layout,
      doc = this.store.document;
    const nodes = [];
    const rect = (b, props) => s('rect', { x: b.x, y: b.y, width: Math.max(1, b.width), height: Math.max(1, b.height), ...props });
    // Groups: interior (pan / select), title strip (drag / rename)
    const groups = [...(L.groups ?? [])].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
    for (const g of groups) {
      if (g.collapsed) continue;
      nodes.push(rect(g, { class: 'hit hit-group', 'data-hit': 'group', 'data-id': g.id }));
      const title = { x: g.x, y: g.y, width: g.width, height: Math.max(18, (g.labelBounds?.y ?? g.y) - g.y + (g.labelBounds?.height ?? 18) + 4) };
      const titleHit = rect(title, { class: 'hit hit-group-title', 'data-hit': 'group-title', 'data-id': g.id });
      titleHit._height = { layout: title.height, max: g.height };
      nodes.push(titleHit);
    }
    for (const g of groups.filter((x) => x.collapsed))
      nodes.push(rect({ x: g.x, y: g.y, width: g.width, height: g.faceHeight ?? g.height }, { class: 'hit hit-node', 'data-hit': 'collapsed', 'data-id': g.id, rx: 2 }));
    for (const m of L.modules) nodes.push(rect(m, { class: 'hit hit-node', 'data-hit': 'block', 'data-id': m.id }));
    for (const t of L.terminals ?? []) nodes.push(rect(pad(t.labelBounds, 4), { class: 'hit hit-node', 'data-hit': 'terminal', 'data-id': t.id }));
    // Nets: every routed section of every branch
    for (const c of L.connections) {
      const index = c.connectionIndex ?? Number(String(c.id).replace('connection_', ''));
      for (const section of c.sections)
        nodes.push(s('path', { d: pathOf(section.points), class: 'hit hit-net', 'data-hit': 'net', 'data-index': index, 'data-branch': c.branchIndex ?? 0, 'vector-effect': 'non-scaling-stroke' }));
      if (!c.style?.label?.hidden)
        for (const label of connectionLabels(c)) nodes.push(rect(pad(label.bounds, 2), { class: 'hit hit-label', 'data-hit': 'net-label', 'data-index': index, 'data-branch': c.branchIndex ?? 0 }));
    }
    // Ports on top
    const portHits = [];
    for (const m of L.modules)
      for (const p of m.ports) portHits.push(s('circle', { cx: p.x, cy: p.y, r: 6, class: `hit hit-port dir-${p.direction}`, 'data-hit': 'port', 'data-owner': m.id, 'data-port': p.id }));
    for (const g of L.groups ?? [])
      for (const p of g.ports ?? []) portHits.push(s('circle', { cx: p.x, cy: p.y, r: 6, class: 'hit hit-port', 'data-hit': 'port', 'data-owner': g.id, 'data-port': p.id }));
    this.selLayer = s('g', { class: 'sel-layer' });
    this.overlay.replaceChildren(s('g', { class: 'hits' }, nodes), this.selLayer, s('g', { class: 'ports' }, portHits), this.ghost);
    this.portHits = portHits;
    this.doc = doc;
    this.updatePortRadius();
    this.renderSelection();
  }

  updatePortRadius() {
    const r = Math.max(3, Math.min(10, 6 / this.camera.z));
    for (const c of this.portHits ?? []) c.setAttribute('r', r);
    // Title strips (the drag handle of a group) stay at least 16 screen px tall when zoomed out.
    for (const t of this.overlay?.querySelectorAll('.hit-group-title') ?? []) {
      if (!t._height) continue;
      t.setAttribute('height', Math.min(t._height.max, Math.max(t._height.layout, 16 / this.camera.z)));
    }
  }

  boundsOf(sel, L = this.layout) {
    if (!sel || !L) return null;
    if (sel.type === 'block') return L.modules.find((m) => m.id === sel.id) ?? null;
    if (sel.type === 'group') {
      const g = L.groups?.find((x) => x.id === sel.id);
      return g ? { x: g.x, y: g.y, width: g.width, height: g.faceHeight && g.collapsed ? g.faceHeight : g.height } : null;
    }
    if (sel.type === 'terminal') return L.terminals?.find((t) => t.id === sel.id)?.labelBounds ?? null;
    if (sel.type === 'port') {
      const owner = L.modules.find((m) => m.id === sel.owner) ?? L.groups?.find((g) => g.id === sel.owner);
      const p = owner?.ports?.find((x) => x.id === sel.port);
      return p ? { x: p.x - 4, y: p.y - 4, width: 8, height: 8 } : null;
    }
    if (sel.type === 'net') {
      const pts = L.connections
        .filter((c) => (c.connectionIndex ?? -1) === sel.index && (sel.branch === undefined || c.branchIndex === sel.branch))
        .flatMap((c) => c.sections.flatMap((x) => x.points));
      if (!pts.length) return null;
      const xs = pts.map((p) => p.x),
        ys = pts.map((p) => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
    return null;
  }

  centerOf(sel, L) {
    const b = this.boundsOf(sel, L);
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
  }

  renderSelection() {
    if (!this.selLayer || !this.layout) return;
    const L = this.layout,
      sel = this.store.selection;
    const out = [];
    const box = (b, cls) => s('rect', { x: b.x - 3, y: b.y - 3, width: b.width + 6, height: b.height + 6, rx: 3, class: cls, 'vector-effect': 'non-scaling-stroke' });
    const ring = (owner, port) => {
      const o = L.modules.find((m) => m.id === owner) ?? L.groups?.find((g) => g.id === owner);
      const p = o?.ports?.find((x) => x.id === port);
      if (p) out.push(s('circle', { cx: p.x, cy: p.y, r: Math.max(5, 8 / this.camera.z), class: 'sel-port', 'vector-effect': 'non-scaling-stroke' }));
    };
    if (sel?.type === 'net') {
      for (const c of L.connections.filter((x) => x.connectionIndex === sel.index)) {
        const strong = sel.branch === undefined || sel.branch === c.branchIndex;
        for (const section of c.sections) {
          const d = pathOf(section.points);
          out.push(s('path', { d, class: 'sel-net-halo', 'vector-effect': 'non-scaling-stroke' }));
          out.push(s('path', { d, class: strong ? 'sel-net' : 'sel-net weak', 'vector-effect': 'non-scaling-stroke' }));
        }
      }
    } else if (sel?.type === 'port') {
      ring(sel.owner, sel.port);
      for (const m of this.store.multi) ring(m.owner, m.port);
    } else if (sel) {
      const b = this.boundsOf(sel);
      if (b) {
        out.push(box(b, 'sel-halo'));
        out.push(box(b, sel.type === 'group' ? 'sel-box group' : 'sel-box'));
      }
    }
    this.selLayer.replaceChildren(...out);
    this.positionToolbar();
  }

  /* ---------------- camera ---------------- */
  applyCamera() {
    const { x, y, z } = this.camera;
    this.stage.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    this.zoomLabel.textContent = Math.round(z * 100) + '%';
    this.updatePortRadius();
    this.positionToolbar();
    this.updateMinimapView();
    this.positionEditor?.();
  }

  fit(bounds) {
    if (!this.size) return;
    const r = this.el.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return;
    const b = bounds ?? { x: -MARGIN, y: -MARGIN, width: this.size.w, height: this.size.h };
    const pad = bounds ? 80 : 32;
    const z = clamp(Math.min((r.width - pad * 2) / b.width, (r.height - pad * 2 - 40) / b.height), MIN_ZOOM, bounds ? 2 : 1.5);
    this.camera.z = z;
    this.camera.x = (r.width - b.width * z) / 2 - (b.x + MARGIN) * z;
    this.camera.y = (r.height - 40 - b.height * z) / 2 - (b.y + MARGIN) * z;
    this.needsFit = false;
    this.applyCamera();
  }

  zoomToSelection() {
    const b = this.boundsOf(this.store.selection);
    if (b) this.fit({ x: b.x - 20, y: b.y - 20, width: b.width + 40, height: b.height + 40 });
  }

  zoomTo(z, at) {
    const r = this.el.getBoundingClientRect();
    const px = at?.x ?? r.width / 2,
      py = at?.y ?? r.height / 2;
    const nz = clamp(z, MIN_ZOOM, MAX_ZOOM);
    this.camera.x = px - ((px - this.camera.x) * nz) / this.camera.z;
    this.camera.y = py - ((py - this.camera.y) * nz) / this.camera.z;
    this.camera.z = nz;
    this.needsFit = false;
    this.applyCamera();
  }

  zoomBy(f, at) {
    this.zoomTo(this.camera.z * f, at);
  }

  /** Screen (canvas-relative) point → layout coordinates. */
  toLayout(px, py) {
    return { x: (px - this.camera.x) / this.camera.z - MARGIN, y: (py - this.camera.y) / this.camera.z - MARGIN };
  }

  toScreen(lx, ly) {
    return { x: this.camera.x + (lx + MARGIN) * this.camera.z, y: this.camera.y + (ly + MARGIN) * this.camera.z };
  }

  revealSelection() {
    const b = this.boundsOf(this.store.selection);
    if (!b) return;
    const r = this.el.getBoundingClientRect();
    const a = this.toScreen(b.x, b.y),
      c = this.toScreen(b.x + b.width, b.y + b.height);
    if (a.x >= 0 && a.y >= 0 && c.x <= r.width && c.y <= r.height - 40) return;
    this.camera.x += r.width / 2 - (a.x + c.x) / 2;
    this.camera.y += (r.height - 40) / 2 - (a.y + c.y) / 2;
    this.applyCamera();
  }

  /* ---------------- minimap ---------------- */
  updateMinimap() {
    if (this.miniUrl) URL.revokeObjectURL(this.miniUrl);
    this.miniUrl = URL.createObjectURL(new Blob([this.svgText], { type: 'image/svg+xml' }));
    this.miniImg.src = this.miniUrl;
    const ratio = this.size.w / this.size.h;
    const W = 168,
      H = Math.max(40, Math.min(110, W / ratio));
    this.mini.style.width = W + 'px';
    this.mini.style.height = H + 'px';
    this.miniScale = Math.min(W / this.size.w, H / this.size.h);
    this.updateMinimapView();
  }

  updateMinimapView() {
    if (!this.size || !this.miniScale) return;
    const r = this.el.getBoundingClientRect(),
      k = this.miniScale,
      { x, y, z } = this.camera;
    const W = this.mini.clientWidth,
      H = this.mini.clientHeight;
    const ox = (W - this.size.w * k) / 2,
      oy = (H - this.size.h * k) / 2;
    const left = ox + (-x / z) * k,
      top = oy + (-y / z) * k;
    Object.assign(this.miniView.style, { left: left + 'px', top: top + 'px', width: (r.width / z) * k + 'px', height: (r.height / z) * k + 'px' });
    this.miniOrigin = { ox, oy };
    const all = r.width / z >= this.size.w && r.height / z >= this.size.h;
    this.mini.classList.toggle('dim', all);
  }

  /* ---------------- floating toolbar ---------------- */
  positionToolbar() {
    const sel = this.store.selection;
    const items = sel && !this.drag ? this.cb.toolbarItems(sel) : [];
    const b = items.length ? this.boundsOf(sel) : null;
    if (!b || this.editor) {
      this.toolbar.hidden = true;
      return;
    }
    const key = selKey(sel) + '|' + items.map((i) => i.label).join();
    if (this.toolbar.dataset.key !== key) {
      this.toolbar.dataset.key = key;
      this.toolbar.replaceChildren(
        ...items.map((item) =>
          item === '-'
            ? h('span', { class: 'floatbar-sep' })
            : h('button', { type: 'button', title: item.label + (item.shortcut ? ` (${item.shortcut})` : ''), 'aria-label': item.label, class: item.danger ? 'danger' : '', onclick: item.action }, icon(item.icon), item.text ? h('span', item.text) : null),
        ),
      );
    }
    this.toolbar.hidden = false;
    const r = this.el.getBoundingClientRect();
    const top = this.toScreen(b.x, b.y),
      bottom = this.toScreen(b.x + b.width, b.y + b.height);
    const w = this.toolbar.offsetWidth,
      th = this.toolbar.offsetHeight;
    let x = (top.x + bottom.x) / 2 - w / 2,
      y = top.y - th - 10;
    if (y < 8) y = bottom.y + 10;
    x = clamp(x, 8, r.width - w - 8);
    y = clamp(y, 8, r.height - th - 48);
    this.toolbar.style.transform = `translate(${x}px, ${y}px)`;
    const offscreen = bottom.x < 0 || top.x > r.width || bottom.y < 0 || top.y > r.height;
    this.toolbar.hidden = offscreen;
  }

  /* ---------------- inline rename ---------------- */
  startRename(sel) {
    const b = sel.type === 'net' ? this.netLabelBounds(sel) ?? this.boundsOf(sel) : this.labelBounds(sel) ?? this.boundsOf(sel);
    if (!b) return false;
    this.stopRename(false);
    const value = this.cb.labelFor(sel) ?? '';
    const input = h('textarea', { class: 'inline-edit', rows: Math.max(1, value.split('\n').length), spellcheck: 'false', 'aria-label': 'Label. Enter saves, Shift+Enter adds a line, Escape cancels.' });
    input.value = value;
    this.el.append(input);
    this.editor = { input, sel, b };
    this.positionEditor = () => {
      if (!this.editor) return;
      const p = this.toScreen(this.editor.b.x + this.editor.b.width / 2, this.editor.b.y + this.editor.b.height / 2);
      input.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    };
    this.positionEditor();
    this.toolbar.hidden = true;
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') this.stopRename(false);
      else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.stopRename(true);
      }
    });
    input.addEventListener('input', () => (input.rows = Math.max(1, input.value.split('\n').length)));
    input.addEventListener('blur', () => this.stopRename(true));
    input.focus();
    input.select();
    return true;
  }

  stopRename(save) {
    const editor = this.editor;
    if (!editor) return;
    this.editor = null;
    editor.input.remove();
    if (save && editor.input.value !== (this.cb.labelFor(editor.sel) ?? '')) this.cb.rename(editor.sel, editor.input.value);
    this.el.focus({ preventScroll: true });
    this.positionToolbar();
  }

  labelBounds(sel) {
    const L = this.layout;
    if (sel.type === 'block') return L.modules.find((m) => m.id === sel.id)?.labelBounds;
    if (sel.type === 'group') return L.groups?.find((g) => g.id === sel.id)?.labelBounds;
    if (sel.type === 'terminal') return L.terminals?.find((t) => t.id === sel.id)?.labelBounds;
    return null;
  }

  netLabelBounds(sel) {
    for (const c of this.layout.connections.filter((x) => x.connectionIndex === sel.index)) {
      const label = connectionLabels(c)[0];
      if (label) return label.bounds;
    }
    return null;
  }

  /* ---------------- input ---------------- */
  local(event) {
    const r = this.el.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  }

  hitAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    return el?.closest?.('[data-hit]') ?? null;
  }

  selectionFromHit(hit) {
    if (!hit) return null;
    const kind = hit.dataset.hit;
    if (kind === 'block') return { type: 'block', id: hit.dataset.id };
    if (kind === 'group' || kind === 'group-title' || kind === 'collapsed') return { type: 'group', id: hit.dataset.id };
    if (kind === 'terminal') return { type: 'terminal', id: hit.dataset.id };
    if (kind === 'port') return { type: 'port', owner: hit.dataset.owner, port: hit.dataset.port };
    if (kind === 'net' || kind === 'net-label') return { type: 'net', index: Number(hit.dataset.index), branch: kind === 'net' ? Number(hit.dataset.branch) : undefined };
    return null;
  }

  bind() {
    const el = this.el;
    el.addEventListener('wheel', (event) => {
      if (event.target.closest('.minimap, .zoombar, .floatbar')) return;
      event.preventDefault();
      const p = this.local(event);
      if (event.ctrlKey || event.metaKey || Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
        if (!event.ctrlKey && event.shiftKey) {
          this.camera.x -= event.deltaY;
          this.applyCamera();
          return;
        }
        const scale = event.deltaMode === 1 ? 0.05 : 0.0015;
        this.zoomBy(Math.exp(-event.deltaY * scale * (event.ctrlKey ? 4 : 1)), p);
      } else {
        this.camera.x -= event.deltaX;
        this.camera.y -= event.deltaY;
        this.applyCamera();
      }
    }, { passive: false });

    el.addEventListener('pointerdown', (event) => this.pointerDown(event));
    el.addEventListener('dblclick', (event) => {
      const hit = this.hitAt(event.clientX, event.clientY);
      const sel = this.selectionFromHit(hit);
      if (!sel) return;
      if (hit.dataset.hit === 'group' || hit.dataset.hit === 'collapsed') this.cb.enterGroup(sel.id);
      else if (sel.type !== 'port') {
        this.cb.select(sel);
        this.startRename(sel);
      }
    });
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const hit = this.hitAt(event.clientX, event.clientY);
      const sel = this.selectionFromHit(hit);
      if (sel) this.cb.select(sel);
      this.cb.contextMenu(sel, { x: event.clientX, y: event.clientY });
    });
    el.addEventListener('keydown', (event) => {
      if (event.key === ' ' && !event.repeat && event.target === el) {
        this.space = true;
        el.classList.add('panning-ready');
        event.preventDefault();
      }
    });
    el.addEventListener('keyup', (event) => {
      if (event.key === ' ') {
        this.space = false;
        el.classList.remove('panning-ready');
      }
    });

    // Minimap navigation
    const miniMove = (event) => {
      const r = this.mini.getBoundingClientRect(),
        k = this.miniScale,
        cr = this.el.getBoundingClientRect();
      const lx = (event.clientX - r.left - this.miniOrigin.ox) / k,
        ly = (event.clientY - r.top - this.miniOrigin.oy) / k;
      this.camera.x = cr.width / 2 - lx * this.camera.z;
      this.camera.y = cr.height / 2 - ly * this.camera.z;
      this.applyCamera();
    };
    this.mini.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      this.mini.setPointerCapture(event.pointerId);
      miniMove(event);
      const move = (e) => miniMove(e);
      const up = () => {
        this.mini.removeEventListener('pointermove', move);
        this.mini.removeEventListener('pointerup', up);
      };
      this.mini.addEventListener('pointermove', move);
      this.mini.addEventListener('pointerup', up);
    });
    for (const part of [this.zoomBar, this.toolbar]) part.addEventListener('pointerdown', (event) => event.stopPropagation());
  }

  pointerDown(event) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target.closest('.inline-edit')) return;
    if (this.editor) this.stopRename(true);
    this.el.focus({ preventScroll: true });
    const hit = this.hitAt(event.clientX, event.clientY);
    const start = this.local(event);
    const kind = hit?.dataset.hit;
    let mode = 'pan';
    if (event.button === 1 || this.space) mode = 'pan';
    else if (kind === 'port' || kind === 'terminal') mode = 'port';
    else if (['block', 'collapsed', 'group-title'].includes(kind)) mode = 'node';
    const camera0 = { ...this.camera };
    let moved = false;
    this.el.setPointerCapture(event.pointerId);
    const move = (e) => {
      const p = this.local(e);
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 4) return;
      if (!moved) {
        moved = true;
        if (mode === 'port') this.beginConnect(hit);
        else if (mode === 'node' && kind !== 'terminal') this.beginMove(hit);
        else if (mode === 'node') mode = 'pan';
        if (mode === 'pan') this.el.classList.add('panning');
      }
      if (mode === 'pan') {
        this.camera.x = camera0.x + p.x - start.x;
        this.camera.y = camera0.y + p.y - start.y;
        this.needsFit = false;
        this.applyCamera();
      } else if (mode === 'port') this.updateConnect(e, p);
      else if (mode === 'node') this.updateMove(e, p);
    };
    const up = (e) => {
      this.el.removeEventListener('pointermove', move);
      this.el.removeEventListener('pointerup', up);
      this.el.removeEventListener('pointercancel', up);
      this.el.classList.remove('panning');
      if (!moved) {
        if (e.type === 'pointercancel') return;
        const sel = this.selectionFromHit(hit);
        this.cb.select(sel, { additive: e.shiftKey && sel?.type === 'port' });
        return;
      }
      if (mode === 'port') this.endConnect(e.type !== 'pointercancel');
      else if (mode === 'node') this.endMove(e.type !== 'pointercancel');
    };
    this.el.addEventListener('pointermove', move);
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
  }

  /* ---- connect by dragging from a port ---- */
  beginConnect(hit) {
    const L = this.layout;
    let from, origin;
    if (hit.dataset.hit === 'terminal') {
      const t = L.terminals.find((x) => x.id === hit.dataset.id);
      from = '@terminal:' + t.id;
      origin = { x: t.labelBounds.x + t.labelBounds.width / 2, y: t.labelBounds.y + t.labelBounds.height / 2 };
    } else {
      const owner = hit.dataset.owner,
        port = hit.dataset.port;
      const o = L.modules.find((m) => m.id === owner) ?? L.groups?.find((g) => g.id === owner);
      const p = o.ports.find((x) => x.id === port);
      from = owner + '.' + port;
      origin = { x: p.x, y: p.y };
    }
    this.drag = { type: 'connect', from, origin, plan: null, target: null };
    this.ghostLine = s('path', { class: 'ghost-line', 'vector-effect': 'non-scaling-stroke' });
    this.ghostEnd = s('circle', { class: 'ghost-end', r: 4 });
    this.ghost.replaceChildren(this.ghostLine, this.ghostEnd);
    this.el.classList.add('connecting');
    this.toolbar.hidden = true;
  }

  updateConnect(event, p) {
    const d = this.drag;
    const hit = this.hitAt(event.clientX, event.clientY);
    for (const c of this.overlay.querySelectorAll('.drop-ok, .drop-bad')) c.classList.remove('drop-ok', 'drop-bad');
    let end = this.toLayout(p.x, p.y);
    d.plan = null;
    if (hit?.dataset.hit === 'port' || hit?.dataset.hit === 'terminal') {
      const key = hit.dataset.hit === 'port' ? hit.dataset.owner + '.' + hit.dataset.port : '@terminal:' + hit.dataset.id;
      d.plan = planConnection(this.store.document, d.from, key);
      hit.classList.add(d.plan.ok ? 'drop-ok' : 'drop-bad');
      if (hit.dataset.hit === 'port') end = { x: Number(hit.getAttribute('cx')), y: Number(hit.getAttribute('cy')) };
    }
    const o = d.origin;
    const mx = (o.x + end.x) / 2;
    this.ghostLine.setAttribute('d', `M ${o.x} ${o.y} C ${mx} ${o.y}, ${mx} ${end.y}, ${end.x} ${end.y}`);
    this.ghostLine.classList.toggle('bad', Boolean(d.plan && !d.plan.ok));
    this.ghostEnd.setAttribute('cx', end.x);
    this.ghostEnd.setAttribute('cy', end.y);
    this.showTip(p, d.plan ? d.plan.message : 'Drop on a port to connect');
    this.tip.classList.toggle('bad', Boolean(d.plan && !d.plan.ok));
  }

  endConnect(commit) {
    const d = this.drag;
    this.drag = null;
    this.ghost.replaceChildren();
    this.tip.hidden = true;
    this.el.classList.remove('connecting');
    for (const c of this.overlay.querySelectorAll('.drop-ok, .drop-bad')) c.classList.remove('drop-ok', 'drop-bad');
    if (commit && d?.plan?.ok) this.cb.connect(d.plan);
    else if (commit && d?.plan) this.cb.notify(d.plan.message, 'error');
    this.positionToolbar();
  }

  /* ---- move a block/group into another group (hierarchy only; ELK decides position) ---- */
  beginMove(hit) {
    const id = hit.dataset.id;
    const isGroup = hit.dataset.hit !== 'block';
    const sel = isGroup ? { type: 'group', id } : { type: 'block', id };
    const b = this.boundsOf(sel);
    const excluded = new Set([id, ...(isGroup ? descendants(this.store.document, id) : [])]);
    this.drag = { type: 'move', id, b, excluded, target: undefined };
    this.ghostRect = s('rect', { class: 'ghost-node', x: b.x, y: b.y, width: b.width, height: b.height, 'vector-effect': 'non-scaling-stroke' });
    this.dropRect = s('rect', { class: 'ghost-drop', 'vector-effect': 'non-scaling-stroke' });
    this.ghost.replaceChildren(this.dropRect, this.ghostRect);
    this.el.classList.add('moving');
    this.toolbar.hidden = true;
    this.dragStart = null;
  }

  updateMove(event, p) {
    const d = this.drag;
    const point = this.toLayout(p.x, p.y);
    this.dragStart ??= point;
    this.ghostRect.setAttribute('x', d.b.x + point.x - this.dragStart.x);
    this.ghostRect.setAttribute('y', d.b.y + point.y - this.dragStart.y);
    // Deepest group under the pointer that is not the item itself or inside it.
    const groups = (this.layout.groups ?? [])
      .filter((g) => !g.collapsed && !d.excluded.has(g.id) && point.x >= g.x && point.x <= g.x + g.width && point.y >= g.y && point.y <= g.y + g.height)
      .sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));
    const target = groups[0]?.id ?? '';
    d.target = target;
    const current = (this.store.document.groups ?? []).find((g) => g.members.includes(d.id))?.id ?? '';
    const g = groups[0];
    if (g) {
      this.dropRect.setAttribute('x', g.x);
      this.dropRect.setAttribute('y', g.y);
      this.dropRect.setAttribute('width', g.width);
      this.dropRect.setAttribute('height', g.height);
      this.dropRect.style.display = '';
    } else this.dropRect.style.display = 'none';
    const name = target ? (this.store.document.groups.find((x) => x.id === target)?.label ?? target).replace(/\n/g, ' ') : 'Top level';
    this.showTip(p, target === current ? `Already in ${name} — layout decides position` : `Move into ${name}`);
    this.tip.classList.remove('bad');
  }

  endMove(commit) {
    const d = this.drag;
    this.drag = null;
    this.ghost.replaceChildren();
    this.tip.hidden = true;
    this.el.classList.remove('moving');
    if (commit && d && d.target !== undefined) this.cb.place(d.id, d.target);
    this.positionToolbar();
  }

  showTip(p, text) {
    this.tip.hidden = false;
    this.tip.textContent = text;
    this.tip.style.transform = `translate(${p.x + 14}px, ${p.y + 16}px)`;
  }

  /** Keyboard navigation: nearest item in a direction. */
  neighbor(dx, dy) {
    const L = this.layout,
      sel = this.store.selection;
    if (!L) return null;
    const items = [
      ...L.modules.map((m) => ({ sel: { type: 'block', id: m.id }, b: m })),
      ...(L.groups ?? []).filter((g) => g.collapsed).map((g) => ({ sel: { type: 'group', id: g.id }, b: g })),
      ...(L.terminals ?? []).map((t) => ({ sel: { type: 'terminal', id: t.id }, b: t.labelBounds })),
    ];
    const c0 = this.centerOf(sel, L);
    if (!c0) return items[0]?.sel ?? null;
    let best = null,
      score = Infinity;
    for (const item of items) {
      if (selKey(item.sel) === selKey(sel)) continue;
      const c = { x: item.b.x + item.b.width / 2, y: item.b.y + item.b.height / 2 };
      const vx = c.x - c0.x,
        vy = c.y - c0.y;
      const along = vx * dx + vy * dy;
      if (along <= 1) continue;
      const across = Math.abs(vx * dy - vy * dx);
      const sc = along + across * 2;
      if (sc < score) {
        score = sc;
        best = item.sel;
      }
    }
    return best;
  }
}

function pathOf(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
}
function pad(b, n) {
  return { x: b.x - n, y: b.y - n, width: b.width + 2 * n, height: b.height + 2 * n };
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
export { endpointKey };
