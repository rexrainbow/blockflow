import { s } from '../../ui/dom.js';
import { CanvasBase, pathOf, pad } from '../../core/canvas.js';
import { addEdge, addNode, placeNode, placeGroup, reconnectEdge, attachNote } from '../../../editor/flowchart/commands.js';
import { ancestors, displayName, findNode, findGroup, parentOf, findEdge, groupAndDescendants, SIDES } from '../state/actions.js';

const HANDLE = 6;

/**
 * Flowchart overlay on the exported SVG. Steps (nodes), notes, groups and edges are hit
 * targets. A selected or hovered step shows four connection handles: drag one onto
 * another step to add an edge, or onto empty space to add a connected step there. Drag
 * a step onto a group to move it; drag a note onto a step to attach it; drag either end
 * of a selected edge onto a step to reconnect it. ELK decides every position.
 */
export class FlowchartCanvas extends CanvasBase {
  margin = 0;
  /** What the user calls a node (tooltips); a Statechart subclass says "state". */
  noun = 'step';
  /** Runtime commands the drags check and describe; a subclass maps its own domain. */
  ops = {
    connect: (doc, from, to) => addEdge(doc, from, to),
    reconnect: (doc, key, end, node) => reconnectEdge(doc, key, end, node),
    addConnected: (doc, from, group) => {
      const next = addNode(doc, {}, group);
      return addEdge(next, from, next.nodes.at(-1).id);
    },
  };

  nameOf(doc, id) {
    return displayName(findNode(doc, id) ?? findGroup(doc, id) ?? { id });
  }

  edgeOf(doc, key) {
    return findEdge(doc, key);
  }

  selKey(sel) {
    return !sel ? '' : sel.type === 'edge' ? `edge:${sel.key}` : `${sel.type}:${sel.id}`;
  }

  /* ---------------- overlay ---------------- */
  /** Path data for one edge's hit area and selection outline: the routed sections. */
  edgePaths(e) {
    return e.sections.map((section) => pathOf(section.points));
  }

  buildHits(L, doc) {
    const hits = [];
    const rect = (b, props) => s('rect', { x: b.x, y: b.y, width: Math.max(1, b.width), height: Math.max(1, b.height), ...props });
    const depth = (id) => ancestors(doc, id).length;
    const groups = [...(L.groups ?? [])].sort((a, b) => depth(a.id) - depth(b.id));
    for (const g of groups) {
      hits.push(rect(g, { class: 'hit hit-group', 'data-hit': 'group', 'data-id': g.id }));
      const title = { x: g.x, y: g.y, width: g.width, height: Math.max(18, (g.labelBounds?.y ?? g.y) - g.y + (g.labelBounds?.height ?? 18) + 4) };
      hits.push(rect(title, { class: 'hit hit-group-title', 'data-hit': 'group-title', 'data-id': g.id }));
    }
    for (const e of L.edges) {
      for (const d of this.edgePaths(e))
        hits.push(s('path', { d, class: 'hit hit-net', 'data-hit': 'edge', 'data-key': e.editorKey, 'vector-effect': 'non-scaling-stroke' }));
      if (e.labelBounds) hits.push(rect(pad(e.labelBounds, 2), { class: 'hit hit-label', 'data-hit': 'edge', 'data-key': e.editorKey }));
    }
    for (const n of L.nodes) hits.push(rect(n, { class: ['hit hit-node', n.type === 'note' && 'hit-note'].filter(Boolean).join(' '), 'data-hit': n.type === 'note' ? 'note' : 'node', 'data-id': n.id }));
    this.handleLayer = s('g', { class: 'handles' });
    return { hits, top: [this.handleLayer] };
  }

  /** Connection handles of one step, and the end handles of a selected edge. */
  renderHandles() {
    if (!this.handleLayer || !this.layout) return;
    const out = [];
    const r = Math.max(4, Math.min(10, HANDLE / this.camera.z));
    const sel = this.store.selection;
    const ids = new Set([sel?.type === 'node' ? sel.id : null, this.hoverId].filter(Boolean));
    for (const id of ids) {
      const n = this.layout.nodes.find((x) => x.id === id);
      if (!n || n.type === 'note') continue;
      for (const side of SIDES) {
        const p = sidePoint(n, side);
        out.push(s('circle', { cx: p.x, cy: p.y, r, class: 'hit hit-handle', 'data-hit': 'handle', 'data-id': id, 'data-side': side }));
      }
    }
    if (sel?.type === 'edge') {
      const e = this.layout.edges.find((x) => x.editorKey === sel.key);
      const pts = e?.sections.flatMap((x) => x.points) ?? [];
      if (pts.length)
        for (const [end, p] of [['from', pts[0]], ['to', pts.at(-1)]])
          out.push(s('circle', { cx: p.x, cy: p.y, r, class: 'hit hit-handle edge-end', 'data-hit': 'edge-end', 'data-key': sel.key, 'data-end': end }));
    }
    this.handleLayer.replaceChildren(...out);
  }

  updateZoomSized() {
    this.renderHandles();
  }

  renderSelection() {
    super.renderSelection();
    this.renderHandles();
  }

  boundsOf(sel, L = this.layout) {
    if (!sel || !L) return null;
    if (sel.type === 'node') return L.nodes.find((n) => n.id === sel.id) ?? null;
    if (sel.type === 'group') return L.groups?.find((g) => g.id === sel.id) ?? null;
    if (sel.type === 'edge') {
      const e = L.edges.find((x) => x.editorKey === sel.key);
      const pts = e?.sections.flatMap((x) => x.points) ?? [];
      if (!pts.length) return null;
      const xs = pts.map((p) => p.x),
        ys = pts.map((p) => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
    return null;
  }

  selectionShapes(sel, L) {
    if (sel.type !== 'edge') return super.selectionShapes(sel, L);
    const out = [];
    for (const e of L.edges.filter((x) => x.editorKey === sel.key))
      for (const d of this.edgePaths(e)) {
        out.push(s('path', { d, class: 'sel-net-halo', 'vector-effect': 'non-scaling-stroke' }));
        out.push(s('path', { d, class: 'sel-net', 'vector-effect': 'non-scaling-stroke' }));
      }
    return out;
  }

  renameBounds(sel) {
    const L = this.layout;
    if (sel.type === 'node') return L.nodes.find((n) => n.id === sel.id)?.labelBounds;
    if (sel.type === 'group') return L.groups?.find((g) => g.id === sel.id)?.labelBounds;
    if (sel.type === 'edge') return L.edges.find((e) => e.editorKey === sel.key)?.labelBounds ?? this.edgeMidpoint(sel.key);
    return null;
  }

  edgeMidpoint(key) {
    const pts = this.layout.edges.find((e) => e.editorKey === key)?.sections.flatMap((x) => x.points) ?? [];
    if (pts.length < 2) return null;
    const i = Math.floor((pts.length - 1) / 2);
    const a = pts[i],
      b = pts[i + 1];
    return { x: (a.x + b.x) / 2 - 30, y: (a.y + b.y) / 2 - 10, width: 60, height: 20 };
  }

  selectionFromHit(hit) {
    if (!hit) return null;
    const kind = hit.dataset.hit;
    if (kind === 'node' || kind === 'note' || kind === 'handle') return { type: 'node', id: hit.dataset.id };
    if (kind === 'group' || kind === 'group-title') return { type: 'group', id: hit.dataset.id };
    if (kind === 'edge' || kind === 'edge-end') return { type: 'edge', key: hit.dataset.key };
    return null;
  }

  navItems(L) {
    return L.nodes.map((n) => ({ sel: { type: 'node', id: n.id }, b: n }));
  }

  bind() {
    super.bind();
    // Hover shows a step's connection handles (the selected step always shows them).
    this.el.addEventListener('pointermove', (event) => {
      if (this.drag || event.buttons) return;
      const hit = this.hitAt(event.clientX, event.clientY);
      const id = hit && ['node', 'handle'].includes(hit.dataset.hit) ? hit.dataset.id : null;
      if (id !== this.hoverId) {
        this.hoverId = id;
        this.renderHandles();
      }
    });
    this.el.addEventListener('pointerleave', () => {
      if (this.hoverId && !this.drag) {
        this.hoverId = null;
        this.renderHandles();
      }
    });
  }

  /* ---------------- dragging ---------------- */
  dragKind(hit) {
    const kind = hit?.dataset.hit;
    if (kind === 'handle') return 'connect';
    if (kind === 'edge-end') return 'reconnect';
    if (kind === 'node' || kind === 'note' || kind === 'group-title') return 'move';
    return null;
  }

  beginDrag(mode, hit) {
    this.toolbar.hidden = true;
    if (mode === 'connect') {
      const n = this.layout.nodes.find((x) => x.id === hit.dataset.id);
      this.drag = { mode, from: n.id, origin: sidePoint(n, hit.dataset.side), plans: new Map() };
      this.startGhostLine();
      this.el.classList.add('connecting');
    } else if (mode === 'reconnect') {
      const key = hit.dataset.key,
        end = hit.dataset.end;
      const edge = this.edgeOf(this.store.document, key);
      const fixed = this.layout.nodes.find((x) => x.id === (end === 'from' ? edge.to : edge.from));
      this.drag = { mode, key, end, origin: { x: fixed.x + fixed.width / 2, y: fixed.y + fixed.height / 2 }, plans: new Map() };
      this.startGhostLine();
      this.el.classList.add('connecting');
    } else {
      const id = hit.dataset.id;
      const isGroup = hit.dataset.hit === 'group-title';
      const b = isGroup ? this.layout.groups.find((x) => x.id === id) : this.layout.nodes.find((x) => x.id === id);
      const excluded = new Set(isGroup ? groupAndDescendants(this.store.document, id) : []);
      this.drag = { mode, id, isGroup, excluded, note: hit.dataset.hit === 'note', b, plans: new Map(), start: null };
      this.ghostRect = s('rect', { class: 'ghost-node', x: b.x, y: b.y, width: b.width, height: b.height, 'vector-effect': 'non-scaling-stroke' });
      this.dropRect = s('rect', { class: 'ghost-drop', 'vector-effect': 'non-scaling-stroke' });
      this.ghost.replaceChildren(this.dropRect, this.ghostRect);
      this.el.classList.add('moving');
    }
  }

  startGhostLine() {
    this.ghostLine = s('path', { class: 'ghost-line', 'vector-effect': 'non-scaling-stroke' });
    this.ghostEnd = s('circle', { class: 'ghost-end', r: 4 });
    this.dropRect = s('rect', { class: 'ghost-drop', 'vector-effect': 'non-scaling-stroke' });
    this.ghost.replaceChildren(this.dropRect, this.ghostLine, this.ghostEnd);
  }

  /** Deepest group containing a layout point. */
  groupAt(point, exclude = new Set()) {
    const doc = this.store.document;
    return (this.layout.groups ?? [])
      .filter((g) => !exclude.has(g.id) && point.x >= g.x && point.x <= g.x + g.width && point.y >= g.y && point.y <= g.y + g.height)
      .sort((a, b) => ancestors(doc, b.id).length - ancestors(doc, a.id).length)[0] ?? null;
  }

  nodeAt(event) {
    const hit = this.hitAt(event.clientX, event.clientY);
    return hit && ['node', 'note', 'handle'].includes(hit.dataset.hit) ? hit.dataset.id : null;
  }

  /** Runs a command on the current document to check it (cached per target); never commits. */
  check(key, attempt) {
    const d = this.drag;
    if (!d.plans.has(key)) {
      try {
        attempt(this.store.document);
        d.plans.set(key, { ok: true });
      } catch (error) {
        d.plans.set(key, { ok: false, message: error.message });
      }
    }
    return d.plans.get(key);
  }

  showDrop(b) {
    if (!b) return (this.dropRect.style.display = 'none');
    for (const [k, v] of Object.entries({ x: b.x, y: b.y, width: b.width, height: b.height })) this.dropRect.setAttribute(k, v);
    this.dropRect.style.display = '';
  }

  updateDrag(mode, event, p) {
    const d = this.drag;
    const doc = this.store.document;
    const point = this.toLayout(p.x, p.y);
    const name = (id) => this.nameOf(doc, id);
    if (mode === 'move') {
      d.start ??= point;
      this.ghostRect.setAttribute('x', d.b.x + point.x - d.start.x);
      this.ghostRect.setAttribute('y', d.b.y + point.y - d.start.y);
      const over = this.nodeAt(event);
      if (d.note && over && over !== d.id && findNode(doc, over)?.type !== 'note') {
        d.target = { attach: over };
        const plan = this.check('attach:' + over, (x) => attachNote(x, d.id, over));
        this.showDrop(this.layout.nodes.find((n) => n.id === over));
        return this.showTip(p, plan.ok ? `Attach note to ${name(over)}` : plan.message, !plan.ok);
      }
      const g = this.groupAt(point, d.excluded);
      const group = g?.id ?? '';
      d.target = { group };
      this.showDrop(g);
      if (d.note) return this.showTip(p, 'Drop on a step to attach this note to it', false);
      const current = parentOf(doc, d.id) ?? '';
      if (group === current) return this.showTip(p, `Already in ${group ? name(group) : 'the top level'} — layout decides position`);
      const plan = this.check('place:' + group, (x) => (d.isGroup ? placeGroup : placeNode)(x, d.id, group || null));
      return this.showTip(p, plan.ok ? `Move into ${group ? name(group) : 'the top level'}` : plan.message, !plan.ok);
    }
    // connect / reconnect: a line from the origin to the pointer or the step under it
    const over = this.nodeAt(event);
    let end = point;
    let tip, bad;
    if (over) {
      const n = this.layout.nodes.find((x) => x.id === over);
      end = { x: n.x + n.width / 2, y: n.y + n.height / 2 };
      this.showDrop(n);
      d.target = { node: over };
      const plan =
        mode === 'connect'
          ? this.check('to:' + over, (x) => this.ops.connect(x, d.from, over))
          : this.check('to:' + over, (x) => this.ops.reconnect(x, d.key, d.end, over));
      tip = plan.ok ? (mode === 'connect' ? `Connect ${name(d.from)} → ${name(over)}` : `Move this end to ${name(over)}`) : plan.message;
      bad = !plan.ok;
    } else if (mode === 'connect') {
      const g = this.groupAt(point);
      d.target = { create: g?.id ?? '' };
      this.showDrop(null);
      const plan = this.check('new:' + (g?.id ?? ''), (x) => this.ops.addConnected(x, d.from, g?.id ?? null));
      tip = plan.ok ? `Release to add a new ${this.noun}${g ? ' in ' + name(g.id) : ''}` : plan.message;
      bad = !plan.ok;
    } else {
      d.target = null;
      this.showDrop(null);
      tip = `Drop on a ${this.noun} to reconnect this end`;
      bad = false;
    }
    const o = d.origin;
    this.ghostLine.setAttribute('d', `M ${o.x} ${o.y} L ${end.x} ${end.y}`);
    this.ghostLine.classList.toggle('bad', bad);
    this.ghostEnd.setAttribute('cx', end.x);
    this.ghostEnd.setAttribute('cy', end.y);
    this.showTip(p, tip, bad);
  }

  endDrag(mode, commit) {
    const d = this.drag;
    this.drag = null;
    this.ghost.replaceChildren();
    this.hideTip();
    this.el.classList.remove('connecting', 'moving');
    const t = d?.target;
    if (commit && t) {
      if (mode === 'move' && t.attach) this.cb.attachNote(d.id, t.attach);
      else if (mode === 'move' && t.group !== undefined) this.cb.place(d.id, t.group);
      else if (mode === 'connect' && t.node) this.cb.connect(d.from, t.node);
      else if (mode === 'connect' && t.create !== undefined) this.cb.addNext(d.from, t.create);
      else if (mode === 'reconnect' && t.node) this.cb.reconnect(d.key, d.end, t.node);
    }
    this.positionToolbar();
    this.renderHandles();
  }
}

function sidePoint(n, side) {
  if (side === 'top') return { x: n.x + n.width / 2, y: n.y };
  if (side === 'bottom') return { x: n.x + n.width / 2, y: n.y + n.height };
  if (side === 'left') return { x: n.x, y: n.y + n.height / 2 };
  return { x: n.x + n.width, y: n.y + n.height / 2 };
}
