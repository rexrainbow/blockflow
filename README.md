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

Inputs are on the left and outputs on the right for horizontal flow. With `direction: "down"`, inputs move to the top and outputs to the bottom, ordered left to right. Ports retain declaration order on each side. Layout produces geometry and horizontal text anchors; the renderer draws them directly and adds a 20 px white margin. Text width is estimated conservatively, and font appearance can vary across platforms.

Direct feedback and cycles across modules are allowed. Feedback connects the specified ports, remains orthogonal and may pass above/below blocks or include backward segments. Shared connectivity is declared explicitly as a Net; crossing or overlapping lines do not imply an electrical junction.

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
    "connection": {
      "strokeColor": "#2563eb",
      "strokeWidth": 3,
      "lineStyle": "dashed"
    },
    "module": {
      "borderColor": "#334155",
      "borderWidth": 2,
      "borderStyle": "solid",
      "fillColor": "#f8fafc",
      "label": {
        "color": "#0f172a",
        "fontSize": 18,
        "backgroundColor": "#e2e8f0",
        "padding": 5
      },
      "portLabel": {
        "fontSize": 12,
        "padding": 2
      },
      "inputPortLabel": {
        "color": "#075985"
      },
      "outputPortLabel": {
        "color": "#166534"
      }
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
    "label": {
      "fontSize": 20
    },
    "portLabel": {
      "backgroundColor": "#dcfce7"
    }
  },
  "ports": [
    {
      "id": "data",
      "direction": "output",
      "width": 8,
      "style": {
        "color": "#166534",
        "padding": 3
      }
    }
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

`output/styles/` contains SVG, PNG at 2x scale and layout JSON. Custom fonts, bold/italic text, rounded corners, shadows, gradients and animation are not supported as portable style fields. Unknown style fields fail validation. An interactive DOM exporter is available separately, as described below.

## Concatenation

A module with `type: "concat"` combines one or more ordered input ports into exactly one
output port. Ordinary modules can omit `type` (equivalent to `"block"`). Input array order
defines composition order, first input at the high end when describing bits, independently
of placement or connection array order. Connections keep the usual `Block.port` references.

Port widths are optional. With all widths omitted, Concat is an abstract composition node.
Partial widths remain annotations: no sum is checked until **every input and the output**
has an explicit width. Then the output must equal the input sum. Widths are never inferred,
propagated or written back. Existing known-width checks on each connection still apply.

Use **Add Concat** to create two unspecified-width inputs and one output. Add/reorder inputs
through the regular Port controls. The sole output and last input cannot be removed, and a
Concat cannot be converted to a Boundary group. A width mismatch remains editable and
survives draft reload; correct or clear a width to restore valid export.

Concat defaults to the compact `bar` appearance; input anchors retain their order and the
output is centered between the first and last row. Add Concat hides title/port text through
ordinary text styles to produce a thin bar; the stored name is still editable. Use Style to
show names or choose another appearance. Relative size minima, groups, SVG/PNG, DOM and
offline editing use the same model and geometry. Automatic bit-range labels are not included.

Open [the Concat example](examples/concat.json) for both an abstract path and two 16-bit
sources combined into a 32-bit Mux input.

## Standalone Agent Kit

The [agent-kit](agent-kit/README.md) directory contains exactly three distributable files:
the JSON Schema, an English authoring guide and `blockflow-convert.mjs`. With Node.js 22.12+
they work offline without this source checkout, `node_modules`, a browser or the editor.
Agents can author/validate raw JSON and export editable JSON or SVG. PNG is not included.

```powershell
node agent-kit/blockflow-convert.mjs diagram.json --check
node agent-kit/blockflow-convert.mjs diagram.json --output diagram.svg
node agent-kit/blockflow-convert.mjs diagram.json --output formatted.json
npm.cmd run build:agent-kit
```

The last command regenerates the three matched artifacts from the current implementation.
The CLI also supports stdin/stdout, scoped group SVG and structured stderr diagnostics;
see the kit README. JSON export retains the full original authoring document and omissions.

## Flow direction

Preview's **Flow** select offers **Left to right** and **Top to bottom**, stored as
`layout.direction: "right"` / `"down"`. Layout settings edits the same field. Direction
changes are undoable, keep selection and endpoints, and fit the accepted diagram to view.
Only Right and Down flow are supported.

Down flow places input ports on top and outputs below, each ordered left to right. Text
stays horizontal and is measured again for the new arrangement. Concat becomes a horizontal
bar with unchanged input/composition order. Trapezoids have a full-width input side and a
shorter centered output side; `rightHeightRatio` remains the serialized parameter for the
output/input size ratio. Stacked bodies, group interfaces, collapsed groups, Collection
anchors and Terminals follow the same direction. Relative width/height minima remain screen
width/height. SVG, PNG and DOM export share the geometry.

Outer feedback supports Right and Down. Its side is Auto/Top/Bottom for Right and
Auto/Left/Right for Down. The editor maps Top ↔ Left and Bottom ↔ Right when switching axes,
in the same Undo step. Direct JSON must use a compatible side. Blocked access retains ELK.
See [vertical-flow.json](examples/vertical-flow.json) for Concat, Terminals, groups, appearances
and exterior feedback together.

## Block appearances and signal schematics

Ordinary blocks accept an optional `appearance` object. Omission preserves the original rectangle.

| Appearance | Parameters | Behavior |
| --- | --- | --- |
| `rectangle` | `type` only | Original rectangular block |
| `bar` | `type` only | Compact rectangular bar with centered output; default for Concat |
| `stacked` | `layers`: integer 1–3, default 2 | Visual backing plates; no members, expansion or connection projection |
| `trapezoid` | `rightHeightRatio`: 0.2–1, default 0.6 | Full-height left side and shorter, centered right side |

For example, use `"appearance": { "type": "stacked", "layers": 3 }` on a module.
Appearance geometry determines the title, port positions and complete occupied bounds. Text
and relative minimum sizes can enlarge the shape. Routing conservatively avoids its bounding
rectangle. Groups do not accept `appearance`; choose Rectangle before converting a shaped
block to a Boundary group. See [block appearances](examples/block-appearances.json).

All text styles accept boolean `hidden` (default `false`). Use `style.hidden` on a Terminal
or individual Port, `style.label.hidden` on a Block, Group or Connection, and
`style.portLabel.hidden` for shared Port defaults. Diagram-level
`diagram.style.module.portLabel.hidden` hides Port names throughout the diagram, including
group interfaces. `inputPortLabel.hidden` / `outputPortLabel.hidden` restrict this by side;
an individual Port can explicitly set `hidden: false` to override inherited hiding.

Hidden text, backgrounds and width notation reserve no text space. Names, IDs, geometry
anchors and connections remain editable and selectable. Omitted `label` still falls back
to ID where supported; an empty string is invalid. `hidden` hides text only, never the owning
object. The old `showPortLabels` field is removed and rejected without migration.
See [hidden label styles](examples/hidden-labels.json).

Set `diagram.style.connection.endArrow` to `"triangle"` for destination arrows. Override
`style.endArrow` per connection with `"triangle"` or `"none"` (the default). Arrows follow the
last routed segment and share its color and opacity, including dashed lines. Their geometry
is included in SVG, PNG and DOM exports, image bounds and label avoidance.

In Preview, open **Edit style…** on a block to select Appearance, or on a
connection to select End arrow. Each text-style tab offers Hidden (Inherit default / Yes / No).
Blank parameters use defaults; arrow controls offer Inherit default. Changes apply together on OK and support Undo. **Layout settings**
contains Hide port labels, Default end arrow and Feedback side.

[Signal schematic](examples/signal-schematic.json) combines hidden port labels, stacked
blocks, destination arrows and top-side exterior feedback for a signal-flow diagram.

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
  "feedbackLaneSpacing": 12,
  "feedbackSide": "auto"
}
```

`feedbackRouting` defaults to `elk` (disabled). `outer` enables exterior routing with `direction: "right"` or `"down"`. This is a layout fragment; retain the full document's `version`, `diagram`, `modules` and other fields.

`feedbackSide` accepts `auto` (default), `top`/`bottom` for horizontal flow or `left`/`right` for Down, and applies only to Outer routing.
Auto chooses by bends then length. A blocked requested side keeps the ELK route with
`routingInfo.reason: "outer-access-blocked"`, without silently switching sides. This setting
applies to eligible exterior feedback routes across the diagram.

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

## External terminals

Terminals represent named external inputs and outputs without a block frame. Open
[terminals.json](examples/terminals.json) for a processor example with two external inputs and
three outputs, including a multiline output name.

Add optional root-level `terminals` entries with `id`, `direction` (`input` or `output`),
optional `label`, optional positive safe-integer bit `width`, and optional text `style`.
IDs share the block/group namespace. Omit Label to display the ID and Width for unknown
bit width. Text styles use the same portable properties as port labels; width notation
is appended to the final display line.

Connections keep existing `"Block.port"` references and can use `{ "terminal": "ID" }`
at one end. For example, `{ "from": { "terminal": "DataIn" }, "to": "Processor.data_in" }`
receives an external input, while `{ "from": "Processor.interrupts", "to": { "terminal": "Interrupts" } }`
sends a block output outside. Direction is relative to the diagram: external inputs are
sources and may fan out; external outputs are targets and accept at most one driver.
Terminal-to-terminal connections are not supported. The other end must be a real block
or Boundary group port, with matching widths when both are explicit.

Inputs appear on the left and outputs on the right for horizontal flow, even with leftward block placement. With Down flow they appear above and below the diagram, ordered left to right.
Array order controls the top-to-bottom order on each side. Layout reserves label space
and routes to internal anchors; helper nodes never enter saved JSON or appear as blocks.
Terminal names and connection labels remain separate. Unused terminals are allowed.

In **Connections**, use **Add terminal**, or **New external input… / New external output…**
inside Add connection. Returning from terminal creation preserves the connection draft.
Click a terminal in Preview to select it; double-click opens its text Style. Its shared
right-click/keyboard actions offer **Edit label…**, **Edit style…**, **Edit terminal…** and
**Delete terminal**. Renaming a key updates references; incompatible direction/width edits
are rejected. Deleting a terminal removes its dependent connections in one Undo step.

Terminals belong to the diagram root, not group members. Boundary crossing rules still
apply. Collection collapse preserves terminal identities while projecting internal targets;
group views omit root terminals and their external edges. SVG, PNG, the offline editor
and the DOM viewer share the same geometry. DOM targets emit `terminalclick`.

## Connections as Nets

New Connections describe a single-source Net, including one-to-one links. Use a nonempty
`to` array and a stable `id` (recommended). For example:

```json
{
  "id": "result_bus",
  "from": "ALU.result",
  "to": [
    "Register.data",
    {
      "endpoint": "Comparator.data",
      "constraint": false
    }
  ],
  "label": "ALU result",
  "style": {
    "label": {
      "repeatAtEnd": "auto",
      "longThreshold": 600
    }
  }
}
```

Every target is either an endpoint or an object with `endpoint`, optional `constraint`,
`feedback` and line-only `style`. Label text/style and `startArrow` belong to the entire Net. Endpoint
objects such as `{ "terminal": "DataOut" }` work in target arrays too. Each source belongs
to one Net; add targets to it rather than declaring the source again. Targets cannot repeat
or equal the main endpoint. Independent Nets cannot drive the same receiving face. All
specified widths on the shared signal must agree; omit unknown widths. Boundary ports retain
inside/outside face rules. Concat remains a separate component that combines different inputs.

`direction: "both"` describes an abstract bidirectional interface with one main/reference
endpoint and any number of peers. Every endpoint must be an `inout` Port. The shared master
is valid within the same Net; unrelated Nets cannot claim its occupied faces. This describes
connectivity, not arbitration, tri-state electrical behavior, selected responders or timing.
Arrows default to targets for forward Nets and both ends for bidirectional Nets; existing
arrow style overrides remain cosmetic.

The editor's **Add connection** dialog offers **Net / Concat** and a **Bidirectional** checkbox.
Net has one main endpoint and one or more editable targets. Concat has multiple sources and
creates the existing concat element plus its input/output Nets in one undoable operation.
Connections rows expose Key, common Label, target add/remove, direction, shared Style and
per-target placement influence, feedback and line Style. A route selects its whole Net and identifies its target;
a source label selects the whole Net. Style/Label exposes **Destination labels** and
**Long branch threshold**. Cancel/Undo, narrow layouts and offline editing use existing flows.

Connections require a nonempty `to` array. Scalar targets and retired layout/label fields are rejected by the editor, library and Agent Kit. Imports are validated without migration.

## Port adjustment

Port positions slide by default after Auto/Grid placement to reduce bends. In the Layout page or Layout
settings, choose **Port adjustment: Reduce bends** and set **Maximum shift** (logical SVG
units, default 40; zero disables movement). JSON uses `layout.portAdjustment` (`reduce-bends` by
default, or `fixed`) and `layout.maxPortShift`. These global settings also apply in
group views and do not change saved Port coordinates, Block positions or Block dimensions.

The bounded search keeps Ports on their original side, in declaration order, with at least
24 units between anchors and room for visible names, titles and corners. Names move with
their anchors. Opposite sides can move independently; initial input/output row pairing is
not locked. Rectangular and stacked Blocks are supported; Concat, other appearances,
Group interface Ports and feedback anchors stay fixed. Terminal anchors and names move together
vertically in horizontal flow or horizontally in vertical flow, within the same Maximum shift.
Terminal order and separation are preserved; moves overlapping Blocks, Groups or other
Terminals are rejected. Terminal adjustment also rejects changes that increase
connection-label clearance warnings.
Source signal label nodes move with their source Port only inside their reserved wrapper.
All branches of an affected Net are evaluated together. Accepted results do not increase
obstacle-hit or foreign-Net crossing counts, and improve bends, length, then displacement.
The search has at most four passes and 128 trials; it does not promise a global optimum or
remove bends required by obstacles, port order or disjoint movement ranges. Callouts and
arrows are placed afterwards. Explicit Fixed preserves the original fixed-port output exactly.

See [the six-interface example](examples/port-adjustment.json): with adequate Processor
height, six two-bend connections become six straight connections while all Blocks stay put.

## Net labels and virtual layout nodes

A labeled Net uses one small routing-only signal node near its source. It contains only
measured text/padding and uses an 8-unit local gap, without ordinary Block/Port/title minima.
The source and its signal nodes are arranged locally, then participate in the enclosing
hierarchical Auto/Grid layout. Routes attach to this reserved rectangle. The renderer removes
synthetic Blocks/groups, opens an Inline gap for the source name and draws the common trunk
once. Saved JSON contains no virtual nodes, coordinates or fake hardware.

After routing, each branch's actual source-to-target length controls destination Callouts:

| Label property | Values | Default |
| --- | --- | --- |
| `repeatAtEnd` | `auto`, `always`, `never` | `auto` |
| `longThreshold` | Positive logical SVG length | `600` |

Auto adds a same-name Callout near a target only when its routed length exceeds the threshold.
These supplementary labels do not trigger another block layout. Names stay horizontal;
transparent backgrounds retain group fills. Common label styles inherit per property from
`diagram.style.connection.label`. Hidden removes all Net labels and their virtual node.
Source names are Inline; receiver names use Callout. The old label `placement` and `position` fields are rejected.

Normalized/layout Connections are compiled branches with `netId`, `connectionIndex` and
`branchIndex`; endpoints retain their authored identity. `labelInstances` contains the shared
source and optional destination label. `labelPosition`/`labelBounds` alias the first instance.
DOM connection events retain branch endpoint keys and expose `netId`/`branchIndex`.
Virtual modules/groups are absent from public layout modules/groups and static SVG hardware.

Labels avoid hardware, group titles/frames and foreign routes; Callout leaders may cross a
group frame or attach to a coincident same-source, same-name fan-out segment. Unavoidable
conflicts remain visible as `EDGE_LABEL_OVERLAP` warnings. User spacing/minimum sizes still
apply, and virtual nodes are not guaranteed to make every graph smaller. SVG/PNG, Preview,
offline and Agent Kit share the same pipeline. See [Net fan-out](examples/net-fanout.json),
[bidirectional Net](examples/net-bidirectional.json) and
[processor components](examples/processor-components.json).

## Multiline display names and port keys

Block, group, port and connection labels support explicit line breaks written as `\n` in JSON.
Use `\n` rather than HTML; `<br>` is rendered as literal text. CRLF is normalized to LF;
blank lines are preserved and count toward label height. Diagram names and every key/ID
remain single-line.

Ports accept an optional display name in `label`, independently of their `id`:

```json
{
  "id": "data",
  "label": "Input Data\nChannel A",
  "direction": "input",
  "width": 32
}
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
    {
      "id": "a",
      "direction": "input"
    },
    {
      "id": "b",
      "direction": "input"
    },
    {
      "id": "c",
      "direction": "input"
    },
    {
      "id": "out",
      "direction": "output"
    }
  ]
}
```

One unit is the fixed basic plain single-row block: 140 layout units wide and 84 high.
These are relative diagram units, with no physical-unit conversion. The final dimension is
the larger of the requested minimum and the content's natural requirement. Values below 1
are valid but do not shrink content. Omit either field for Auto; explicit null is invalid.
This is independent of `ports[].width`, which remains an optional positive integer bit width.

Height adds equal space before, between and after port rows. With Fixed Port adjustment,
inputs/outputs with the same row index stay paired; titles retain their upper position. Text, stroke widths and padding
are not scaled. ELK receives the resized geometry and fixed port positions before routing;
groups, feedback and SVG/PNG share those dimensions. Extra height can help
straight routing, but cannot force it. Adjust values manually to suit the graph.

The editor exposes Width/Height in Block/Group details and the first tab of their Style
dialogs, with Auto placeholders and step 0.1. In Style, dimensions, appearance and colors
apply together on OK as one Undo step; Cancel or Escape discards the draft. Blank restores
Auto and removes the geometry field from JSON. Dimensions remain top-level properties.
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

The editor, library and CLI use the same Auto/Grid layout pipeline. Retired connection order/alignment and layout.orderMode fields are rejected. Imports and local drafts are validated without automatic migration.

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
Use the canonical group `type`; `portMode` is not accepted.

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


## Grid arrangements and overview diagrams

The **Layout** tab selects Top or a Group and edits Auto/Grid. Grid cells reference direct
members, each at most once; unselected members remain automatic and empty cells reserve
space inside the Grid. Set Rows/Columns or add/remove rows/columns, and change gaps,
then **Apply layout** to commit one Undo step. Invalid drafts stay editable. Auto preserves
the signal-driven arrangement. Nested grids size their tracks from actual content, and
connections are rerouted orthogonally around blocks. Very small gaps may obstruct port
access; increase them or change sides. Rename/membership edits update grid references.
The Auto arranged list shows the remaining members. Selecting an already placed member
moves it to the new cell. Shrinking the Grid releases removed members to Auto; new blocks
stay automatic. Dimensions are stored only through the rectangular cells array. The GUI
accepts positive whole-number dimensions up to 10,000 total cells.

[Partial Grid](examples/partial-grid.json) reserves an empty middle column for A/B/C while
Source and Sink use signal-driven automatic placement outside the entire reserved rectangle.
Only the renderer's temporary layout graph contains that rectangle; JSON groups and real
connections retain their original identity. An entirely empty Grid leaves every member
automatic and reserves no rectangle. Auto neighbors may move as the Grid changes.

Ordinary blocks may omit ports or use an empty array. Add bidirectional ports through block
details; the Side control can follow Flow or explicitly select Left/Right/Top/Bottom.
Connections can use **Both directions** between inout ports, and **Affect placement** can
be turned off without deleting or hiding the real signal. Start/end arrows are portable
styles. The Layout tab also edits a global multiline **Diagram caption** footer.

Hiding all Port names removes their text lanes and extra label rows from block sizing;
only connection spacing, the title, appearance and explicit size minima remain. A block
with a few hidden Ports can therefore match a portless block with the same title. Many
Ports still reserve enough space for distinct connections; showing names restores text sizing.

[Processor cluster overview](examples/processor-overview.json) demonstrates all these features. Its transparent
Sources Container supplies a layout column without a visible frame. The compute cluster Grid preserves
ALU0/ALU4/ALU1 in the left column and ALU3/ALU2 in the right column. SVG/PNG, offline, DOM viewer
and the standalone Agent Kit share validation, placement and rendering.

For shared alignment across Containers, the Layout tab offers **Expand containers for
layout**. `layout.expandGroups: ["ComputeCluster"]` replaces that direct Container in the cell
choices with its direct children, shown with their group path. Place every child exactly
once. Each expanded Container must span a disjoint rectangular cell region containing
only its members or empty cells. Boundary and Collection groups stay atomic.

The shared Grid reserves header/frame padding, aligns row/column centers, and fits each
Container around its region without changing membership or signals. Its own saved layout
is suspended in the controlling view and used again in group views. Missing members or
interleaved rectangles block Apply/export with an actionable error; newly added members
of expanded Containers must also be placed. Other unselected direct members stay Auto.
Unchecking expansion returns the Container to a whole participant and clears its child
cells in the draft. See [Processor cross-group Grid](examples/processor-cross-group-grid.json).

## Rounded group frames and signal labels

Group Style's **Corner radius** sets `group.style.borderRadius`, a non-negative logical
SVG length. The default is 0 (square); 12 gives rounded frames. It applies to Container,
Boundary and Collection frames, including collapsed faces and backing cards. Rendering
clamps the radius to half the inset rectangle dimensions. Geometry, Port placement and
routing retain their existing bounds. This property belongs to groups, not block styles.

[Processor components](examples/processor-components.json) uses Down Flow, Auto and nested
rounded Containers without Grid. It combines an instruction decoder, ALU, input/output
registers, muxes and interrupt routing. Signal names use Connection labels; external endpoints
display their names on Terminals without duplicate edge labels. Abstract concat bars collect
operands, interrupts and results across cores. Widths are omitted: `x16`, `x24`, `x32` and
core/instance counts are labels, not assumed bus widths. Thirteen processing/control blocks,
three concat elements and nine groups demonstrate a processor structure shown once for two
cores. The global result concat stays outside Processor so scoped views retain its boundary.


### Net label frames

Net `style.label` and `diagram.style.connection.label` additionally support
`borderColor` (default transparent), `borderWidth` (default 1; zero disables the frame),
`borderOpacity` (default 1) and `borderRadius` (default 0). Width and radius must be finite
and non-negative; opacity is in [0, 1]. Frames use a solid stroke and apply to both the
shared source name and destination Callouts. They are independent of the Net line color.
Strokes stay inside the reserved text-and-padding bounds; width and radius are clamped to
fit. Use `padding` for breathing room around text. `hidden` hides text, fill and frame.
These frame fields belong only to connection labels, not Terminal or Port text styles.
The editor exposes them in Connection style > Label; blank values inherit defaults.

```json
{
  "backgroundColor": "#FFF9E6",
  "padding": 4,
  "borderColor": "#B38900",
  "borderWidth": 0.8,
  "borderRadius": 4
}
```

The snippet is the value of `style.label`. See `examples/connection-labels.json` for a
complete diagram (Agent Kit users can author the same style directly).
