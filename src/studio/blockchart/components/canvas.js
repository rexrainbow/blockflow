import { s } from '../../ui/dom.js';
import { connectionLabels } from '../../../lib/blockchart/layout/edge-labels.js';
import { endpointKey } from '../../../lib/blockchart/endpoints.js';
import { descendants } from '../../../lib/blockchart/hierarchy.js';
import { planConnection } from '../state/actions.js';
import { CanvasBase, pathOf, pad } from '../../core/canvas.js';

/** Blockchart overlay: blocks, groups, terminals, ports and nets on the exported SVG. */
export class Canvas extends CanvasBase {
  margin = 20;

  selKey(sel) {
    return !sel ? '' : sel.type === 'port' ? `port:${sel.owner}.${sel.port}` : sel.type === 'net' ? `net:${sel.index}` : `${sel.type}:${sel.id}`;
  }

  /* ---------------- overlay ---------------- */
  buildHits(L) {
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
    // Junction dots belong to their Net: the disk (at least 6 units) picks its first
    // participating branch. Drawn under the branch paths, so a click on a line keeps its branch.
    const byId = new Map(L.connections.map((c) => [c.id, c]));
    for (const j of L.junctions ?? []) {
      const c = byId.get(j.connectionIds?.[0]);
      if (!c) continue;
      const index = c.connectionIndex ?? Number(String(c.id).replace('connection_', ''));
      nodes.push(s('circle', { cx: j.x, cy: j.y, r: Math.max(6, j.radius), class: 'hit hit-junction', 'data-hit': 'net', 'data-index': index, 'data-branch': c.branchIndex ?? 0 }));
    }
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
    this.portHits = portHits;
    return { hits: nodes, top: portHits };
  }

  updateZoomSized() {
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

  selectionShapes(sel, L) {
    const out = [];
    const ring = (owner, port) => {
      const o = L.modules.find((m) => m.id === owner) ?? L.groups?.find((g) => g.id === owner);
      const p = o?.ports?.find((x) => x.id === port);
      if (p) out.push(s('circle', { cx: p.x, cy: p.y, r: Math.max(5, 8 / this.camera.z), class: 'sel-port', 'vector-effect': 'non-scaling-stroke' }));
    };
    if (sel.type === 'net') {
      for (const c of L.connections.filter((x) => x.connectionIndex === sel.index)) {
        const strong = sel.branch === undefined || sel.branch === c.branchIndex;
        for (const section of c.sections) {
          const d = pathOf(section.points);
          out.push(s('path', { d, class: 'sel-net-halo', 'vector-effect': 'non-scaling-stroke' }));
          out.push(s('path', { d, class: strong ? 'sel-net' : 'sel-net weak', 'vector-effect': 'non-scaling-stroke' }));
        }
      }
      return out;
    }
    if (sel.type === 'port') {
      ring(sel.owner, sel.port);
      for (const m of this.store.multi) ring(m.owner, m.port);
      return out;
    }
    return super.selectionShapes(sel, L);
  }

  renameBounds(sel) {
    if (sel.type === 'net') return this.netLabelBounds(sel);
    return this.labelBounds(sel);
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

  click(hit, event) {
    const sel = this.selectionFromHit(hit);
    this.cb.select(sel, { additive: event.shiftKey && sel?.type === 'port' });
  }

  onDoubleClick(hit, sel) {
    if (hit.dataset.hit === 'group' || hit.dataset.hit === 'collapsed') this.cb.enterGroup(sel.id);
    else if (sel.type !== 'port') super.onDoubleClick(hit, sel);
  }

  dragKind(hit) {
    const kind = hit?.dataset.hit;
    if (kind === 'port' || kind === 'terminal') return 'port';
    if (['block', 'collapsed', 'group-title'].includes(kind)) return 'node';
    return null;
  }

  beginDrag(mode, hit) {
    if (mode === 'port') this.beginConnect(hit);
    else this.beginMove(hit);
  }

  updateDrag(mode, event, p) {
    if (mode === 'port') this.updateConnect(event, p);
    else this.updateMove(event, p);
  }

  endDrag(mode, commit) {
    if (mode === 'port') this.endConnect(commit);
    else this.endMove(commit);
  }

  navItems(L) {
    return [
      ...L.modules.map((m) => ({ sel: { type: 'block', id: m.id }, b: m })),
      ...(L.groups ?? []).filter((g) => g.collapsed).map((g) => ({ sel: { type: 'group', id: g.id }, b: g })),
      ...(L.terminals ?? []).map((t) => ({ sel: { type: 'terminal', id: t.id }, b: t.labelBounds })),
    ];
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
    this.showTip(p, d.plan ? d.plan.message : 'Drop on a port to connect', Boolean(d.plan && !d.plan.ok));
  }

  endConnect(commit) {
    const d = this.drag;
    this.drag = null;
    this.ghost.replaceChildren();
    this.hideTip();
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
  }

  endMove(commit) {
    const d = this.drag;
    this.drag = null;
    this.ghost.replaceChildren();
    this.hideTip();
    this.el.classList.remove('moving');
    if (commit && d && d.target !== undefined) this.cb.place(d.id, d.target);
    this.positionToolbar();
  }
}

export { endpointKey };
