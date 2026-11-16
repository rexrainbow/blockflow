import { h, s } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

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
      } else if (
        (attr.name === 'href' || attr.name === 'xlink:href') &&
        attr.value.startsWith('#') &&
        ids.has(attr.value.slice(1))
      )
        el.setAttribute(attr.name, '#' + prefix + attr.value.slice(1));
    }
}

/**
 * Diagram-independent canvas: shows the exact SVG produced by the runtime renderer (the
 * same output as the converter) and lays an interaction overlay on top using the layout
 * geometry. Camera, cross-fade, minimap, floating toolbar, inline rename and pointer
 * handling live here; a domain subclass supplies:
 *   margin                      layout → SVG offset (layout x 0 is drawn at `margin`)
 *   buildHits(L, doc)           → { hits: [svg nodes], top: [svg nodes] }
 *   boundsOf(sel, L)            item bounds in layout coordinates
 *   selectionFromHit(hit)       overlay element → selection
 *   selectionShapes(sel, L)     extra selection drawing (optional; default: a box)
 *   dragKind(hitKind)           'node' | 'connect' | null (pan)
 *   beginDrag/updateDrag/endDrag(kind, …)
 *   renameBounds(sel), navItems(L), selKey(sel)
 */
export class CanvasBase {
  margin = 0;

  constructor(store, callbacks) {
    this.store = store;
    this.cb = callbacks;
    this.fadeSerial = 0;
    this.camera = { x: 40, y: 40, z: 1 };
    this.layout = null;
    this.svgText = '';
    this.needsFit = true;
    this.space = false;
    this.el = h('div', {
      class: 'canvas',
      tabindex: '0',
      role: 'application',
      'aria-label': 'Diagram canvas. Arrow keys select, Enter renames, Delete removes.',
    });
    this.stage = h('div', { class: 'stage' });
    this.overlay = s('svg', { class: 'overlay', 'aria-hidden': 'true' });
    this.ghost = s('g', { class: 'ghost-layer' });
    this.stage.append(this.overlay);
    this.empty = h('div', { class: 'canvas-empty', hidden: true });
    this.toolbar = h('div', {
      class: 'floatbar',
      role: 'toolbar',
      'aria-label': 'Selection actions',
      hidden: true,
    });
    this.tip = h('div', { class: 'drag-tip', hidden: true });
    this.busy = h(
      'div',
      { class: 'canvas-busy', hidden: true },
      h('span', { class: 'spinner', 'aria-hidden': 'true' }),
      'Laying out…',
    );
    this.mini = h('div', { class: 'minimap', title: 'Overview — drag to move the view' });
    this.miniImg = h('img', { alt: '', draggable: 'false' });
    this.miniView = h('div', { class: 'minimap-view' });
    this.mini.append(this.miniImg, this.miniView);
    this.zoomLabel = h(
      'button',
      { type: 'button', class: 'zoom-label', title: 'Reset to 100%', onclick: () => this.zoomTo(1) },
      '100%',
    );
    this.zoomBar = h(
      'div',
      { class: 'zoombar' },
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': 'Zoom out',
          title: 'Zoom out (-)',
          onclick: () => this.zoomBy(1 / 1.25),
        },
        icon('minus'),
      ),
      this.zoomLabel,
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': 'Zoom in',
          title: 'Zoom in (+)',
          onclick: () => this.zoomBy(1.25),
        },
        icon('plus'),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': 'Zoom to selection',
          title: 'Zoom to selection (Shift+2)',
          onclick: () => this.zoomToSelection(),
        },
        icon('target'),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': 'Fit diagram',
          title: 'Fit diagram (Shift+1)',
          onclick: () => this.fit(),
        },
        icon('fit'),
      ),
    );
    this.el.append(this.stage, this.empty, this.busy, this.toolbar, this.tip, this.mini, this.zoomBar);
    this.bind();
    this.resizer = new ResizeObserver(() => {
      if (this.needsFit && this.layout) this.fit();
      else this.applyCamera();
    });
    this.resizer.observe(this.el);
  }

  dispose() {
    this.resizer.disconnect();
    if (this.miniUrl) URL.revokeObjectURL(this.miniUrl);
    this.stopRename(false);
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
    this.overlay.setAttribute('width', w);
    this.overlay.setAttribute('height', hgt);
    this.overlay.setAttribute('viewBox', `${-this.margin} ${-this.margin} ${w} ${hgt}`);
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
    const { hits, top = [] } = this.buildHits(this.layout, this.store.document);
    this.selLayer = s('g', { class: 'sel-layer' });
    this.topLayer = s('g', { class: 'ports' }, top);
    this.overlay.replaceChildren(s('g', { class: 'hits' }, hits), this.selLayer, this.topLayer, this.ghost);
    this.doc = this.store.document;
    this.updateZoomSized();
    this.renderSelection();
  }

  /** Overlay parts that keep a minimum on-screen size (domain hook). */
  updateZoomSized() {}

  centerOf(sel, L) {
    const b = this.boundsOf(sel, L);
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
  }

  selectionShapes(sel) {
    const b = this.boundsOf(sel);
    return b
      ? [this.box(b, 'sel-halo'), this.box(b, sel.type === 'group' ? 'sel-box group' : 'sel-box')]
      : [];
  }

  box(b, cls) {
    return s('rect', {
      x: b.x - 3,
      y: b.y - 3,
      width: b.width + 6,
      height: b.height + 6,
      rx: 3,
      class: cls,
      'vector-effect': 'non-scaling-stroke',
    });
  }

  renderSelection() {
    if (!this.selLayer || !this.layout) return;
    const sel = this.store.selection;
    this.selLayer.replaceChildren(...(sel ? this.selectionShapes(sel, this.layout) : []));
    this.positionToolbar();
  }

  /* ---------------- camera ---------------- */
  applyCamera() {
    const { x, y, z } = this.camera;
    this.stage.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    this.zoomLabel.textContent = Math.round(z * 100) + '%';
    this.updateZoomSized();
    this.positionToolbar();
    this.updateMinimapView();
    this.positionEditor?.();
  }

  fit(bounds) {
    if (!this.size) return;
    const r = this.el.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return;
    const m = this.margin;
    const b = bounds ?? { x: -m, y: -m, width: this.size.w, height: this.size.h };
    const pad = bounds ? 80 : 32;
    const z = clamp(
      Math.min((r.width - pad * 2) / b.width, (r.height - pad * 2 - 40) / b.height),
      MIN_ZOOM,
      bounds ? 2 : 1.5,
    );
    this.camera.z = z;
    this.camera.x = (r.width - b.width * z) / 2 - (b.x + m) * z;
    this.camera.y = (r.height - 40 - b.height * z) / 2 - (b.y + m) * z;
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
    return {
      x: (px - this.camera.x) / this.camera.z - this.margin,
      y: (py - this.camera.y) / this.camera.z - this.margin,
    };
  }

  toScreen(lx, ly) {
    return {
      x: this.camera.x + (lx + this.margin) * this.camera.z,
      y: this.camera.y + (ly + this.margin) * this.camera.z,
    };
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
    Object.assign(this.miniView.style, {
      left: left + 'px',
      top: top + 'px',
      width: (r.width / z) * k + 'px',
      height: (r.height / z) * k + 'px',
    });
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
    const key = this.selKey(sel) + '|' + items.map((i) => i.label).join();
    if (this.toolbar.dataset.key !== key) {
      this.toolbar.dataset.key = key;
      this.toolbar.replaceChildren(
        ...items.map((item) =>
          item === '-'
            ? h('span', { class: 'floatbar-sep' })
            : h(
                'button',
                {
                  type: 'button',
                  title: item.label + (item.shortcut ? ` (${item.shortcut})` : ''),
                  'aria-label': item.label,
                  class: item.danger ? 'danger' : '',
                  disabled: item.disabled,
                  onclick: item.action,
                },
                icon(item.icon),
                item.text ? h('span', item.text) : null,
              ),
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
    const b = this.renameBounds(sel) ?? this.boundsOf(sel);
    if (!b) return false;
    this.stopRename(false);
    const value = this.cb.labelFor(sel) ?? '';
    const input = h('textarea', {
      class: 'inline-edit',
      rows: Math.max(1, value.split('\n').length),
      spellcheck: 'false',
      'aria-label': 'Label. Enter saves, Shift+Enter adds a line, Escape cancels.',
    });
    input.value = value;
    this.el.append(input);
    this.editor = { input, sel, b };
    this.positionEditor = () => {
      if (!this.editor) return;
      const p = this.toScreen(
        this.editor.b.x + this.editor.b.width / 2,
        this.editor.b.y + this.editor.b.height / 2,
      );
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
    if (save && editor.input.value !== (this.cb.labelFor(editor.sel) ?? ''))
      this.cb.rename(editor.sel, editor.input.value);
    this.el.focus({ preventScroll: true });
    this.positionToolbar();
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

  /** Double-click: rename by default (domains may open a view instead). */
  onDoubleClick(hit, sel) {
    this.cb.select(sel);
    this.startRename(sel);
  }

  bind() {
    const el = this.el;
    el.addEventListener(
      'wheel',
      (event) => {
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
      },
      { passive: false },
    );

    el.addEventListener('pointerdown', (event) => this.pointerDown(event));
    el.addEventListener('dblclick', (event) => {
      const hit = this.hitAt(event.clientX, event.clientY);
      const sel = this.selectionFromHit(hit);
      if (sel) this.onDoubleClick(hit, sel);
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
    for (const part of [this.zoomBar, this.toolbar])
      part.addEventListener('pointerdown', (event) => event.stopPropagation());
  }

  pointerDown(event) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target.closest('.inline-edit')) return;
    if (this.editor) this.stopRename(true);
    this.el.focus({ preventScroll: true });
    const hit = this.hitAt(event.clientX, event.clientY);
    const start = this.local(event);
    let mode = event.button === 1 || this.space ? 'pan' : (this.dragKind(hit) ?? 'pan');
    const camera0 = { ...this.camera };
    let moved = false;
    this.el.setPointerCapture(event.pointerId);
    const move = (e) => {
      const p = this.local(e);
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 4) return;
      if (!moved) {
        moved = true;
        if (mode !== 'pan' && this.beginDrag(mode, hit) === false) mode = 'pan';
        if (mode === 'pan') this.el.classList.add('panning');
      }
      if (mode === 'pan') {
        this.camera.x = camera0.x + p.x - start.x;
        this.camera.y = camera0.y + p.y - start.y;
        this.needsFit = false;
        this.applyCamera();
      } else this.updateDrag(mode, e, p);
    };
    const up = (e) => {
      this.el.removeEventListener('pointermove', move);
      this.el.removeEventListener('pointerup', up);
      this.el.removeEventListener('pointercancel', up);
      this.el.classList.remove('panning');
      if (!moved) {
        if (e.type === 'pointercancel') return;
        this.click(hit, e);
        return;
      }
      if (mode !== 'pan') this.endDrag(mode, e.type !== 'pointercancel', e);
    };
    this.el.addEventListener('pointermove', move);
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
  }

  click(hit) {
    this.cb.select(this.selectionFromHit(hit));
  }

  dragKind() {
    return null;
  }

  showTip(p, text, bad = false) {
    this.tip.hidden = false;
    this.tip.textContent = text;
    this.tip.style.transform = `translate(${p.x + 14}px, ${p.y + 16}px)`;
    this.tip.classList.toggle('bad', bad);
  }

  hideTip() {
    this.tip.hidden = true;
  }

  /** Keyboard navigation: nearest item in a direction. */
  neighbor(dx, dy) {
    const L = this.layout,
      sel = this.store.selection;
    if (!L) return null;
    const items = this.navItems(L);
    const c0 = this.centerOf(sel, L);
    if (!c0) return items[0]?.sel ?? null;
    let best = null,
      score = Infinity;
    for (const item of items) {
      if (this.selKey(item.sel) === this.selKey(sel)) continue;
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

export function pathOf(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
}
export function pad(b, n) {
  return { x: b.x - n, y: b.y - n, width: b.width + 2 * n, height: b.height + 2 * n };
}
export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
