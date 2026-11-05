# RTL Diagram Generator

Describe modules, input/output ports and connections in JSON or the web editor. The generator uses ELK Layered placement and orthogonal routing to produce SVG and PNG diagrams. The library uses JavaScript ES modules and does not include an RTL parser. Try the [offline-capable web app](https://rexrainbow.github.io/blockflow/dist-offline/).

## Installation and development

```powershell
npm.cmd ci
npm.cmd run dev
```

The development server defaults to http://127.0.0.1:5173/. If that port is occupied, it tries 5174, 5175 and so on. Use the Local URL printed in the terminal. The web build tools require Node.js 22.12 or later; a supported Node.js LTS release is recommended.

```powershell
npm.cmd test
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:e2e
npm.cmd run examples
```

Use `npm.cmd` in PowerShell to avoid changing the script execution policy. Other shells can use `npm`.

Generated examples are written to `output/`. They include a UART data path, direct feedback and feedback across three modules, with right/left variants, SVG, PNG at 2x scale and layout JSON.

### Generated files

`output/` is ignored by Git. It contains generated diagrams, layout JSON, comparison
reports, browser screenshots and temporary offline test copies. These files are created
locally and are not included in a fresh clone. Keep source examples in `examples/` and
regenerate the outputs as needed after installing dependencies:

| Command                          | Output directory            |
| -------------------------------- | --------------------------- |
| `npm.cmd run examples`           | `output/`                   |
| `npm.cmd run examples:styles`    | `output/styles/`            |
| `npm.cmd run compare:placement`  | `output/placement/`         |
| `npm.cmd run compare:feedback`   | `output/feedback/`          |
| `npm.cmd run compare:collapse`   | `output/boundary-collapse/` |
| `npm.cmd run compare:collection` | `output/collection/`        |
| `npm.cmd run compare:views`      | `output/group-view/`        |

Browser tests create screenshots and test artifacts under `output/editor/`. Output paths
mentioned below refer to local files available after running the corresponding command.

## Offline editor

After installing the project's development dependencies, run:

```powershell
npm.cmd run build:offline
```

The build produces the following files in `dist-offline/`:

```text
dist-offline/
├─ index.html
├─ app.js
└─ style.css
```

Copy the entire folder and double-click `index.html` to open the editor. Users do not need Node.js, a server or a network connection. Keep all three files together; copying only the HTML file is insufficient. This is a complete offline editor that starts with the default example and supports opening/saving JSON, editing blocks/connections/styles/feedback, undo/redo and SVG/PNG export. The build does not embed the document currently open in the editor.

The offline version uses classic scripts, an embedded Blob Worker and system fonts, with no CDN or external layout service. Draft storage under `file://` varies by browser. Moving the folder or switching browsers may prevent draft recovery, so use **File -> Save JSON** for durable storage. Editing and downloading still work when storage is unavailable. The standard `npm.cmd run build` continues to produce `dist/`.

Offline browser tests copy the build to a path containing spaces and Chinese characters, open it through `file://` and block network access. They do not start a test server:

```powershell
npm.cmd run test:e2e:offline
```

## Web editor

Drop a JSON file anywhere inside the editor to open it, using the same validation and
unsaved-change confirmation as **File > Open JSON**. Drop one file at a time; this also
works in the offline editor.

- **Nested groups:** **Add group** at the bottom of the Blocks list creates a subgroup inside the selected group, or a root group when no group is selected. Group action menus also offer **Add subgroup** and **Move to group...**. Drag blocks and groups into another group or the root drop area. An item cannot move into itself or its descendants. Creating a group around a block preserves its parent location and connection endpoints.
- List groups support **Collapse all / Expand all**. Searching blocks/groups shows matches and their ancestor paths. Selecting a search result or a member in the preview reveals and locates it in the list. Details shows a clickable full path. **Ungroup** promotes direct members to the original parent while retaining nested groups, blocks and connections; the operation supports Undo. Group names and **Style** settings for borders, backgrounds and titles are edited separately.
- **Split / Editor / Preview** modes remain available. The block list defaults to approximately 260 px in Split mode and 360 px in Editor mode. Each width is remembered separately and can be adjusted by dragging the inner divider or using arrow keys. Search, list disclosure and column widths do not rerun layout or enter document history. Narrow screens stack the work areas vertically.
- Nested groups use once compound layout in every runtime; see examples/nested-groups.json.

- Interface text, accessible names, statuses and validation messages are in English. User-authored diagram names and labels retain their original language.
- GUI, library and CLI all use once layout with the same visible graph.
- The **Split view -> Editor view -> Preview view** button cycles through the workspaces. The preference is stored locally outside document history. Zoom and camera position are preserved; edits made while the preview is hidden appear when it becomes visible again.
- The preview prevents native SVG text selection and dragging, using pointer capture for panning. Text in form fields and exported SVG files remains selectable.
- **Style** buttons for blocks, input/output ports and connections open a dialog instead of expanding fields in the list. Block dialogs have Block, Label, All ports, Input labels and Output labels tabs. Each port can independently override text color, background, font size, padding and opacity. **OK** applies the draft and reruns layout as one undoable change. **Cancel / Escape** discards it; clearing a setting restores inheritance.
- Settings and Preview share a side-by-side workspace. Settings has Blocks and Connections tabs. The block list shows names and keys without input/output counts; the details header's `[?]` button explains keys and bit widths. Connections uses one flat list with a single scrollbar and a fixed **Add connection** footer. Drag the outer divider or use arrow keys to resize the settings area.
- List reordering changes data order; port reordering changes physical port positions.
- Connections expose endpoints, feedback, labels and Style in one flat list.
- Block display names are separate from internal IDs. Renaming a port updates connection references. Deleting a block/port and its dependent connections is one undoable operation.
- Undo/redo uses up to 100 raw JSON snapshots and supports keyboard shortcuts. Each committed field edit is one step; IME composition does not commit partial text.
- Scroll to zoom, drag the background to pan, and click blocks to select them. Arrow keys pan, `+` / `-` zoom and `0` fits the diagram. Relayout preserves scale and a surviving logical camera anchor. Selection outlines and the background grid are not exported.
- Clicking an empty area of the block list or preview, or pressing Escape, clears selection and shows the unselected details state. A preview movement of at least 4 px counts as panning and preserves selection. Dialogs and action menus handle Escape first. Clearing selection does not modify JSON, add an Undo step, rerun layout or reset zoom.
- ELK runs in a terminable Worker, and stale results are ignored. Invalid or incomplete port input keeps the last valid diagram with a stale status and disables stale image exports. JSON can be saved independently of layout success.
- JSON imports are validated before replacement; failures leave the current document intact. JSON downloads preserve raw input and omit unspecified bit widths. New, import and Load example operations offer a cancellable replacement dialog when changes have not been downloaded.
- The document and unapplied field drafts are stored in this browser's localStorage and can be restored on reload. There is no cloud or cross-tab conflict synchronization. Clearing site data deletes local drafts; download JSON for durable storage.
- Browser PNG export uses the same SVG through Canvas, with 1x, 2x and 3x scale options and a white background. Limits are 32,768 px per side and 40,000,000 total pixels. Browser fonts and rasterization may differ from Sharp; the Node API uses Sharp.

`npm.cmd run build` creates a statically deployable `dist/`. Use `npm.cmd run preview` to inspect it at http://127.0.0.1:4173/. Development services listen locally by default. The app needs no backend and does not upload diagrams to a server.

The top toolbar's **File** menu provides New, Open JSON, Save JSON and Load example. **Export** provides SVG, PNG and PNG scale settings. Undo/Redo, workspace switching and Layout settings have separate controls. Click the dot beside the document name to inspect save status. Routine notifications disappear after four seconds; errors remain until dismissed or updated. The compact desktop toolbar removes the former extra heading and bottom status row, reclaiming 121 px of workspace height. Narrow screens use two toolbar rows.

Each connection and the Add connection dialog provides a **Feedback** checkbox. Omitting `feedback` or setting it to `false` gives ELK direction priority 10; `true` gives priority 0, preferring that edge as feedback when breaking a cycle. This is a layout preference: it does not guarantee positions or backward routing, and is not equivalent to Graphviz's `constraint=false`. It works with once layout and does not enable staged layout or exterior routing. See the [InputA/InputB/Mux example](examples/feedback-priority.json).

Interface contracts are documented in [DESIGN.md](DESIGN.md) and [UX-CONTRACT.md](UX-CONTRACT.md). Additional checks are `npm.cmd run check`, `npm.cmd run check:design` and `npm.cmd run format:check`. Browser tests cover accessibility, desktop/narrow viewports and actual file downloads. Screenshots are written to `output/editor/`.

## Agents and JSON Schema

Agents can generate or edit JSON directly without operating the web app. Start with the [agent guide](docs/agent-guide.md),
[JSON Schema](schema/blockflow.schema.json) and [minimal example](examples/agent-minimal.json).
The schema uses Draft 2020-12 and validates fields and types. The library validates cross-object semantics such as endpoint existence, unique IDs, bit widths, drivers, group membership and boundary crossings.
Configure schema association externally in your editor; do not add `$schema` to diagram JSON, where it is rejected as an unknown property.

```powershell
npm.cmd run validate:diagram -- examples/agent-minimal.json
npm.cmd run validate:diagram -- examples/agent-minimal.json --svg output/agent-minimal.svg
```

The first command performs read-only validation and accepts multiple input files. The second also runs layout and writes an SVG for inspection.
`--svg` accepts exactly one input, creates output directories and overwrites the named SVG, but cannot overwrite the input JSON.
Exit codes are 0 for success, 1 for file/JSON/model/layout/output errors and 2 for command usage errors.
Schema/example consistency tests use the development dependency Ajv. The validation command calls the library directly and does not require Ajv.

## API

```javascript
import { readFile } from 'node:fs/promises';
import { createDiagramModel, layoutDiagram, renderSvg, exportSvg, exportPng } from './src/lib/node.js';

const json = JSON.parse(await readFile('./examples/uart-data-path.json', 'utf8'));
const model = createDiagramModel(json);
const layout = await layoutDiagram(model);
const svg = renderSvg(layout);
await exportSvg(svg, './diagram.svg');
await exportPng(svg, './diagram.png', { scale: 2 });
```

The model rejects unknown properties, invalid IDs, incompatible endpoint directions, mismatched explicit bit widths, duplicate connections and multiple drivers. Omitting a port's `width` means unspecified and normalizes to `null`; explicit `null` in input JSON is invalid. When only one endpoint specifies a width, the connection uses it without writing it back to any port. When both widths are unspecified, the connection uses a thin line and port labels have no bus-width suffix. Display labels support Unicode and explicit line breaks; module labels default to the ID. IDs and `diagram.name` remain single-line. `diagram.name` is metadata and is not drawn.

Inputs stay on the left and outputs on the right. Ports retain declaration order on each side. Layout produces geometry and text anchors; the renderer draws them directly and adds a 20 px white margin. Text width is estimated conservatively, and font appearance can vary across platforms.

Direct feedback and cycles across modules are allowed. Feedback connects the specified ports, remains orthogonal and may pass above/below blocks or include backward segments. `direction: "left"` changes the main module placement direction while keeping port sides fixed, so ordinary connections may also need detours. Crossing or overlapping lines do not imply an electrical junction; v0.1 does not create junctions or shared nets.

The Node export functions allow overwriting files but do not create parent directories. PNG dimensions are `max(1, Math.round(baseDimension * scale))`, using the base dimensions read by Sharp at 72 DPI. Limits are 32,768 px per side and 40,000,000 total pixels.

See the [agent guide](docs/agent-guide.md) and [JSON Schema](schema/blockflow.schema.json) for the input format and validation rules.

## Library entry points and file structure

The core library is in `src/lib/`; the web app is in `src/editor/`. Core and editor state tests are in `tests/lib/` and `tests/editor/`, with browser tests in `e2e/`. Public entry points are:

| Entry file            | Package entry       | API                                                                                      |
| --------------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| src/lib/index.js      | rtl-diagram         | createDiagramModel, DiagramValidationError, layoutDiagram, DiagramLayoutError, renderSvg |
| src/lib/node.js       | rtl-diagram/node    | Shared APIs plus exportSvg and exportPng                                                 |
| src/lib/browser.js    | rtl-diagram/browser | Shared APIs plus downloadBlob, svgToPngBlob, exportDom and mountDiagram                  |
| src/lib/export/dom.js | rtl-diagram/dom     | exportDom and mountDiagram                                                               |

Within the project, use relative imports as shown above, or import from `rtl-diagram`, `rtl-diagram/node`, `rtl-diagram/browser` or `rtl-diagram/dom`. Package exports expose these entry points; `rtl-diagram/node` is available only under the Node condition. The package remains private and has no publishing workflow.

```text
src/lib/
├─ index.js                 # Shared public entry; no fs/Sharp exporter dependency
├─ node.js                  # Node public entry
├─ browser.js               # Browser public entry
├─ model.js
├─ styles.js
├─ geometry.js
├─ layout/
│  ├─ index.js
│  ├─ groups.js
│  ├─ visibility.js
│  ├─ edge-labels.js
│  └─ outer-feedback.js
├─ render/
│  └─ svg.js
└─ export/
   ├─ node.js               # File writing and Sharp PNG
   └─ browser.js            # Downloads and SVG-to-Canvas PNG
```

Examples use the public Node entry point. General tests exercise public APIs; tests of internal layout algorithms may import internal files. Former top-level `src/` files have moved without compatibility shims; update older imports accordingly.

The shared entry's own module dependencies do not include the Node exporter. The editor uses model validation, browser exports and the shared layout API inside a Worker. Vite builds do not include Sharp or `fs`. No server is required.

## JSON styles

Portable static styles apply to both SVG and PNG. Set diagram-wide defaults in `diagram.style`; individual module/connection/port `style` objects override inherited values per property:

```json
{
  "name": "Styled diagram",
  "style": {
    "connection": { "strokeColor": "#2563eb", "strokeWidth": 3, "lineStyle": "dashed" },
    "module": {
      "borderColor": "#334155",
      "borderWidth": 2,
      "borderStyle": "solid",
      "fillColor": "#f8fafc",
      "label": { "color": "#0f172a", "fontSize": 18, "backgroundColor": "#e2e8f0", "padding": 5 },
      "portLabel": { "fontSize": 12, "padding": 2 },
      "inputPortLabel": { "color": "#075985" },
      "outputPortLabel": { "color": "#166534" }
    }
  }
}
```

This is a `diagram` object, not a complete input document; the full input still needs `version`, `modules` and other required fields. An individual module can override styles as follows:

```json
{
  "id": "Source",
  "style": {
    "borderStyle": "dotted",
    "label": { "fontSize": 20 },
    "portLabel": { "backgroundColor": "#dcfce7" }
  },
  "ports": [
    { "id": "data", "direction": "output", "width": 8, "style": { "color": "#166534", "padding": 3 } }
  ]
}
```

A connection can use `style: { "strokeColor": "#dc2626", "strokeWidth": 4, "lineStyle": "dashed", "opacity": 0.8 }`. `strokeWidth` is independent of signal bit width. Line styles are `solid`, `dashed` and `dotted`; shared rules generate dash patterns.

Colors accept `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA` and `transparent`, not CSS color names or arbitrary CSS. Modules support `borderOpacity` and `fillOpacity`; text supports `opacity` and `backgroundOpacity`, all in the range 0..1. Line widths and font sizes must be finite positive numbers; padding must be finite and non-negative. Text backgrounds cover only text and padding. The font family is fixed to monospace.

Port style inheritance is resolved before layout; sizing and SVG/PNG use those same effective styles.

```powershell
npm.cmd run examples:styles
```

- [Complete JSON example](examples/style-gallery.json)
- After running the command above, open `output/styles/style-gallery.svg` or `output/styles/style-gallery.png` locally.
- [Style fields and inheritance rules](docs/agent-guide.md#optional-styles), with exact keys in the [JSON Schema](schema/blockflow.schema.json)

`output/styles/` contains SVG, PNG at 2x scale and layout JSON. Custom fonts, bold/italic text, arrows, rounded corners, shadows, gradients and animation are not supported as portable style fields. Unknown style fields fail validation. An interactive DOM exporter is available separately, as described below.

## Comparing node placement strategies

Set `placement` in the input's `layout` object; omission uses `default`:

```json
{
  "layout": {
    "direction": "right",
    "placement": "relaxed"
  }
}
```

This is a layout fragment; a complete document still needs `version`, `diagram` and `modules`.

| placement | Behavior                                                                       |
| --------- | ------------------------------------------------------------------------------ |
| default   | Keeps ELK defaults as the comparison baseline                                  |
| relaxed   | Sets `favorStraightEdges` to false to reduce the preference for straight edges |
| simple    | Sets `nodePlacement.strategy` to SIMPLE                                        |

All three strategies keep port positions fixed and use orthogonal routing. They do not guarantee exact alignment or globally minimal bends.

```powershell
npm.cmd run compare:placement
```

The command runs three strategies on each of three diagrams: nine cases, all with rightward placement.

- [Branching and merging](examples/placement-branch.json): A -> B -> C -> D, A -> E -> D and F -> D.
- [Complete feedback](examples/placement-feedback.json): the same modules/ports, adding only D -> A.
- [Height and port stress](examples/placement-stress.json): the same feedback connections/endpoints, with different block heights and port row positions.

Unconnected `aux_i*` / `aux_o*` ports change row positions and block height. The complete feedback graph has six blocks and seven connections.

After running `npm.cmd run compare:placement`, start with `output/placement/summary.md`, or open the combined diagrams locally:

- Branching and merging: `output/placement/placement-branch-comparison.svg`
- Complete feedback: `output/placement/placement-feedback-comparison.svg`
- Height and port stress: `output/placement/placement-stress-comparison.svg`

Each case also produces SVG, PNG at 2x scale and layout JSON; combined diagrams use the same scale. The summary includes top/center Y ranges for A/B/C/D, bend counts, wire length and diagram dimensions. JSON includes per-connection metrics. Smaller Y ranges mean closer alignment. Width/height exclude the SVG's 20 px margin.

With the pinned version and current examples, `simple` reduces the main-path Y range in the first two diagrams but increases bends. In the height-stress example, both `relaxed` and `simple` align worse than `default`. Keep `default` as the baseline and use the comparisons to decide whether stronger alignment constraints are needed.

## AABB exterior feedback routing

Add these fields to `layout`:

```json
{
  "feedbackRouting": "outer",
  "feedbackMargin": 20,
  "feedbackLaneSpacing": 12
}
```

`feedbackRouting` defaults to `elk` (disabled). `outer` enables exterior routing and requires `direction: "right"`. This is a layout fragment; retain the full document's `version`, `diagram`, `modules` and other fields.

After once layout fixes all visible blocks, optional exterior feedback routing chooses an expanded AABB path by bends then length.

If another block obstructs access from an endpoint to the exterior frame, routing keeps the original ELK path and sets the connection's `routingInfo.reason` to `outer-access-blocked`. Successful routes have method `outer-aabb`, with `side`, `clearance`, `originalBends` and two `waypoints`. Exterior paths contribute to the bounds. Output normalization may translate the entire graph uniformly; relative block positions remain unchanged.

Generate paired ELK/exterior comparisons without overwriting each other:

```powershell
npm.cmd run compare:feedback
```

After running the command above, open `output/feedback/summary.md` locally for feedback bend counts and wire lengths.

See the generated summary for measurements from the current implementation. Exterior routing does not guarantee a shorter or smaller overall diagram.
Web editor block keys are editable separately from display names. Renaming updates all connection
references in one undo step. Duplicate keys receive `_2`, `_3`, etc. and show a warning; connection
selectors use `key.port` so blocks with the same display name remain identifiable.

The editor uses a side-by-side settings / preview workspace. Blocks and Connections share
the settings area as tabs; drag the vertical divider to resize it. Split / Editor / Preview
views remain available, and narrow screens stack the areas without losing tab state.

New blocks display their ID by default. The implicit display name follows ID changes until a
custom display name is entered. Existing explicit display names remain unchanged.

- Selecting a preview connection highlights its route with a dashed trace, switches to Connections and scrolls to its row. Clicking or keyboard-activating a connection row highlights the same route. Block and connection selections are mutually exclusive. Empty clicks and Escape clear selection; dragging still pans. Selection does not affect JSON, SVG or PNG exports.

## Connection labels

Connections accept optional multiline `label` text (use `\n` for a line break). Omit it for an unlabeled route;
an explicit empty string is invalid JSON input. For example:

```json
{
  "from": "A.out",
  "to": "B.in",
  "label": "data",
  "style": {
    "label": { "color": "#334155", "backgroundColor": "#ffffff", "fontSize": 12, "padding": 2 }
  }
}
```

`diagram.style.connection.label` supplies shared text defaults, overridden per property by
`connection.style.label`. All existing portable text properties apply. Text stays horizontal
beside a route; automatic placement prefers a suitable central horizontal segment and avoids
blocks, group titles/borders, other labels and route strokes. Once layout reserves ELK label
space and can retry with wider spacing twice. Final placement runs after outer-feedback
routing.

Layout results contain `label`, `labelPosition` and `labelBounds` on labeled connections.
When full clearance is unavailable, the text remains visible and `layout.warnings` includes
`EDGE_LABEL_OVERLAP` with `connectionId`; overlap-free output is not guaranteed for dense
graphs or very long text. Increase spacing or shorten text to resolve the warning.

The editor exposes Label when creating/editing connections and Line/Label tabs in Style.
Blank input removes the label. Clicking preview text selects its connection. SVG, PNG and
the offline editor use the same geometry. See `examples/connection-labels.json` for nested
groups, branching routes and outer feedback with labels. Manual coordinates,
rotated text, inline text and Graphviz-style `xlabel` are not part of this first version.

## Multiline display names and port keys

Block, group, port and connection labels support explicit line breaks written as `\n` in JSON.
Use `\n` rather than HTML; `<br>` is rendered as literal text. CRLF is normalized to LF;
blank lines are preserved and count toward label height. Diagram names and every key/ID
remain single-line.

Ports accept an optional display name in `label`, independently of their `id`:

```json
{ "id": "data", "label": "Input Data\nChannel A", "direction": "input", "width": 32 }
```

Connections still reference `A.data`. Without `label`, display text follows the port ID;
width notation is appended to the final line. The editor now shows Key (ID) and Display name
for each port. Duplicate keys within the same block receive a suffix and an owned warning,
and existing connection endpoints update atomically. Explicit display names remain unchanged
when keys change; clearing a block or port Display name removes its label and restores ID fallback.

Display text fields are multiline textareas: Enter adds a line, blur commits one history step.
Text measurement reserves the maximum line width and full line height; rows and title areas
grow accordingly. SVG uses tspans with explicit positions; PNG and offline builds share that
geometry. Lists, breadcrumbs and selectors show compact single-line summaries.
See `examples/multiline-labels.json`.

The editor's initial diagram and **File → Load example** use `examples/nested-groups.json`.
It demonstrates System → Core → Pipeline/Auxiliary groups, root blocks C/D, connections
between groups and a feedback route. All seven connections have labels, including multiline
source/feedback labels and separate text colors for bypass, auxiliary and feedback routes.
Existing local drafts remain unchanged; select
Load example to replace the current document through the normal replacement dialog.

## Relative block dimensions

Modules accept optional `width` and `height` as positive finite relative minimum dimensions:

```json
{
  "id": "Mux",
  "width": 1.2,
  "height": 3.5,
  "ports": [
    { "id": "a", "direction": "input" },
    { "id": "b", "direction": "input" },
    { "id": "c", "direction": "input" },
    { "id": "out", "direction": "output" }
  ]
}
```

One unit is the fixed basic plain single-row block: 140 layout units wide and 84 high.
These are relative diagram units, with no physical-unit conversion. The final dimension is
the larger of the requested minimum and the content's natural requirement. Values below 1
are valid but do not shrink content. Omit either field for Auto; explicit null is invalid.
This is independent of `ports[].width`, which remains an optional positive integer bit width.

Height adds equal space before, between and after port rows. Inputs/outputs with the same
row index stay paired; titles retain their upper position. Text, stroke widths and padding
are not scaled. ELK receives the resized geometry and fixed port positions before routing;
groups, feedback and SVG/PNG share those dimensions. Extra height can help
straight routing, but cannot force it. Adjust values manually to suit the graph.

The editor exposes Width/Height in Block details, with Auto placeholders and step 0.1.
Edits support validation, Undo/Redo, JSON persistence and the offline editor.
Open `examples/block-sizes.json` to compare A/B/C (height 1) with Mux (height 3.5).

## Interactive DOM exporter

The browser entry provides `exportDom(layout)` for a detached SVG view and
`mountDiagram(container, layout)` to append it to a page:

```js
import { createDiagramModel, layoutDiagram, mountDiagram } from 'rtl-diagram/browser';
const layout = await layoutDiagram(createDiagramModel(input));
const view = mountDiagram(document.querySelector('#diagram'), layout);
const off = view.on('blockclick', ({ id }) => openRegisterDialog(id));
view.setBlockState('A', { status: 'running' });
view.setPortValue('A.b_out', '0x2A');
// On screen teardown: off(); view.destroy();
```

Give the host a height. The view supports block/group/port/connection/background clicks,
selection, pan/zoom, keyboard navigation, state updates, layout replacement, unsubscribe
and cleanup. It retains connection identity through endpoint keys when layout arrays reorder.
Static SVG/PNG remain independent of view state. Register forms, simulation and hardware
access belong to the host application. See [DOM viewer API](docs/dom-viewer.md).

Run `npm.cmd run build:dom-example`, then open `dist-dom/dom-viewer.html` directly with its
neighboring `app.js` and `style.css`. This standalone example works offline without a server.
Run `npm.cmd run test:e2e:dom` for viewer behavior and accessibility checks.

### Group boundary ports

Groups default to `type: "container"`. Choose `type: "boundary"` and add `ports`
with the same fields as block ports, or choose **Boundary** under **Group type** in Group details.
Route each layer explicitly:

```text
Source.out -> Outer.in -> Inner.in -> Decode.in
Decode.out -> Inner.out -> Outer.out -> Sink.in
```

Group inputs send inward; outputs receive inward. External connections use their usual
input/output roles. Bypassing an enabled boundary is rejected. Fanout is allowed, every
endpoint has at most one incoming driver, and width checks remain local to each connection.
Container and Collection preserve inactive port definitions. Disconnect referenced group ports before
disabling their mode or ungrouping. Group layouts use once mode. SVG, PNG, offline
editing and DOM port events support the same ports.

Open [boundary-groups.json](examples/boundary-groups.json) for a complete nested example;
its 12 blocks and 19 connections show inner Execute/Check branches, an outer Bypass,
two merge points and dashed Retry/Ready feedback paths inside their respective groups.
See the [agent guide](docs/agent-guide.md#optional-group-boundary-ports) for JSON rules and
[DOM viewer guide](docs/dom-viewer.md) for group-port event payloads.

Boundary groups also support `collapsed: true` (default `false`), or **Hide contents** in
Group details. The group becomes a regular-sized block with its existing ports and external
connections. Descendants and internal edges skip layout/rendering, while their full JSON
remains intact and editable. Container groups cannot hide contents. Parent hiding preserves
child visibility settings; list disclosure arrows remain independent.

Run `npm.cmd run compare:collapse` for expanded/inner/outer comparison JSON, SVG and PNG
in `output/boundary-collapse/`. Each JSON can be opened in the editor.

Use **Block actions → Convert to boundary group** (also available by right-clicking a
block row) to turn a block into an empty, collapsed boundary group. The ID, ports, existing
connections, parent membership, dimensions and current appearance are preserved. Undo/Redo
restores the original kind. Expand it with Hide contents, then add children and internal links.
Existing self-loops stay external. Group details supports Width/Height using the same relative
minimum-size units as blocks; expanded groups also grow to fit their contents.

All runtimes now use once layout. Connection order/alignment and layout.orderMode are removed
from the current JSON schema/API. The editor upgrades old JSON files and local drafts by
removing these settings, preserving graph content, styles and feedback. Save JSON after
opening an older file to use the upgraded document with the strict library/CLI.

### Collection groups

Choose **Collection** under **Group type** to show several members as a stacked overview
when **Hide contents** is checked. Expanded collections behave like containers. JSON uses
`type: "collection"` and `collapsed: true`; `members` keeps the real IDs. The title's
count refers to direct members, including nested groups. Members need not share a module.

A collapsed collection has one virtual **Input** and **Output**. Each external connection
is retained separately and routed to these anchors; internal connections are hidden.
Original blocks, ports, widths and connections remain in JSON and return on expansion.
Validation checks every real endpoint before projection. Virtual anchors have no signal
width and are unavailable in connection forms. Parallel routes may overlap: edges and
their labels/styles are not merged.

All types share the existing hierarchy and drag/drop UI. Switching to Container shows
contents. Switching a Boundary with referenced ports is blocked with affected connections
listed; disconnect/reconnect them explicitly first. Inactive port definitions are kept.
Legacy `portMode: "direct" | "boundary"` works when `type` is absent; conflicting fields fail.

Open [the 16-instance example](examples/collection-instances.json), or run
`npm.cmd run compare:collection` for expanded/collapsed JSON, SVG and PNG under
`output/collection/`. Offline editor and DOM view support the same feature.

### Edit from the preview

Double-click a block, group title, collapsed group, connection segment or connection label
to open its Style dialog. Select an item and use the preview **Style** button for keyboard
or touch access. OK applies one undoable change; Cancel/Escape discard it. The current view
mode, zoom and logical camera position are preserved.

Boundary and Collection title arrows **Hide contents / Show contents** directly; group hover,
selection or keyboard focus reveals them. Right-click (or Shift+F10) opens the same preview
actions menu available from the preview's **⋯** button. Right-clicking selects the target first.
Blocks, groups and connections offer **Edit style…** and **Edit label…**; groups also expose
applicable view and visibility actions. Both menu entry points share action definitions.
Tree-list disclosure remains independent. Arrows and action overlays are absent
from SVG/PNG downloads. These features also work in the offline editor.

**Edit label…** opens a multiline text dialog with **Save / Cancel**. Enter inserts a line
break; Ctrl/Cmd+Enter saves outside IME composition; Escape cancels. Invalid input stays
editable with an inline error. Saving creates one Undo step without changing IDs or
connection endpoints. Clearing a block/group label restores its ID as the display name;
clearing a connection label removes its text. An omitted block/group label shows its ID
as a placeholder and remains omitted when saved unchanged. Closing the dialog restores
focus to the preview target. Stale or invalid previews disable editing with an explanation.

### Top and group views

Use Preview's **View** selector to choose **Top** or any group, including a hidden nested
group. Options show display names, falling back to IDs; only duplicate names, including a
name matching Top, append `[ID]`. The selector tooltip retains the full ancestor path and IDs.
**View contents** in group-list/preview actions opens the same view; breadcrumbs link
back to Top and ancestors. The selected group's frame, ports and internal graph are drawn.
Its own stored collapse flag is temporarily overridden for viewing, while descendants keep
their settings. External blocks and connections disappear. The source JSON stays complete.

Switching views has no Undo step. Each view remembers its zoom/pan within the editor session;
first entry fits. Removing the target falls back to Top. Opening a document or reloading
starts at Top. SVG/PNG download the current view; Save JSON downloads the complete project.
The offline editor supports the same navigation and exports.

Library usage: call `layoutDiagram(createDiagramModel(input), { rootGroupId: 'Inner' })`.
Omit the option or use `null` for Top. Group-view layout results carry `rootGroupId` and preserve
original block/port/edge identities for the DOM viewer. The full input remains validated.
Run `npm.cmd run compare:views` to generate Top/Outer/Inner comparisons in `output/group-view/`.
