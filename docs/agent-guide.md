# Authoring blockflow JSON

Use [the JSON Schema](../schema/blockflow.schema.json) for accepted fields and types. The
library validator is authoritative for references and cross-object rules. Produce raw input
JSON, not the normalized model, layout result, browser localStorage wrapper or SVG.
The schema uses JSON Schema Draft 2020-12 and describes version 1 input.

## Minimal diagram

Copy [examples/agent-minimal.json](../examples/agent-minimal.json), or start here:

```json
{
  "version": 1,
  "diagram": { "name": "Source to Sink" },
  "modules": [
    { "id": "Source", "ports": [{ "id": "data", "direction": "output" }] },
    { "id": "Sink", "ports": [{ "id": "data", "direction": "input" }] }
  ],
  "connections": [{ "from": "Source.data", "to": "Sink.data" }],
  "layout": { "direction": "right" }
}
```

## Rules

- Required root fields are `version` (exactly `1`), `diagram` and `modules`.
  `diagram.name` is required. `modules` must remain present even in a group-only document
  (`modules: []`). Optional root fields are `connections` (defaults to `[]`), `layout`
  and `groups`.
- IDs match `[A-Za-z_][A-Za-z0-9_]*`. Module IDs are unique across the diagram; port IDs
  are unique within their module, across inputs and outputs. Keep existing IDs unless asked
  to rename them; update every affected `from` and `to` when renaming.
- Each diagram needs at least one module or group, each module at least one port. Empty editor drafts
  are not valid library inputs. Unknown properties are rejected at every level.
- Omit block, group or port `label` to display its ID. Display labels support LF (`\n`)
  line breaks; CRLF is normalized to LF. Labels must be non-blank XML-compatible text.
  Port labels do not change endpoint references; bus notation is appended to the final line.
  Connection labels use the same display-text rules; omit them for no label.
  `diagram.name` is non-blank, single-line XML-compatible text; every ID remains single-line.
  Text rejects tabs, unsupported control characters, surrogate code points, U+FFFE/U+FFFF
  and U+2028/U+2029. Display text permits LF and CRLF, but not a bare CR.
- For ordinary blocks, `from` is an existing output and `to` an existing input, both `moduleId.portId`.
  Fanout, same-module self-loops and multi-block cycles are allowed. An input has one driver;
  duplicate edges are invalid. Leave unused ports unconnected.
- Port `width` is optional; omit it for unknown width, never use `null`. Explicit port widths are positive
  safe integers. Only two explicit endpoint widths must match. One known endpoint determines
  the edge width; this does not infer widths for other ports or branches.
- Module `width` and `height` are optional positive finite numbers in shared relative units,
  such as `1`, `1.1` or `3.5`. They set minimum dimensions, independently of port bit widths.
  Omit for Auto; contents can make a block larger. Height spreads port rows without scaling
  text or strokes. Extra size does not guarantee straight connections. See `examples/block-sizes.json`.
- Port array order controls top-to-bottom order on each side. Inputs stay left, outputs right.
  Module or connection array order alone does not enforce block positions. Do not invent
  coordinates, connection IDs, `alignmentGroups`, HTML/CSS or renderer-specific fields.

## Layout

All visible connections are laid out together (once). There is no layout mode, edge order
or main-path alignment setting. Prefer direction right; left is also supported with native
ELK routing. Labels may trigger bounded spacing retries on the same complete graph.
Use feedback:true to express feedback preference and feedbackRouting:outer for the optional
AABB exterior route; these do not create layout batches.

All accepted input `layout` fields are listed below. Defaults describe library behavior;
schema validation does not insert them into JSON.

| Field                 | Accepted values                      | Default        |
| --------------------- | ------------------------------------ | -------------- |
| `direction`           | `"right"`, `"left"`                  | `"right"`      |
| `routing`             | `"orthogonal"` only                  | `"orthogonal"` |
| `placement`           | `"default"`, `"relaxed"`, `"simple"` | `"default"`    |
| `feedbackRouting`     | `"elk"`, `"outer"`                   | `"elk"`        |
| `feedbackMargin`      | Positive finite number               | `20`           |
| `feedbackLaneSpacing` | Positive finite number               | `12`           |
| `moduleSpacing`       | Positive finite number               | `50`           |
| `layerSpacing`        | Positive finite number               | `80`           |

Prefer `default` or `relaxed` placement; `simple` remains available for compatibility.
`feedbackRouting: "outer"` requires `direction: "right"`; the library rejects `left`
with `outer` even though this combination passes structural schema validation.
Exterior routing falls back to ELK when access is blocked.

## Feedback preference

Set an edge's optional `feedback: true` when it should preferably be the backward edge
of a cycle. False or omitted uses ELK direction priority 10; true uses 0. This preference
works in once layout. It does not guarantee backward
routing or exact block positions and does not exclude the edge from ranking like Graphviz
`constraint=false`. All edges still participate in layout. Outer feedback routing is a
separate geometric option, not enabled by this flag. See [the InputA/InputB/Mux example](../examples/feedback-priority.json).

## Optional hierarchical groups

Keep modules and connection endpoints flat. Root `groups` entries have `id`, `members`
(block or group IDs), optional `label` and `style`. Unlisted items remain at root. Every
item has at most one parent; IDs are unique across blocks/groups; cycles are rejected.
Group declarations can reference groups declared later. Empty groups are valid; at least
one block or group is required. Each group's `members` array is required and cannot repeat
an ID. Group styles use border/fill fields, `label`, `portLabel`,
`inputPortLabel` and `outputPortLabel`. All group layouts use once, just like ordinary blocks.
Grouping does not impose same-rank alignment or fixed positions. See
[the nested example](../examples/nested-groups.json).

### Optional group boundary ports

Groups default to `type: "container"`: members can connect across the container without
explicit boundary ports. Set `type: "boundary"` and add `ports` using the same port
objects as blocks (`id`, `direction`, optional `label`, `width`, `style`). Endpoints still
use `ownerId.portId`; group and block IDs share a namespace.
Group `ports` may be omitted or empty, and unused ports are valid. Port IDs must be unique
within each group, across both directions, just as for blocks.

Connections must cross each enabled boundary through its ports, one level at a time:

```text
Source.out -> Outer.in -> Inner.in -> Decode.in
Decode.out -> Inner.out -> Outer.out -> Sink.in
```

On the outside, group inputs receive and group outputs send. On the inside, group inputs
send to children and group outputs receive from children. A group input can connect to
its own output (internal pass-through); its output can connect to its own input (external
feedback). Each endpoint has at most one incoming driver and may fan out. Width checks
are per connection, without inference across a chain. In Container or Collection mode stored group port
definitions remain inactive and cannot be referenced. See
[the boundary example](../examples/boundary-groups.json) for two enabled levels, an unused
port, multiline labels and styles. Its 12 blocks and 19 connections demonstrate inner
Execute/Check branches joining at Join, outer Bypass joining at ResultMux, and separate
Retry/Ready feedback routes within each boundary. No automatic port creation or crossing-edge rewriting.

### Hide a boundary group's contents

Set `collapsed: true` on a boundary group to lay it out as a regular block using the same
ID, title, style and interface ports. Default is `false`; Container groups reject `true`.
Keep all `members`, modules, nested groups and connections in JSON. The complete document
is still validated, then layout excludes descendants and internal edges/labels, including
`G.input -> G.output` pass-through. External `G.output -> G.input` feedback remains visible.
Parent collapse overrides child visibility without changing child settings. Expand by
setting `false`. Dimensions and ports follow regular-block geometry when collapsed.
The editor's **Hide contents** checkbox is independent of the list's disclosure arrows;
hidden objects remain editable in the list. Use `npm.cmd run compare:collapse` to generate
expanded, inner-collapsed and outer-collapsed input JSON plus SVG/PNG under
`output/boundary-collapse/`. All layouts use once.

### Convert an existing block to a boundary group

The editor's **Block actions → Convert to boundary group** moves the object from `modules`
to `groups` with the same ID, label, ports and relative `width`/`height`, adding
`members: []`, `type: "boundary"`, `collapsed: true`. Endpoints, parent membership,
sibling membership order and connection metadata stay unchanged. Effective border/fill/title
styles are materialized on the new group to preserve the current appearance; port definitions
and shared port-label overrides are retained. This is one undoable change. Add at least one
port and resolve unfinished edits on that block before converting. Expand and add children
and internal links explicitly; no automatic wiring. An existing self-loop remains external.

Group `width` and `height` are optional positive relative minima using the same 140 × 84
unit as blocks. Collapsed groups use normal-block geometry; expanded groups grow beyond
these minima as needed for contents and labels. Omit an axis for Auto. Group details exposes
both fields. All layouts use once.

## Optional styles

Use `diagram.style.module` / `diagram.style.connection` for defaults, and module/port/edge
`style` for overrides. Module styles include `label`, `portLabel`, `inputPortLabel` and
`outputPortLabel`; port styles are text styles directly. Port precedence is diagram common,
diagram direction, module common, module direction, then port override. Colors accept hex
RGB/RGBA or `transparent`, not CSS color names. Line styles are `solid`, `dashed`, `dotted`.
Hex forms are `#RGB`, `#RGBA`, `#RRGGBB` and `#RRGGBBAA`; CSS functions, variables and URLs
are unsupported. `borderWidth`, `strokeWidth` and text `fontSize` must be positive finite
numbers; text `padding` is finite and non-negative. `opacity`, `borderOpacity`,
`fillOpacity` and text `backgroundOpacity` range from `0` to `1`, inclusive.
Omit overrides to inherit; do not write normalized defaults back into the input. See
[the styled example](../examples/style-gallery.json) and Schema definitions for exact keys.

## Validate, render, inspect

From the repository root, install with `npm.cmd ci` (Node 22.12+), then run:

```powershell
npm.cmd run validate:diagram -- examples/agent-minimal.json
npm.cmd run validate:diagram -- examples/agent-minimal.json --svg output/agent-minimal.svg
```

Other shells may use `npm` instead of `npm.cmd`. Pass several JSON paths to validate a batch;
`--svg` accepts exactly one input, creates output directories and overwrites the named SVG.
Without `--svg`, validation is read-only. Exit codes: 0 success, 1 file/JSON/model/layout/output
failure, 2 command usage error. Failures include the file, stage and validation path when available.

Preserve unrelated fields, validate, fix the reported error, render, and inspect the SVG before
claiming completion. Shape validation alone cannot check unique IDs, endpoint existence,
directions, driver conflicts, matching widths or boundary crossings.
For PNG, use the existing [Node export API](../README.md#api); the Web App can open the same JSON.

The Web App, library and CLI use the same once layout. The editor upgrades old JSON files
and local drafts by removing layout.orderMode and connection.order/alignment. These fields
are absent from the current schema; direct library/CLI input must omit them.

Configure your editor's schema association externally. Do not add `$schema` to a diagram:
the input format rejects it as an unknown property. Schema defaults are documentation only;
do not use a validator configuration that inserts defaults or removes unknown properties.
Connection text is optional: add `label: "data"` to a connection, omitting it when unused.
Non-blank XML-compatible text is accepted, including LF (`\n`) line breaks. Set `style.label` on a connection
or `diagram.style.connection.label` for shared portable text defaults (color, fontSize,
backgroundColor, padding, opacity, backgroundOpacity). Positioning is automatic; do not add
`xlabel` or coordinates. Inspect `layout.warnings` for `EDGE_LABEL_OVERLAP` when rendering.

### Collection overview

Use the existing flat groups array with `type: "collection"`:

```text
{ "id": "PEs", "type": "collection", "collapsed": true, "members": ["PE_0", "PE_1"] }
```

Keep complete children and original connection endpoints. Do not create synthetic ports
in input JSON or replace endpoints. Layout projects crossing edges to virtual Input/Output,
hides internal edges and draws a stacked face with a direct-member count. Nested groups
count as one member. Outer collapse wins without rewriting child settings. Expanded
Collections have ordinary Container connectivity. No homogeneous-member check is required.

Every real width, driver and boundary check runs before projection, even for hidden data.
The shared visual anchor has no width. Edges retain separate identities, labels and styles;
coincident paths can overlap. See [the 16-instance example](../examples/collection-instances.json).

Canonical types are `container` (default), `boundary`, `collection`. Legacy `portMode`
works when type is absent; if both exist they must agree (Boundary = boundary,
Container/Collection = direct). Only Boundary ports are real endpoints.

### Group views are layout options

Keep the full document when drawing one group. After createDiagramModel(input), call
layoutDiagram(model, {rootGroupId: 'Inner'}); omit the option or use null for Top.
Do not remove external definitions or add rootGroupId to input JSON. Full validation precedes
scope projection. Group-view output has rootGroupId and keeps original connection IDs and
port ownership. The root is shown expanded without changing its stored collapsed flag;
descendants honor theirs. Outside edges, including outside same-group feedback, are omitted.
SVG/PNG from this layout show only the group; source JSON still describes the whole design.
