import { button, singleLine } from './ui.js';
const NS = 'http://www.w3.org/2000/svg';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class Preview {
  constructor(host, onSelect, onZoom, onSelectConnection, actions = {}) {
    this.host = host;
    this.onSelect = onSelect;
    this.onZoom = onZoom;
    this.onSelectConnection = onSelectConnection;
    this.actions = actions;
    this.selectedConnection = null;
    this.scale = 1;
    this.x = 0;
    this.y = 0;
    this.layout = null;
    this.cameras = new Map();
    this.selected = null;
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.classList.add('preview-canvas');
    this.svg.setAttribute(
      'aria-label',
      'Diagram preview: scroll to zoom, drag to pan; arrow keys pan, 0 fits the view',
    );
    this.svg.setAttribute('role', 'group');
    this.svg.setAttribute('tabindex', '0');
    this.world = document.createElementNS(NS, 'g');
    this.svg.append(this.world);
    host.append(this.svg);
    this.groupControls = document.createElement('div');
    this.groupControls.className = 'preview-group-controls';
    host.append(this.groupControls);
    this.groupControls.addEventListener('click', (event) => {
      const control = event.target.closest('[data-preview-group]');
      if (!control || control.disabled) return;
      event.stopPropagation();
      this.lastClick = null;
      this.actions.onToggleGroup?.(control.dataset.previewGroup);
    });
    this.groupControls.addEventListener('dblclick', (event) => event.stopPropagation());
    this.groupControls.addEventListener('pointerover', (event) => {
      const control = event.target.closest('[data-preview-group]');
      if (control) this.hoverGroup({ kind: 'group', id: control.dataset.previewGroup });
    });
    this.groupControls.addEventListener('pointerout', (event) => {
      if (!event.relatedTarget?.closest?.('[data-preview-group]')) this.hoverGroup(null);
    });
    this.host.ownerDocument.addEventListener('pointerdown', (event) => {
      if (!this.svg.contains(event.target)) {
        this.lastClick = null;
        this.doubleClickTarget = null;
      }
    });
    this.host.addEventListener('pointerleave', () => this.hoverGroup(null));
    this.resize = new ResizeObserver(() => this.refreshSize());
    this.resize.observe(host);
    this.svg.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.lastClick = null;
        this.doubleClickTarget = null;
        const box = this.svg.getBoundingClientRect();
        this.zoom(Math.exp(-event.deltaY * 0.0015), event.clientX - box.left, event.clientY - box.top);
      },
      { passive: false },
    );
    this.svg.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const selection = window.getSelection();
      if (selection?.anchorNode && this.svg.contains(selection.anchorNode)) selection.removeAllRanges();
      const target = this.hitTarget(event.target);
      (this.targetElement(target) ?? this.svg).focus({ preventScroll: true });
      if (target && target.kind !== 'connection') this.onSelect(target.id);
      this.drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startX: this.x,
        startY: this.y,
        moved: false,
        target,
        pan: !target || target.kind === 'connection',
      };
      this.svg.setPointerCapture(event.pointerId);
      if (this.drag.pan) this.host.classList.add('panning');
    });
    this.svg.addEventListener('pointermove', (event) => {
      if (!this.drag) this.hoverGroup(this.hitTarget(event.target));
      if (!this.drag || event.pointerId !== this.drag.id) return;
      this.drag.moved ||= Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y) >= 4;
      if (!this.drag.moved || !this.drag.pan) return;
      this.x = this.drag.startX + event.clientX - this.drag.x;
      this.y = this.drag.startY + event.clientY - this.drag.y;
      this.transform();
    });
    const release = () => {
      if (this.drag) {
        this.lastClick = null;
        this.doubleClickTarget = null;
      }
      this.drag = null;
      this.host.classList.remove('panning');
    };
    this.svg.addEventListener('pointerup', (event) => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      const click =
        !this.drag.moved && Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y) < 4;
      const target = this.drag.target;
      const previousClick = this.lastClick;
      release();
      if (!click) return;
      this.lastClick = previousClick;
      if (target?.kind === 'connection') this.onSelectConnection?.(target.id);
      else if (!target) this.onSelect(null);
      this.clicked(target, event);
    });
    this.svg.addEventListener('pointercancel', release);
    this.svg.addEventListener('lostpointercapture', release);
    this.svg.addEventListener('dblclick', (event) => {
      event.preventDefault();
      const target = this.doubleClickTarget;
      this.doubleClickTarget = null;
      this.lastClick = null;
      if (target) this.actions.onStyle?.(target);
    });
    this.svg.addEventListener('contextmenu', (event) => {
      const target = this.hitTarget(event.target);
      if (!target) return;
      event.preventDefault();
      this.lastClick = null;
      this.actions.onContextMenu?.(target, { x: event.clientX, y: event.clientY });
    });
    this.svg.addEventListener('selectstart', (event) => event.preventDefault());
    this.svg.addEventListener('dragstart', (event) => event.preventDefault());
    this.svg.addEventListener('keydown', (event) => {
      this.lastClick = null;
      this.doubleClickTarget = null;
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        const target = this.hitTarget(event.target);
        if (target) {
          event.preventDefault();
          const box = event.target.getBoundingClientRect();
          this.actions.onContextMenu?.(target, { x: box.left + box.width / 2, y: box.top + box.height / 2 });
        }
        return;
      }
      const edge = event.target.closest('[data-edge]');
      if (edge && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        this.onSelectConnection?.(edge.dataset.edge);
        return;
      }
      const target = event.target.closest('[data-module]');
      if (target && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        this.onSelect(target.dataset.module);
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
      const offsets = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
      if (offsets[event.key]) {
        event.preventDefault();
        this.x += offsets[event.key][0];
        this.y += offsets[event.key][1];
        this.transform();
      }
    });
  }

  hitTarget(element) {
    const node = element.closest('[data-module]');
    if (node)
      return {
        kind: this.layout?.groups?.some((group) => group.id === node.dataset.module) ? 'group' : 'module',
        id: node.dataset.module,
      };
    const edge = element.closest('[data-edge]');
    return edge ? { kind: 'connection', id: edge.dataset.edge } : null;
  }

  targetElement(target) {
    if (!target) return null;
    return (
      [
        ...this.world.querySelectorAll(target.kind === 'connection' ? '.connection-hit' : '[data-module]'),
      ].find(
        (element) =>
          (target.kind === 'connection' ? element.dataset.edge : element.dataset.module) === target.id,
      ) ?? null
    );
  }

  focusTarget(target) {
    const control = target?.disclosure
      ? [...this.groupControls.querySelectorAll('[data-preview-group]')].find(
          (control) => control.dataset.previewGroup === target.id,
        )
      : null;
    if (control && !control.hidden && !control.disabled) {
      control.focus({ preventScroll: true });
      return;
    }
    const element = this.targetElement(target);
    (element ?? this.svg).focus({ preventScroll: true });
  }

  clicked(target, event) {
    const previous = this.lastClick;
    this.doubleClickTarget = null;
    this.lastClick = target ? { ...target, time: event.timeStamp, x: event.clientX, y: event.clientY } : null;
    if (
      !target ||
      !previous ||
      previous.kind !== target.kind ||
      previous.id !== target.id ||
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) >= 4
    )
      return;
    this.lastClick = null;
    this.doubleClickTarget = target;
  }

  hoverGroup(target) {
    clearTimeout(this.hoverTimer);
    const update = () => {
      this.hoveredGroup = target?.kind === 'group' ? target.id : null;
      this.updateGroupControls();
    };
    if (target?.kind === 'group') update();
    else this.hoverTimer = setTimeout(update, 150);
  }

  renderGroupControls() {
    this.groupControls.innerHTML = (this.layout?.groups ?? [])
      .filter(
        (group) => group.id !== this.layout.rootGroupId && ['boundary', 'collection'].includes(group.type),
      )
      .map((group) =>
        button(
          'preview-group-toggle',
          (group.collapsed ? 'Show contents: ' : 'Hide contents: ') + singleLine(group.label),
          {
            glyph: 'down',
            iconOnly: true,
            className: 'preview-group-control outline',
            attrs: 'data-preview-group="' + group.id + '" aria-expanded="' + !group.collapsed + '"',
          },
        ),
      )
      .join('');
    this.updateGroupControls();
  }

  updateGroupControls() {
    for (const control of this.groupControls.querySelectorAll('[data-preview-group]')) {
      const group = this.layout?.groups?.find((group) => group.id === control.dataset.previewGroup);
      if (!group) continue;
      control.classList.toggle('is-visible', group.id === this.selected || group.id === this.hoveredGroup);
      control.disabled = this.actionsEnabled === false;
      control.style.left = this.x + (group.x + group.width) * this.scale + 4 + 'px';
      control.style.top = this.y + group.y * this.scale + 3 + 'px';
      const left = parseFloat(control.style.left),
        top = parseFloat(control.style.top);
      control.hidden =
        left < 0 || top < 0 || left + 26 > this.host.clientWidth || top + 26 > this.host.clientHeight;
    }
  }

  setActionsEnabled(enabled) {
    this.actionsEnabled = enabled;
    this.updateGroupControls();
  }

  transform() {
    this.world.setAttribute('transform', `translate(${this.x} ${this.y}) scale(${this.scale})`);
    this.onZoom?.(Math.round(this.scale * 100));
    this.updateGroupControls();
  }

  refreshSize() {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width <= 0 || height <= 0) return;
    if (this.layout && this.lastSize) {
      this.x += (width - this.lastSize.width) / 2;
      this.y += (height - this.lastSize.height) / 2;
    }
    this.lastSize = { width, height };
    if (this.pendingResult) {
      const pending = this.pendingResult;
      this.pendingResult = null;
      this.setResult(pending.layout, pending.svg, pending.reset);
    } else if (this.fitWhenVisible) {
      this.fitWhenVisible = false;
      this.fit();
    } else this.transform();
  }

  zoom(factor, x = this.host.clientWidth / 2, y = this.host.clientHeight / 2) {
    const next = clamp(this.scale * factor, 0.08, 8);
    this.x = x - ((x - this.x) * next) / this.scale;
    this.y = y - ((y - this.y) * next) / this.scale;
    this.scale = next;
    this.transform();
  }

  fit() {
    if (!this.layout) return;
    if (!this.host.clientWidth || !this.host.clientHeight) {
      this.fitWhenVisible = true;
      return;
    }
    this.scale = clamp(
      Math.min(
        (this.host.clientWidth - 64) / (this.layout.width + 40),
        (this.host.clientHeight - 64) / (this.layout.height + 40),
        1.5,
      ),
      0.08,
      8,
    );
    this.x = (this.host.clientWidth - this.layout.width * this.scale) / 2;
    this.y = (this.host.clientHeight - this.layout.height * this.scale) / 2;
    this.transform();
  }

  select(id) {
    this.selected = id;
    this.selectedConnection = null;
    this.updateGroupControls();
    this.world
      .querySelectorAll('.connection-selection-outline, .connection-selection-halo')
      .forEach((item) => item.remove());
    this.world.querySelectorAll('.selection-outline').forEach((item) => item.remove());
    const node = [...(this.layout?.modules ?? []), ...(this.layout?.groups ?? [])].find(
      (module) => module.id === id,
    );
    if (!node) return;
    const rect = document.createElementNS(NS, 'rect');
    for (const [key, value] of Object.entries({
      x: node.x - 5,
      y: node.y - 5,
      width: node.width + 10,
      height: node.height + 10,
      rx: 3,
    }))
      rect.setAttribute(key, value);
    rect.classList.add('selection-outline');
    rect.setAttribute('vector-effect', 'non-scaling-stroke');
    this.world.append(rect);
  }

  selectConnection(key) {
    this.select(null);
    this.selectedConnection = key;
    const edge = this.layout?.connections.find((edge) => edge.editorKey === key);
    if (!edge) return;
    for (const className of ['connection-selection-halo', 'connection-selection-outline']) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', this.edgePath(edge));
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      path.classList.add(className);
      this.world.append(path);
    }
  }

  edgePath(edge) {
    return edge.sections
      .map((section) => section.points.map((point, i) => `${i ? 'L' : 'M'}${point.x} ${point.y}`).join(' '))
      .join(' ');
  }

  renameBlock(previous, next) {
    if (previous === next) return;
    for (const layout of [this.layout, this.pendingResult?.layout]) {
      const module = layout?.modules.find((item) => item.id === previous);
      if (module) module.id = next;
    }
    for (const hit of this.world.querySelectorAll('[data-module]')) {
      if (hit.dataset.module === previous) hit.dataset.module = next;
    }
    if (this.selected === previous) this.selected = next;
  }

  setResult(layout, svg, reset = false) {
    if (!this.host.clientWidth || !this.host.clientHeight) {
      this.pendingResult = { layout, svg, reset: reset || !!this.pendingResult?.reset };
      return;
    }
    const scope = layout.rootGroupId ?? null;
    let previous = this.layout;
    if (reset) {
      this.cameras.clear();
      previous = null;
    } else if (scope !== (this.layout?.rootGroupId ?? null)) {
      if (this.layout)
        this.cameras.set(this.layout.rootGroupId ?? null, {
          layout: this.layout,
          scale: this.scale,
          x: this.x,
          y: this.y,
          width: this.host.clientWidth,
          height: this.host.clientHeight,
        });
      const camera = this.cameras.get(scope);
      previous = camera?.layout ?? null;
      if (camera) {
        this.scale = camera.scale;
        this.x = camera.x + (this.host.clientWidth - camera.width) / 2;
        this.y = camera.y + (this.host.clientHeight - camera.height) / 2;
      }
      this.focusAfterLayout = null;
      this.lastClick = null;
      this.doubleClickTarget = null;
    }
    const nextItems = [...layout.modules, ...(layout.groups ?? [])];
    const survivors = [...(previous?.modules ?? []), ...(previous?.groups ?? [])].filter((m) =>
      nextItems.some((n) => n.id === m.id),
    );
    const center = {
      x: (this.host.clientWidth / 2 - this.x) / this.scale,
      y: (this.host.clientHeight / 2 - this.y) / this.scale,
    };
    const anchor =
      survivors.find((m) => m.id === this.selected) ??
      survivors.sort(
        (a, b) =>
          Math.hypot(a.x + a.width / 2 - center.x, a.y + a.height / 2 - center.y) -
          Math.hypot(b.x + b.width / 2 - center.x, b.y + b.height / 2 - center.y),
      )[0];
    this.layout = layout;
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    this.world.replaceChildren(
      ...Array.from(doc.documentElement.childNodes).map((node) => document.importNode(node, true)),
    );
    for (const group of (layout.groups ?? []).filter((group) => !group.collapsed)) {
      const hit = document.createElementNS(NS, 'rect');
      for (const key of ['x', 'y', 'width']) hit.setAttribute(key, group[key]);
      hit.setAttribute('height', group.labelBounds.y + group.labelBounds.height + 8 - group.y);
      hit.classList.add('group-hit');
      hit.dataset.module = group.id;
      hit.setAttribute('tabindex', '0');
      hit.setAttribute('role', 'button');
      hit.setAttribute('aria-label', 'Select group ' + group.label);
      this.world.append(hit);
    }
    for (const edge of layout.connections) {
      if (!edge.editorKey) continue;
      const hit = document.createElementNS(NS, 'path');
      hit.setAttribute('d', this.edgePath(edge));
      hit.setAttribute('vector-effect', 'non-scaling-stroke');
      hit.setAttribute('tabindex', '0');
      hit.setAttribute('role', 'button');
      hit.setAttribute('aria-label', `Select connection ${edge.editorLabel}`);
      hit.classList.add('connection-hit');
      hit.dataset.edge = edge.editorKey;
      this.world.append(hit);
      const label = [...this.world.querySelectorAll('[data-role="connection-label"]')].find(
        (node) => node.dataset.connection === edge.id,
      );
      if (label) {
        label.dataset.edge = edge.editorKey;
        label.classList.add('connection-label-hit');
        label.setAttribute('tabindex', '-1');
        label.setAttribute('role', 'button');
        label.setAttribute('aria-label', `Select connection ${edge.editorLabel}: ${edge.label}`);
      }
    }
    for (const module of [...layout.modules, ...(layout.groups ?? []).filter((group) => group.collapsed)]) {
      const hit = document.createElementNS(NS, 'rect');
      for (const key of ['x', 'y', 'width', 'height']) hit.setAttribute(key, module[key]);
      hit.classList.add(module.collapsed ? 'group-hit' : 'block-hit');
      if (module.collapsed) hit.classList.add('collapsed-group-hit');
      hit.dataset.module = module.id;
      hit.setAttribute('tabindex', '0');
      hit.setAttribute('role', 'button');
      hit.setAttribute(
        'aria-label',
        module.collapsed ? `Select group ${module.label}` : `Select ${module.label}`,
      );
      this.world.append(hit);
    }
    for (const group of layout.groups ?? [])
      for (const port of group.ports ?? []) {
        const hit = document.createElementNS(NS, 'g');
        hit.classList.add('group-port-hit');
        hit.dataset.module = group.id;
        hit.setAttribute('tabindex', '0');
        hit.setAttribute('role', 'button');
        hit.setAttribute(
          'aria-label',
          port.virtual ? 'Select collection ' + group.label : 'Select group port ' + group.id + '.' + port.id,
        );
        const rect = document.createElementNS(NS, 'rect');
        for (const key of ['x', 'y', 'width', 'height']) rect.setAttribute(key, port.labelBounds[key]);
        const circle = document.createElementNS(NS, 'circle');
        circle.setAttribute('cx', port.x);
        circle.setAttribute('cy', port.y);
        circle.setAttribute('r', 8);
        hit.append(rect, circle);
        this.world.append(hit);
      }
    this.renderGroupControls();
    if (reset || !previous) this.fit();
    else if (anchor) {
      const next = nextItems.find((m) => m.id === anchor.id);
      this.x += (anchor.x + anchor.width / 2 - (next.x + next.width / 2)) * this.scale;
      this.y += (anchor.y + anchor.height / 2 - (next.y + next.height / 2)) * this.scale;
      this.transform();
    }
    if (this.selectedConnection !== null) this.selectConnection(this.selectedConnection);
    else this.select(this.selected);
    if (this.focusAfterLayout) {
      const target = this.focusAfterLayout;
      this.focusAfterLayout = null;
      // Wait for the app to enable fresh actions; respect a later focus change.
      requestAnimationFrame(() => {
        if (
          !document.querySelector('dialog[open]') &&
          (this.svg.contains(document.activeElement) ||
            this.groupControls.contains(document.activeElement) ||
            document.activeElement === document.body)
        )
          this.focusTarget(target);
      });
    }
  }

  clear() {
    this.layout = null;
    this.pendingResult = null;
    this.world.replaceChildren();
    this.groupControls.replaceChildren();
    this.lastClick = null;
  }
}
