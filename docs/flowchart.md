# Flowchart runtime

Flowchart converts a documented Mermaid Flowchart subset or authoring JSON into standalone
SVG and PNG. It has no editor, network dependency or executable workflow behavior.
ELK places nodes and groups; shared orthogonal routing keeps the final paths clear of node
bodies and attached notes. JSON has its own [schema](../schema/flowchart.schema.json).

A [standalone Agent Kit](../agent-kit/README.md) bundles this runtime into
`flowchart-convert.mjs` plus its Schema. It runs without npm installation or this checkout
and supports JSON/SVG. The project CLI below additionally exports PNG through Sharp.

## Command line

```powershell
npm run flowchart -- examples/flowchart/batch-update.mmd --output output/batch.json
npm run flowchart -- output/batch.json --output output/batch.svg
npm run flowchart -- output/batch.json --output output/batch.png --scale 2
npm run flowchart -- examples/flowchart/batch-update.mmd --check
```

Input extensions `.mmd` / `.mermaid` / `.txt` use Mermaid syntax; `.json` uses JSON.
Use `--input-format mermaid|json` to override. `-` reads stdin; `--output - --format json`
or `--output - --format svg` writes stdout. PNG requires a file. `--check` validates syntax
and semantics without laying out or exporting. Errors go to stderr; argument errors exit
with code 2 and conversion errors with code 1. Parse errors include line and column.
Exports are staged in the destination folder and renamed after success. Existing output is
preserved on conversion failure; input cannot be overwritten. PNG uses the shared Sharp
exporter, with 32,768 px per-side and 40 million pixel limits. No browser is needed.

## JavaScript API

```javascript
import {
  parseMermaid,
  createFlowchartModel,
  layoutFlowchart,
  renderFlowchartSvg,
  exportPng,
} from 'rtl-diagram/flowchart/node';

const document = parseMermaid('flowchart TD\nStart(["Begin"]) --> Work["Do work"]');
const model = createFlowchartModel(document);
const layout = await layoutFlowchart(model);
const svg = renderFlowchartSvg(layout);
await exportPng(svg, 'diagram.png', { scale: 2 });
```

`rtl-diagram/flowchart` exports the parser, model, layout and SVG APIs, with no filesystem,
Sharp, DOM or Blockchart dependency. `rtl-diagram/flowchart/browser` adds the shared
`downloadBlob` and `svgToPngBlob` functions. The Node entry adds `exportSvg` and `exportPng`.
Errors are `MermaidSyntaxError`, `FlowchartValidationError` and `FlowchartLayoutError`.
Model creation and layout do not mutate their inputs. Normalized models and authoring
documents can both be passed to `layoutFlowchart`.

## Supported Mermaid subset

This is an input adapter with explicitly limited compatibility, not Mermaid's renderer.

- `flowchart` or `graph`, with TD/TB, LR, BT or RL direction.
- ASCII identifiers: letters or underscore first, then letters, digits or underscore.
- Bare IDs and `A["Process"]`, `A{"Decision?"}`, `A(["Terminator"])`, `A("Terminator")`.
- Expanded shape syntax: `A@{shape:rect,label:"Process"}`, `diam` / `diamond` / `decision`,
  `stadium` / `rounded`, and `doc` / `document`. A document renders as an attached folded note.
- Labels use plain text. Quoted labels support JSON escapes, including `\n`, and `<br/>`
  becomes a newline. Other HTML is escaped as text. Quote labels containing delimiters.
- `-->`, `---`, `-.->`, `-.-`, `==>`; chains and `-->|condition|`, `-- condition -->`.
- `subgraph ID["Title"]` ... `end`, including nested groups. Links attach to nodes, not groups.
- `classDef`, `class A,B name`, `:::name`, `style ID ...`, `linkStyle 0,1 ...`,
  and `linkStyle default ...`. Edge indices are zero-based, including association edges.
- Style properties: `fill`, `stroke`, `color`, `stroke-width`, `font-size`, `opacity`.
  Width/font size accept numbers with optional `px`. Colors are hex or `transparent`.
  Node fill maps to `fillColor`; edge fill maps to `labelBackgroundColor`.
- Semicolons, CRLF, and standalone `%%` comments.

Unsupported syntax is rejected, including init/frontmatter configuration, callbacks,
images, Markdown labels, arbitrary CSS, `&` fan-out shorthand, edge IDs, circle shapes,
and per-subgraph direction. Implement supported features in this adapter rather than
coupling geometry/layout code to Mermaid internals.

## Authoring JSON

Required root fields: `version: 1`, `diagram: {name}`, nonempty `nodes`, and `edges`.
Optional `groups` are flat, nested through `members`. IDs must be unique across nodes and
groups. Each member has at most one parent; group cycles and unknown references are errors.
Edge IDs are unique within edges; omitted IDs are generated deterministically.

Nodes have `id`, optional `label` (default ID), and `type`: `process` (default), `decision`,
`terminator`, `start`, `end`, or `note`. `width` / `height` are optional positive logical SVG
minima. Diamond dimensions reserve space for the complete rectangular text area within its
sloping boundary. Ports are internal shape anchors; there are no authored hardware ports,
bit widths, Nets or Concat nodes in this model.

Edges use `from` / `to` node IDs, optional `label`, `arrow`, `fromSide` / `toSide`, and
`kind`: `flow` (default), `loop`, or `association`. Nodes can have multiple separate outgoing
edges. Each condition belongs to its own edge and appears once, near its source when space
allows. No source-label virtual Block or destination repetition is used.

Back edges are inferred deterministically by DFS over flow edges and marked as loops only
in the normalized model. Explicit `kind: "loop"` can disambiguate the intended main path.
Loops do not determine the main levels. The side defaults to right for vertical flow or
bottom for horizontal flow; use `layout.loopSide` or explicit edge sides to change it.
This detects graph back edges, not programming-language loop semantics.

Notes require `attachTo`, or a node-to-note association from which attachment can be
inferred. One note per owner is supported. Note and owner belong to the same group.
Optional note `side` is left/right/top/bottom, default right for vertical flow and bottom
for horizontal flow. A reserved footprint keeps owner and note together without adding a
flow level. Associations are dotted and arrowless by default. Node styles, including note
styles, are configurable through `diagram.style.node`, `.note` and local `node.style`.

Layout fields: `direction` (down/right/up/left), positive `nodeSpacing` (40),
`layerSpacing` (60), `noteGap` (40), and `loopSide` (auto/left/right/top/bottom). A global
loop side must be perpendicular to flow. Group loops reserve additional interior lanes.

Node/group style fields: `fillColor`, `borderColor`, positive `borderWidth`, `borderStyle`,
non-negative `borderRadius`, `color`, positive `fontSize`, non-negative `padding`, and
`opacity` in [0,1]. Edge style fields: `strokeColor`, positive `strokeWidth`, `lineStyle`,
`color`, positive `fontSize`, `labelBackgroundColor`, and `opacity`. Patterns are solid,
dashed or dotted. Global `diagram.style.edge` / `.group` and per-item styles are supported.
`diagram.caption` adds explanatory text below the chart.

Positions, paths and label bounds appear only in the layout result. SVG contains plain text
and shapes; it does not execute HTML or include editor overlays. Inspect `layout.warnings`
for `FLOW_LABEL_OVERLAP`; complicated charts may need larger spacing or explicit sides.

## Source ownership

`src/lib/flowchart` owns this schema's parser, model, geometry, layout and renderer.
`src/lib/blockchart` owns hardware diagrams and their editor-facing APIs. Both depend on
`src/lib/shared` for text measurement, portable paints/SVG helpers, orthogonal path routing
and platform-specific image exporters. Neither domain depends on the other.

Existing `src/lib/index.js`, `node.js`, `browser.js` and `export/dom.js` retain their public
Blockchart exports. Internal imports use their new domain locations. Shared tools contain
no Net, hardware Port, decision, note-attachment or editor-state policy.
