# Interactive DOM exporter

The browser entry exports `exportDom(layout, options)` and
`mountDiagram(container, layout, options)`. Both return a live SVG view/controller.
The library imports safely in Node, but creating a view requires a browser Document.
There is no dependency on the editor, a UI framework, a server or a simulation engine.
For an already computed layout, import these two functions from `rtl-diagram/dom` to avoid
bringing the ELK layout engine into a viewer-only bundle. The browser entry remains convenient
when the same application also computes layouts or exports images.

```js
import { createDiagramModel, layoutDiagram, mountDiagram } from 'rtl-diagram/browser';

const layout = await layoutDiagram(createDiagramModel(diagramJson));
const view = mountDiagram(document.querySelector('#diagram'), layout);

const unsubscribe = view.on('blockclick', ({ id, data }) => {
  // Your application maps the stable block ID to its own register/settings UI.
  openRegisterDialog(id);
});

view.on('portclick', ({ ownerId, ownerType, portId }) => console.log(ownerId, ownerType, portId));
view.on('connectionclick', ({ key, source, target }) => console.log(key, source, target));

view.setBlockState('A', { status: 'running' });
view.setPortValue('A.b_out', '0x2A');
view.setConnectionState('A.b_out->B.b_in', { status: 'success' });

unsubscribe();
// When the owning screen unmounts:
view.destroy();
```

Give the host a height, for example `#diagram { height: 480px; }`. The SVG fills its host.
`mountDiagram` appends one owned SVG and preserves existing host children.
For a detached result, use `const view = exportDom(layout)` then append `view.element`.
Its first visible resize fits the diagram. An optional `document` selects an owner Document;
`mountDiagram` always uses its host's Document. Other options are `ariaLabel`, `minZoom`
(default 0.05), and `maxZoom` (default 8).

## Events

`view.on(name, handler)` returns an unsubscribe function. `view.off(name, handler)` removes
that handler (including a pending `once` registration) and returns a boolean; `view.once(name, handler)` returns an unsubscribe handle
and invokes its handler once. Repeated `on` registration of the same function/name is deduplicated.
Unknown event names and non-function handlers throw. Events are synchronous notifications,
with read-only snapshot payloads. Listener exceptions are reported to the browser without
preventing other listeners. Async handlers manage their own rejected promises.

| Event             | Payload fields beyond `type` and `originalEvent`                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `blockclick`      | `id`, `key`, `data`                                                                               |
| `groupclick`      | `id`, `key`, `data`                                                                               |
| `portclick`       | `id` (full `owner.port`), `key`, `ownerId`, `ownerType`, `blockId` or `groupId`, `portId`, `data` |
| `terminalclick`   | `id`, `key`, `data`                                                                               |
| `connectionclick` | `id`, `key`, `source`, `target`, `data`                                                           |
| `backgroundclick` | No target                                                                                         |
| `selectionchange` | `selection`, `previous`, `reason` (`api`, `interaction`, `layout`)                                |
| `viewportchange`  | `viewport: { x, y, scale }`                                                                       |
| `statechange`     | `target`, `state`, `previous`                                                                     |
| `layoutchange`    | `selection`                                                                                       |

`originalEvent` is a browser pointer/keyboard/click event for activation and interaction-driven
selection. State, layout and viewport notifications use null. These notifications do not veto
the view's selection or navigation. `data` is the
target's layout record. A port's `data` contains its label, direction, width and position;
its ID remains independent of its display name. `source` and `target` use
`{ moduleId, portId }` for ports or `{ terminal: id }` for external terminals.
Layout results include these endpoint records on connections.

External terminals appear in `layout.terminals` as text-only targets. Use
`view.getElement('terminal', id)` and `view.select({ type: 'terminal', id })`.
Activating one emits `terminalclick` with `id`, `key`, `data` and the normal originalEvent.
Terminal layout records carry geometric width/height, signal `bitWidth`, `anchor` and text
bounds/style. Connection keys use `@terminal:ID` for terminal ends, such as
`@terminal:DataIn->Processor.data_in`, and remain stable across array reordering.
These keys are view identities, not raw JSON references. Group views omit root terminal
targets; selection/state pruning follows normal setLayout behavior.

Boundary group ports are ordinary `port` targets using `Group.port` IDs. Their descriptors
include `ownerType: "group"`, `ownerId` and `groupId`; block ports include
`ownerType: "block"`, `ownerId` and the existing `blockId`. Selection, `getElement`,
`setPortValue` and layout replacement support both owners. Use
`view.setGroupState('Outer', { status: 'running' })` to update a group outline. Render
[boundary-groups.json](../examples/blockchart/boundary-groups.json) to try nested group ports.

When the input group has `collapsed: true`, its whole body is a `group` target and still
emits `groupclick` with `data.collapsed === true`; its ports keep the same owner IDs.
Descendant targets and internal connections are absent from the layout/view. On `setLayout`,
hidden selected targets and transient states are pruned, while surviving group/port IDs keep
their selection/state. Expanding uses a fresh layout from the complete source JSON; runtime
state of hidden descendants does not return automatically. The DOM viewer does not toggle
the document itself; the host changes JSON and calls `layoutDiagram` then `setLayout`.

After a block is converted to a boundary group with the same ID, its body becomes a `group`
target (`groupclick` replaces `blockclick`). Port keys such as `Mux.a` remain stable; their
descriptors change from `ownerType: "block"` / `blockId` to `ownerType: "group"` / `groupId`.
Port selection/value state survives `setLayout` through those keys. Block-specific runtime
state/selection is not automatically transferred to the new group target. Size and appearance
are preserved by the editor conversion; group Width/Height minima also work in live views.

The connection `id` is the current layout's generated ID, such as `connection_0`. Its `key`
is the stable endpoint pair (`A.b_out->B.b_in`), which the view uses to preserve state and
selection when connection arrays are reordered. Connection methods accept either form.
Older/custom layouts without endpoints fall back to their connection IDs and cannot supply
stable identity across arbitrary reordering. Prefer fresh `layoutDiagram()` output.

## Selection, navigation and layout updates

```js
view.select({ type: 'block', id: 'A' });
view.select({ type: 'port', id: 'A.b_out' });
view.select({ type: 'connection', id: 'A.b_out->B.b_in' });
view.select(null);

view.fit();
view.zoom(1.25); // Factor, centered in the viewport.
view.zoom(1.25, { x: 200, y: 100 }); // Cursor point in local CSS pixels.
view.pan(40, 0); // CSS pixels.
view.setViewport({ x: 20, y: 30, scale: 1 });

const nextLayout = await layoutDiagram(createDiagramModel(nextJson));
view.setLayout(nextLayout); // Retains camera and surviving IDs/state.
view.setLayout(nextLayout, { fit: true });
```

`view.selection`, `view.viewport` and `view.layout` return snapshots. Selection descriptors
contain `type`, `id`, and `key`, plus port/connection identity fields where relevant.
`setLayout` accepts a completed layout, validates before replacement and does not perform
layout itself. It retains the selected target's screen center when that target survives,
restores target focus, and prunes state for removed IDs. Keyboard focus reveals off-screen
targets at the current zoom when needed. Resize preserves the viewport's center; use `fit()`
to fit the whole graph again. Removed selection emits a
`selectionchange` with reason `layout`. A pending pan/click is canceled when layout changes.

Pointer clicks select; dragging four CSS pixels or more pans without triggering activation,
even if the pointer returns to its starting position. Canceled gestures do not activate.
The wheel zooms around the cursor. Tab reaches targets; Enter/Space activate; Escape clears;
arrow keys pan; +/- zoom; 0 fits. Port labels and anchors are clickable, connection labels
share their route's target, and group titles select groups. Small ports in dense graphs may
need zooming; every target also supports keyboard activation. Text selection prevention is
scoped to the SVG, leaving surrounding forms usable.

`view.getElement(type, id)` returns the target's focusable SVG group. Each target exposes
`data-kind`, `data-id`, `data-key`, and `aria-pressed`. Prefer the event API over binding
directly to target nodes, because `setLayout` replaces those nodes.

## Runtime display state

`setBlockState(id, patch)` and `setConnectionState(idOrKey, patch)` accept:

| Property    | Meaning                                                                           |
| ----------- | --------------------------------------------------------------------------------- |
| `status`    | Non-blank single-line text, exposed through `data-status` and the accessible name |
| `highlight` | Boolean; draws a dashed status outline when true                                  |

Patches merge per property; null clears that target's state. Built-in statuses `idle`,
`running`, `success` and `error` have distinct outline colors; custom statuses use the accent.
`setPortValue(fullPortId, value)` accepts text, a finite number or boolean; null clears it.
Values use textContent, display compactly near the port, and update its accessible name.
They do not participate in ELK placement and can overlap in very dense graphs.

`view.getState(type, id)` returns a copied block/connection state or a port `{ value }`, or
null when unset. `view.clearState()` clears all runtime display state while keeping selection.
State changes redraw overlays without running ELK and do not alter input JSON or layout.
`renderSvg(view.layout)` and PNG generation remain static and exclude live state/hit targets.

The SVG supports host CSS variables `--portsketch-accent` and `--portsketch-background`.
Status/selection/value overlays are view-owned. Arbitrary HTML, SVG strings, scripts and
callbacks are not accepted as diagram content; business behavior stays in application code.

## Lifecycle and runnable example

`destroy()` removes only the owned SVG, disconnects resize observation, removes its event
handlers, cancels gestures and clears runtime state. It is idempotent. Unsubscribe handles
and `off` remain safe after destruction; other operations reject a destroyed view.

```sh
npm.cmd run build:dom-example
```

Open `dist-dom/dom-viewer.html` directly. Keep its neighboring `app.js` and `style.css`.
The three-file example is offline and needs no server. It demonstrates selection, event
logging, status updates and port values; its buttons are display controls, not a simulator.
During development, `npm.cmd run dev` also serves `/examples/blockchart/dom-viewer.html`.

Source: `examples/blockchart/dom-viewer.html`, `examples/blockchart/dom-viewer.js`, `examples/blockchart/dom-viewer.css`.
Verification: `npm.cmd run test:e2e:dom`.

### Collection groups

Collapsed `type: "collection"` groups draw a stacked overview, a direct-member count
and virtual Input/Output. Anchors belong to the group hit target and emit `groupclick`;
they have no `portclick` or `setPortValue` target. Hidden real blocks/ports follow normal
pruning. Input JSON stays unchanged.

External edges remain selectable by original endpoint key, such as
`Source.out->PE_0.in`, even when paths share an anchor. Selection/state survive expansion
when that key stays visible. Layout edge `source`/`target` preserve original endpoints;
`routingSource`/`routingTarget` name visible virtual anchors. No edge aggregation.
See `examples/blockchart/collection-instances.json`.

### Scoped layouts

Ordinary block appearance bodies (Stacked and Trapezoid), hidden port labels and connection
destination arrows use the shared layout/SVG geometry. Block selection includes the complete
appearance footprint. Hidden labels keep their real port hit targets and identities; arrows
remain part of their owning connection. See `examples/blockchart/block-appearances.json`.

Pass the optional second argument {rootGroupId: 'Inner'} to layoutDiagram(model), then use
that result with mountDiagram/exportDom/setLayout as usual. The result's rootGroupId records
the scope. Original port IDs and connection endpoint keys remain stable; targets outside
the view are pruned through normal setLayout behavior. A surviving group port retains
ownerType group, selection and runtime values. The whole source must be validated first.

### Vertical flow

Layouts produced with `layout.direction: "down"` retain horizontal text, top/bottom port
anchors, left-to-right port order and horizontal Concat bars. The viewer uses those computed
bodies, labels and routes directly. Port/connection keys and event payload identities do not
change when relaying out another direction. Use `setLayout(nextLayout, {fit: true})` to fit
a new axis explicitly. See `examples/blockchart/vertical-flow.json`.

## Repeated connection labels

The viewer uses every `labelInstances` entry for label hits, including Start/End labels.
Inline gaps and Callout leaders share the static SVG/PNG renderer. DOM validation checks
instance positions, bounds, placement and leader coordinates before replacing the old view.
Each live view has separate mask IDs. A shared source label is drawn once; each connection
retains its own route, target label, state and identity.

## Net branch identity

Array-target Nets compile to ordinary routed branches. Connection events/selection include
`netId` and `branchIndex`, retaining the existing endpoint-pair key for each branch. This lets
hosts group signals without losing receiver identity. Shared source names are drawn once;
long branches can repeat the name as end Callouts. Synthetic signal nodes/source wrappers
are absent from public modules/groups and hardware hits. JSON documents retain one Net.
