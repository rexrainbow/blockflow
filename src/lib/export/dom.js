import { renderSvg } from '../render/svg.js';
import { textSize } from '../geometry.js';
import { TEXT_STYLE } from '../styles.js';
import { ViewEvents } from '../view/events.js';
import { copyLayout, connectionKey, routePath, routeBounds } from '../view/layout.js';

const NS = 'http://www.w3.org/2000/svg';
const clone = (value) => structuredClone(value);
const compact = (value) => value.replace(/\s*\n\s*/g, ' / ');
const center = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const same = (a, b) => a?.type === b?.type && a?.key === b?.key;
const colors = { idle: '#59677d', running: '#946016', success: '#26704a', error: '#b42b3d' };
const css = `
[data-portsketch-view] { background:var(--portsketch-background,#f8fafc); touch-action:none; user-select:none; }
[data-portsketch-view] [data-hit] { cursor:pointer; outline:none; }
[data-portsketch-view] [data-hit] .hit-area { fill:transparent; stroke:transparent; }
[data-portsketch-view] [data-hit] path.hit-area { fill:none; stroke-width:12px; pointer-events:stroke; }
[data-portsketch-view] [data-hit]:hover .hit-area { stroke:var(--portsketch-accent,#2457d6); stroke-opacity:.25; }
[data-portsketch-view] [data-hit]:focus-visible .hit-area { stroke:var(--portsketch-accent,#2457d6); stroke-opacity:1; stroke-width:2px; }
[data-portsketch-view] [data-hit]:focus-visible path.hit-area { stroke-width:6px; }
[data-portsketch-view]:focus-visible { outline:2px solid var(--portsketch-accent,#2457d6); outline-offset:-2px; }
`;

/** Create a detached interactive SVG view from layoutDiagram() output. */
export function exportDom(layout, options = {}) {
  return new DiagramView(layout, options);
}

/** Append an owned SVG to a host; existing host children are preserved. */
export function mountDiagram(container, layout, options = {}) {
  if (!container?.ownerDocument || typeof container.appendChild !== 'function')
    throw new TypeError('A DOM host element is required');
  const view = exportDom(layout, { ...options, document: container.ownerDocument });
  container.appendChild(view.element);
  view.fit();
  return view;
}

class DiagramView {
  constructor(layout, options) {
    this.document = options.document ?? globalThis.document;
    if (!this.document?.createElementNS || !this.document.defaultView)
      throw new Error('DOM exporter requires a browser Document');
    this.window = this.document.defaultView;
    this.minZoom = options.minZoom ?? 0.05;
    this.maxZoom = options.maxZoom ?? 8;
    if (
      ![this.minZoom, this.maxZoom].every((value) => Number.isFinite(value) && value > 0) ||
      this.minZoom > this.maxZoom
    )
      throw new RangeError('Invalid zoom limits');
    this.events = new ViewEvents((error) =>
      this.window.reportError
        ? this.window.reportError(error)
        : this.window.setTimeout(() => {
            throw error;
          }, 0),
    );
    this.element = this.node('svg', {
      'data-portsketch-view': '',
      role: 'group',
      tabindex: 0,
      'aria-label':
        options.ariaLabel ??
        'Interactive diagram: drag to pan, scroll to zoom; arrow keys pan, 0 fits, Escape clears selection',
    });
    this.element.style.width = '100%';
    this.element.style.height = '100%';
    this.element.style.display = 'block';
    this.element.append(this.node('style', {}, css));
    this.world = this.node('g', { 'data-layer': 'world' });
    this.element.append(this.world);
    this.states = new Map();
    this.values = new Map();
    this.selected = null;
    this.camera = { x: 0, y: 0, scale: 1 };
    this.bindings = [];
    this.destroyed = false;
    this.setLayout(layout, { fit: true });
    this.bind();
    if (this.window.ResizeObserver) {
      this.resize = new this.window.ResizeObserver(() => this.refresh());
      this.resize.observe(this.element);
    } else this.listen(this.window, 'resize', () => this.refresh());
  }
  node(name, attributes = {}, value) {
    const node = this.document.createElementNS(NS, name);
    for (const [key, item] of Object.entries(attributes)) node.setAttribute(key, String(item));
    if (value !== undefined) node.textContent = value;
    return node;
  }
  assertAlive() {
    if (this.destroyed) throw new Error('Diagram view has been destroyed');
  }
  on(name, handler) {
    this.assertAlive();
    return this.events.on(name, handler);
  }
  once(name, handler) {
    this.assertAlive();
    return this.events.once(name, handler);
  }
  off(name, handler) {
    return this.events.off(name, handler);
  }
  emit(name, payload = {}) {
    if (this.destroyed) return;
    const freeze = (value) => {
      if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
      return value;
    };
    const { originalEvent = null, ...data } = payload;
    this.events.emit(name, Object.freeze({ ...freeze(clone(data)), type: name, originalEvent }));
  }
  get viewport() {
    this.assertAlive();
    return { ...this.camera };
  }
  get selection() {
    this.assertAlive();
    return this.selected ? this.describe(this.selected) : null;
  }
  get layout() {
    this.assertAlive();
    return clone(this.currentLayout);
  }
  describe(item) {
    const value = { type: item.type, id: item.id, key: item.key };
    if (item.type === 'port')
      Object.assign(value, {
        ownerId: item.blockId,
        ownerType: item.ownerType,
        ...(item.ownerType === 'group' ? { groupId: item.blockId } : { blockId: item.blockId }),
        portId: item.data.id,
      });
    if (item.type === 'connection')
      Object.assign(value, {
        source: clone(item.data.source ?? null),
        target: clone(item.data.target ?? null),
      });
    return value;
  }
  resolve(type, id) {
    const item = this.items.get(type + ':' + id) ?? this.aliases.get(type + ':' + id);
    if (!item) throw new RangeError('Unknown ' + type + ': ' + id);
    return item;
  }
  getElement(type, id) {
    this.assertAlive();
    return this.resolve(type, id).element;
  }
  setLayout(input, { fit = false } = {}) {
    this.assertAlive();
    const layout = copyLayout(input);
    const parser = new this.window.DOMParser();
    const parsed = parser.parseFromString(renderSvg(layout), 'image/svg+xml');
    if (parsed.querySelector('parsererror')) throw new TypeError('Cannot render DOM layout');
    const previous = this.selected ? this.describe(this.selected) : null;
    const oldCenter = this.selected ? center(this.selected.box) : null;
    const focus = this.element.contains(this.document.activeElement)
      ? this.document.activeElement.closest('[data-hit]')?.getAttribute('data-target')
      : null;
    if (this.drag) {
      const id = this.drag.id;
      this.drag = null;
      if (this.element.hasPointerCapture(id)) this.element.releasePointerCapture(id);
    }
    this.currentLayout = layout;
    this.world.replaceChildren();
    this.items = new Map();
    this.aliases = new Map();
    this.element.setAttribute('width', layout.width + 40);
    this.element.setAttribute('height', layout.height + 40);
    for (const child of [...parsed.documentElement.children])
      this.world.append(this.document.importNode(child, true));
    this.stateLayer = this.node('g', { 'data-layer': 'state', 'pointer-events': 'none' });
    this.selectionLayer = this.node('g', { 'data-layer': 'selection', 'pointer-events': 'none' });
    this.hitLayer = this.node('g', { 'data-layer': 'hits' });
    this.world.append(this.stateLayer, this.selectionLayer, this.hitLayer);
    const add = (type, id, key, data, box, label, shapes, blockId, ownerType) => {
      const target = type + ':' + key;
      const element = this.node('g', {
        'data-hit': '',
        'data-kind': type,
        'data-id': id,
        'data-key': key,
        'data-target': target,
        role: 'button',
        tabindex: 0,
        'aria-label': label,
        'aria-pressed': 'false',
      });
      element.append(...shapes);
      this.hitLayer.append(element);
      const item = { type, id, key, data, box, label, element, blockId, ownerType };
      this.items.set(target, item);
      this.aliases.set(type + ':' + id, item);
    };
    const rectangle = (box) =>
      this.node('rect', {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        class: 'hit-area',
        'vector-effect': 'non-scaling-stroke',
      });
    for (const group of (layout.groups ?? []).filter((group) => !group.collapsed))
      add('group', group.id, group.id, group, group, 'Select group ' + compact(group.label), [
        rectangle(group.labelBounds),
      ]);
    for (const edge of layout.connections)
      add(
        'connection',
        edge.id,
        connectionKey(edge),
        edge,
        routeBounds(edge),
        'Select connection ' + (edge.source ? connectionKey(edge) : edge.id),
        [
          this.node('path', { d: routePath(edge), class: 'hit-area', 'vector-effect': 'non-scaling-stroke' }),
          ...(edge.labelBounds ? [rectangle(edge.labelBounds)] : []),
        ],
      );
    for (const group of (layout.groups ?? []).filter((group) => group.collapsed))
      add('group', group.id, group.id, group, group, 'Select group ' + compact(group.label), [
        rectangle(group),
        ...(group.ports ?? [])
          .filter((port) => port.virtual)
          .map((port) => this.node('circle', { cx: port.x, cy: port.y, r: 7, class: 'hit-area' })),
      ]);
    for (const block of layout.modules) {
      add('block', block.id, block.id, block, block, 'Select block ' + compact(block.label), [
        rectangle({ x: block.x, y: block.y, width: block.width, height: block.height }),
      ]);
    }
    for (const block of [...layout.modules, ...(layout.groups ?? [])]) {
      for (const port of (block.ports ?? []).filter((port) => !port.virtual)) {
        const ref = block.id + '.' + port.id;
        add(
          'port',
          ref,
          ref,
          port,
          port.labelBounds,
          'Select ' + port.direction + ' port ' + ref + ': ' + compact(port.displayName),
          [
            rectangle(port.labelBounds),
            this.node('circle', {
              cx: port.x,
              cy: port.y,
              r: 7,
              class: 'hit-area',
              'vector-effect': 'non-scaling-stroke',
            }),
          ],
          block.id,
          layout.modules.includes(block) ? 'block' : 'group',
        );
      }
    }
    this.selected = previous ? (this.items.get(previous.type + ':' + previous.key) ?? null) : null;
    for (const key of this.states.keys()) if (!this.items.has(key)) this.states.delete(key);
    for (const key of this.values.keys()) if (!this.items.has('port:' + key)) this.values.delete(key);
    if (oldCenter && this.selected && !fit) {
      const next = center(this.selected.box);
      this.camera.x += (oldCenter.x - next.x) * this.camera.scale;
      this.camera.y += (oldCenter.y - next.y) * this.camera.scale;
    }
    this.drawState();
    this.drawSelection();
    if (fit) this.fit();
    else this.refresh();
    if (focus) (this.items.get(focus)?.element ?? this.element).focus({ preventScroll: true });
    if (previous && !this.selected)
      this.emit('selectionchange', { selection: null, previous, reason: 'layout' });
    this.emit('layoutchange', { selection: this.selection });
    return this;
  }
  select(target, originalEvent = null) {
    this.assertAlive();
    const item = target === null ? null : this.resolve(target.type, target.key ?? target.id);
    if (same(item, this.selected)) return this;
    const previous = this.selection;
    this.selected = item;
    this.drawSelection();
    this.emit('selectionchange', {
      selection: this.selection,
      previous,
      originalEvent,
      reason: originalEvent ? 'interaction' : 'api',
    });
    return this;
  }
  activate(item, originalEvent) {
    this.select(item ? this.describe(item) : null, originalEvent);
    if (item)
      this.emit(item.type + 'click', { ...this.describe(item), data: clone(item.data), originalEvent });
    else this.emit('backgroundclick', { originalEvent });
  }
  drawSelection() {
    this.selectionLayer.replaceChildren();
    for (const item of this.items.values())
      item.element.setAttribute('aria-pressed', String(same(item, this.selected)));
    if (!this.selected) return;
    const item = this.selected;
    const attrs = {
      fill: 'none',
      stroke: 'var(--portsketch-accent,#2457d6)',
      'stroke-width': 2,
      'stroke-dasharray': '7 4',
      'vector-effect': 'non-scaling-stroke',
    };
    this.selectionLayer.append(
      item.type === 'connection'
        ? this.node('path', { d: routePath(item.data), ...attrs })
        : this.node('rect', {
            x: item.box.x - 4,
            y: item.box.y - 4,
            width: item.box.width + 8,
            height: item.box.height + 8,
            ...attrs,
          }),
    );
  }
  getState(type, id) {
    this.assertAlive();
    const item = this.resolve(type, id);
    return type === 'port'
      ? this.values.has(item.key)
        ? { value: this.values.get(item.key) }
        : null
      : clone(this.states.get(type + ':' + item.key) ?? null);
  }
  setBlockState(id, state) {
    return this.setState('block', id, state);
  }
  setGroupState(id, state) {
    return this.setState('group', id, state);
  }
  setConnectionState(id, state) {
    return this.setState('connection', id, state);
  }
  setState(type, id, patch) {
    this.assertAlive();
    const item = this.resolve(type, id),
      key = type + ':' + item.key;
    const previous = this.states.get(key) ?? null;
    let state = null;
    if (patch !== null) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch))
        throw new TypeError('State must be an object or null');
      for (const name of Object.keys(patch))
        if (!['status', 'highlight'].includes(name)) throw new TypeError('Unknown state property: ' + name);
      if (
        patch.status !== undefined &&
        (typeof patch.status !== 'string' || !patch.status.trim() || /[\x00-\x1f]/.test(patch.status))
      )
        throw new TypeError('Status must be non-blank single-line text');
      if (patch.highlight !== undefined && typeof patch.highlight !== 'boolean')
        throw new TypeError('Highlight must be boolean');
      state = { ...previous, ...clone(patch) };
      this.states.set(key, state);
    } else this.states.delete(key);
    this.drawState();
    this.emit('statechange', { target: this.describe(item), state, previous });
    return this;
  }
  setPortValue(id, value) {
    this.assertAlive();
    const item = this.resolve('port', id),
      previous = this.values.get(item.key) ?? null;
    if (value === null) this.values.delete(item.key);
    else {
      if (
        !['string', 'number', 'boolean'].includes(typeof value) ||
        (typeof value === 'number' && !Number.isFinite(value))
      )
        throw new TypeError('Port value must be text, a finite number, boolean or null');
      if (typeof value === 'string' && /[\x00-\x09\x0b-\x1f\ud800-\udfff]/u.test(value))
        throw new TypeError('Invalid port value text');
      this.values.set(item.key, value);
    }
    this.drawState();
    this.emit('statechange', {
      target: this.describe(item),
      state: value === null ? null : { value },
      previous: previous === null ? null : { value: previous },
    });
    return this;
  }
  clearState() {
    this.assertAlive();
    for (const key of [...this.states.keys()]) {
      const item = this.items.get(key);
      if (item && !this.destroyed) this.setState(item.type, item.key, null);
    }
    for (const key of [...this.values.keys()])
      if (!this.destroyed && this.items.has('port:' + key)) this.setPortValue(key, null);
    return this;
  }
  drawState() {
    this.stateLayer.replaceChildren();
    for (const item of this.items.values()) {
      const state = this.states.get(item.type + ':' + item.key);
      const value = item.type === 'port' ? this.values.get(item.key) : undefined;
      item.element.querySelectorAll('[data-value-hit]').forEach((node) => node.remove());
      item.element.removeAttribute('data-status');
      item.element.removeAttribute('data-highlight');
      item.element.removeAttribute('data-value');
      let label = item.label;
      if (state) {
        if (state.status) {
          item.element.setAttribute('data-status', state.status);
          label += ', status: ' + state.status;
        }
        if (state.highlight) item.element.setAttribute('data-highlight', 'true');
        const attrs = {
          fill: 'none',
          stroke: Object.hasOwn(colors, state.status)
            ? colors[state.status]
            : 'var(--portsketch-accent,#2457d6)',
          'stroke-width': 3,
          'vector-effect': 'non-scaling-stroke',
          ...(state.highlight ? { 'stroke-dasharray': '5 3' } : {}),
        };
        this.stateLayer.append(
          item.type === 'connection'
            ? this.node('path', { d: routePath(item.data), ...attrs })
            : this.node('rect', {
                x: item.box.x - 2,
                y: item.box.y - 2,
                width: item.box.width + 4,
                height: item.box.height + 4,
                ...attrs,
              }),
        );
      }
      if (value !== undefined) {
        const text = String(value) || '""',
          port = item.data;
        item.element.setAttribute('data-value', String(value));
        label += ', value: ' + text;
        const display = compact(text),
          size = textSize(display, TEXT_STYLE),
          x = port.x + (port.direction === 'input' ? -12 : 12),
          y = port.y - 16;
        const valueBox = {
          x: port.direction === 'input' ? x - size.width - 3 : x - 3,
          y: y - size.height / 2 - 2,
          width: size.width + 6,
          height: size.height + 4,
        };
        item.element.append(
          this.node('rect', {
            ...valueBox,
            class: 'hit-area',
            'data-value-hit': '',
            'vector-effect': 'non-scaling-stroke',
          }),
        );
        this.stateLayer.append(
          this.node('rect', {
            x: port.direction === 'input' ? x - size.width - 3 : x - 3,
            y: y - size.height / 2 - 2,
            width: size.width + 6,
            height: size.height + 4,
            fill: '#ffffff',
            stroke: '#d7dfe9',
          }),
        );
        this.stateLayer.append(
          this.node(
            'text',
            {
              x,
              y,
              'text-anchor': port.direction === 'input' ? 'end' : 'start',
              'dominant-baseline': 'central',
              'font-family': 'monospace',
              'font-size': 12,
              fill: '#18243b',
            },
            display,
          ),
        );
      }
      item.element.setAttribute('aria-label', label);
    }
  }
  dimensions() {
    return {
      width: this.element.clientWidth || this.lastSize?.width || this.currentLayout.width + 40,
      height: this.element.clientHeight || this.lastSize?.height || this.currentLayout.height + 40,
    };
  }
  refresh({ centerResize = true } = {}) {
    if (this.destroyed) return;
    const size = this.dimensions();
    const changed =
      this.lastSize && (size.width !== this.lastSize.width || size.height !== this.lastSize.height);
    if (changed && centerResize && !this.fitWhenVisible) {
      this.camera.x += (size.width - this.lastSize.width) / 2;
      this.camera.y += (size.height - this.lastSize.height) / 2;
    }
    this.lastSize = size;
    this.element.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
    if (this.fitWhenVisible && this.element.clientWidth && this.element.clientHeight) {
      this.fitWhenVisible = false;
      this.fit();
      return;
    }
    this.world.setAttribute(
      'transform',
      `translate(${this.camera.x} ${this.camera.y}) scale(${this.camera.scale})`,
    );
    if (changed && centerResize) this.emit('viewportchange', { viewport: this.viewport });
  }
  setViewport(viewport) {
    this.assertAlive();
    if (
      !viewport ||
      typeof viewport !== 'object' ||
      Array.isArray(viewport) ||
      Object.keys(viewport).some((key) => !['x', 'y', 'scale'].includes(key))
    )
      throw new TypeError('Viewport accepts x, y and scale');
    const next = { ...this.camera, ...viewport };
    if (![next.x, next.y, next.scale].every(Number.isFinite) || next.scale <= 0)
      throw new RangeError('Invalid viewport');
    next.scale = Math.max(this.minZoom, Math.min(this.maxZoom, next.scale));
    this.camera = next;
    this.fitWhenVisible = false;
    this.refresh({ centerResize: false });
    this.emit('viewportchange', { viewport: this.viewport });
    return this;
  }
  fit() {
    this.assertAlive();
    const size = this.dimensions(),
      layout = this.currentLayout;
    this.fitWhenVisible = !this.element.clientWidth || !this.element.clientHeight;
    const scale = Math.max(
      this.minZoom,
      Math.min(
        this.maxZoom,
        1.5,
        (size.width - 32) / (layout.width + 40),
        (size.height - 32) / (layout.height + 40),
      ),
    );
    this.camera = {
      scale,
      x: (size.width - layout.width * scale) / 2,
      y: (size.height - layout.height * scale) / 2,
    };
    this.refresh({ centerResize: false });
    this.emit('viewportchange', { viewport: this.viewport });
    return this;
  }
  zoom(factor, point) {
    this.assertAlive();
    if (!Number.isFinite(factor) || factor <= 0) throw new RangeError('Invalid zoom factor');
    const size = this.dimensions(),
      p = point ?? { x: size.width / 2, y: size.height / 2 };
    if (![p.x, p.y].every(Number.isFinite)) throw new RangeError('Invalid zoom point');
    const next = Math.max(this.minZoom, Math.min(this.maxZoom, this.camera.scale * factor)),
      ratio = next / this.camera.scale;
    return this.setViewport({
      scale: next,
      x: p.x - (p.x - this.camera.x) * ratio,
      y: p.y - (p.y - this.camera.y) * ratio,
    });
  }
  pan(dx, dy) {
    if (![dx, dy].every(Number.isFinite)) throw new RangeError('Invalid pan');
    return this.setViewport({ x: this.camera.x + dx, y: this.camera.y + dy });
  }
  reveal(item) {
    const box =
      item.type === 'group' && !item.data.collapsed
        ? item.data.labelBounds
        : item.type === 'connection'
          ? (item.data.labelBounds ?? { ...item.data.sections[0].points[0], width: 0, height: 0 })
          : item.box;
    const size = this.dimensions(),
      scale = this.camera.scale;
    const bounds = {
      x: box.x * scale + this.camera.x,
      y: box.y * scale + this.camera.y,
      width: box.width * scale,
      height: box.height * scale,
    };
    const offset = (start, length, total) =>
      length > total - 32
        ? total / 2 - start - length / 2
        : start < 16
          ? 16 - start
          : start + length > total - 16
            ? total - 16 - start - length
            : 0;
    const dx = offset(bounds.x, bounds.width, size.width),
      dy = offset(bounds.y, bounds.height, size.height);
    if (dx || dy) this.pan(dx, dy);
  }
  listen(target, name, handler, options) {
    target.addEventListener(name, handler, options);
    this.bindings.push(() => target.removeEventListener(name, handler, options));
  }
  bind() {
    const element = this.element;
    const item = (event) =>
      this.items.get(event.target.closest?.('[data-hit]')?.getAttribute('data-target')) ?? null;
    this.listen(
      element,
      'wheel',
      (event) => {
        event.preventDefault();
        const rect = element.getBoundingClientRect();
        this.zoom(Math.exp(-event.deltaY * 0.0015), {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      },
      { passive: false },
    );
    this.listen(element, 'focusin', (event) => {
      const target = item(event);
      if (target && !this.focusingPointer) this.reveal(target);
    });
    this.listen(element, 'pointerdown', (event) => {
      if (event.button !== 0 || this.drag) return;
      event.preventDefault();
      const target = item(event);
      this.focusingPointer = true;
      (target?.element ?? element).focus({ preventScroll: true });
      this.focusingPointer = false;
      this.drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        camera: this.viewport,
        target,
        moved: false,
      };
      element.setPointerCapture(event.pointerId);
    });
    this.listen(element, 'pointermove', (event) => {
      const drag = this.drag;
      if (!drag || drag.id !== event.pointerId) return;
      drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 4;
      if (drag.moved)
        this.setViewport({
          x: drag.camera.x + event.clientX - drag.x,
          y: drag.camera.y + event.clientY - drag.y,
        });
    });
    this.listen(element, 'pointerup', (event) => {
      const drag = this.drag;
      if (!drag || drag.id !== event.pointerId) return;
      this.drag = null;
      if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4)
        this.activate(drag.target, event);
    });
    for (const name of ['pointercancel', 'lostpointercapture'])
      this.listen(element, name, () => {
        this.drag = null;
      });
    this.listen(element, 'click', (event) => {
      if (event.detail === 0) this.activate(item(event), event);
    });
    this.listen(element, 'keydown', (event) => {
      if (event.isComposing || event.defaultPrevented) return;
      const target = item(event);
      if (target && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        if (!event.repeat) this.activate(target, event);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.select(null, event);
        return;
      }
      if (['+', '=', '-'].includes(event.key)) {
        event.preventDefault();
        this.zoom(event.key === '-' ? 0.8 : 1.25);
      }
      if (event.key === '0') {
        event.preventDefault();
        this.fit();
      }
      const deltas = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
      if (deltas[event.key]) {
        event.preventDefault();
        this.pan(...deltas[event.key]);
      }
    });
    this.listen(element, 'selectstart', (event) => event.preventDefault());
    this.listen(element, 'dragstart', (event) => event.preventDefault());
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resize?.disconnect();
    this.bindings.forEach((remove) => remove());
    if (this.drag && this.element.hasPointerCapture(this.drag.id))
      this.element.releasePointerCapture(this.drag.id);
    this.drag = null;
    this.events.clear();
    this.states.clear();
    this.values.clear();
    this.items.clear();
    this.aliases.clear();
    this.selected = null;
    this.currentLayout = null;
    this.element.replaceChildren();
    this.element.remove();
  }
}
