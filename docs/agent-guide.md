# Authoring blockflow JSON

Use [the JSON Schema](../schema/blockchart.schema.json) for accepted fields and types. The
library validator is authoritative for references and cross-object rules. Produce raw input
JSON, not the normalized model, layout result, browser localStorage wrapper or SVG.
The schema uses JSON Schema Draft 2020-12 and describes version 1 input.

## Minimal diagram

Copy [examples/blockchart/agent-minimal.json](../examples/blockchart/agent-minimal.json), or start here:

```json
{
  "version": 1,
  "diagram": {
    "name": "Source to Sink"
  },
  "modules": [
    {
      "id": "Source",
      "ports": [
        {
          "id": "data",
          "direction": "output"
        }
      ]
    },
    {
      "id": "Sink",
      "ports": [
        {
          "id": "data",
          "direction": "input"
        }
      ]
    }
  ],
  "connections": [
    {
      "from": "Source.data",
      "to": ["Sink.data"],
      "id": "net_1",
      "style": {
        "endArrow": "none"
      }
    }
  ],
  "layout": {
    "direction": "right"
  }
}
```

## Rules

- Required root fields are `version` (exactly `1`), `diagram` and `modules`.
  `diagram.name` is required. `modules` must remain present even in a group-only document
  (`modules: []`). Optional root fields are `connections` (defaults to `[]`), `layout`,
  `groups` and `terminals`.
- IDs match `[A-Za-z_][A-Za-z0-9_]*`. Module IDs are unique across the diagram; port IDs
  are unique within their module, across inputs and outputs. Keep existing IDs unless asked
  to rename them; update every affected `from` and `to` when renaming.
- Each diagram needs at least one module or group, ordinary modules may omit ports or use an empty array; Concat retains its required input/output ports. Empty editor drafts
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
  text or strokes. Extra size does not guarantee straight connections. See `examples/blockchart/block-sizes.json`.
- Port array order controls order on each side: top-to-bottom for horizontal flow, left-to-right for Down. Inputs/outputs use left/right sides horizontally and top/bottom in Down.
  Module or connection array order alone does not enforce block positions. Do not invent
  coordinates, compiled branch IDs, `alignmentGroups`, HTML/CSS or renderer-specific fields.

## External terminals

Use optional root `terminals` for external named interfaces without real blocks; see
[examples/blockchart/terminals.json](../examples/blockchart/terminals.json). Each entry requires `id` and
`direction` (`input` or `output`), and accepts optional multiline `label`, positive safe-integer
bit `width` and text `style`. Omit label for ID fallback and width for unknown; explicit null
is invalid. Terminal IDs share the block/group namespace and use the same ID syntax.

A connection end can be the exact object `{ "terminal": "OverlayIn" }`, instead of an
ordinary `"Block.port"` string. Do not use null, a bare terminal ID, an `@terminal:` string
or an object with additional fields. External inputs are valid only as `from`; external
outputs only as `to`. Each such connection must have a real block/Boundary-group port at
the other end. Inputs may fan out; outputs have at most one incoming driver. Duplicate
edges and mismatched explicit widths are rejected. Widths are not inferred across branches.

Terminals are root-level items, cannot occur in group members and cannot bypass Boundary
ports. They may remain unconnected, but the document still needs a real block or group.
Inputs stay left and outputs right for Right/Left, and use top/bottom for Down; array order is preserved per side. Label text and padding reserve layout space. Save only real terminal definitions
and original endpoint objects, never the helper nodes used internally for layout.

Same-side Terminal anchors align by default: a common X for each input/output side in
horizontal flow, or a common Y for each side in Down flow. Terminal text and associated
virtual signal labels move together. Their complete envelopes stay outside the internal
Block/Group layout; overlapping same-side envelopes are separated along the side before
affected connections are rerouted. Reduce bends then moves Terminals only along that side,
preserving alignment. No authoring setting or coordinates are required.

Terminal style is a direct text style with built-in text defaults, not module border/fill
style. Normalized terminal width is bit width; layout terminal `width`/`height` are geometric
dimensions and `bitWidth` carries signal width. Layout also provides `anchor`, `labelPosition`
and `labelBounds`. Collection projection retains terminal identity; group views omit root
terminals and external edges. Existing block-only input remains valid without this field.

## Layout

Each layout pass considers all visible connections together; Auto receiver labels can request one additional pass. There is no layout mode, edge order
or main-path alignment setting. Use direction right or down. Label conflicts do not trigger global spacing retries.
Use feedback:true to express feedback preference and feedbackRouting:outer for the optional
AABB exterior route; these do not create layout batches.

All accepted input `layout` fields are listed below. Defaults describe library behavior;
schema validation does not insert them into JSON.

| Field                 | Accepted values                                    | Default        |
| --------------------- | -------------------------------------------------- | -------------- |
| `direction`           | `"right"`, `"down"`                                | `"right"`      |
| `routing`             | `"orthogonal"` only                                | `"orthogonal"` |
| `placement`           | `"default"`, `"relaxed"`, `"simple"`               | `"default"`    |
| `feedbackRouting`     | `"elk"`, `"outer"`                                 | `"elk"`        |
| `feedbackSide`        | `"auto"`, `"top"`, `"bottom"`, `"left"`, `"right"` | `"auto"`       |
| `feedbackMargin`      | Positive finite number                             | `20`           |
| `feedbackLaneSpacing` | Positive finite number                             | `12`           |
| `moduleSpacing`       | Positive finite number                             | `50`           |
| `layerSpacing`        | Positive finite number                             | `80`           |
| `portAdjustment`      | `fixed` or `reduce-bends`                          | `reduce-bends` |
| `maxPortShift`        | Finite non-negative logical SVG distance           | `40`           |

Prefer `default` or `relaxed` placement; `simple` remains available for compatibility.
`feedbackRouting: "outer"` requires `direction: "right"` or `"down"`; the library rejects `left`
with `outer` even though this combination passes structural schema validation.
Exterior routing falls back to ELK when access is blocked.

## Feedback preference

Set an edge's optional `feedback: true` when it should preferably be the backward edge
of a cycle. False or omitted uses ELK direction priority 10; true uses 0. This preference
works in once layout. It does not guarantee backward
routing or exact block positions and does not exclude the edge from ranking like Graphviz
`constraint=false`. All edges still participate in layout. Outer feedback routing is a
separate geometric option, not enabled by this flag. See [the InputA/InputB/Mux example](../examples/blockchart/feedback-priority.json).

## Optional hierarchical groups

Keep modules and connection endpoints flat. Root `groups` entries have `id`, `members`
(block or group IDs), optional `label` and `style`. Unlisted items remain at root. Every
item has at most one parent; IDs are unique across blocks/groups; cycles are rejected.
Group declarations can reference groups declared later. Empty groups are valid; at least
one block or group is required. Each group's `members` array is required and cannot repeat
an ID. Group styles use border/fill fields, `label`, `portLabel`,
`inputPortLabel` and `outputPortLabel`. All group layouts use once, just like ordinary blocks.
Grouping does not impose same-rank alignment or fixed positions. See
[the nested example](../examples/blockchart/nested-groups.json).

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
[the boundary example](../examples/blockchart/boundary-groups.json) for two enabled levels, an unused
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

### Concat modules

Use `type: "concat"` on a module for ordered concatenation; ordinary modules omit `type`
or use `"block"`. Concat requires at least one input and exactly one output. Input port
array order is composition order, first at the high end for bit concatenation. Keep all
ports and ordinary `Module.port` connection references; never connect multiple drivers to
a single input. See [examples/blockchart/concat.json](../examples/blockchart/concat.json).

Omit widths for abstract concatenation. If any Concat port lacks a width, skip the sum
check and preserve unknown widths. Only when every input and the output have explicit
widths must output equal the input sum. This is an authoritative model check; structural
schema validation cannot compare sums. Never infer or propagate widths. Existing connection
checks still reject unequal explicitly known endpoint widths.

Concat has fixed `bar` geometry: Down uses inputs at the top and output at the bottom
(horizontal bar); Right uses inputs at the left and output at the right (vertical bar).
Omit Port `side` to follow Flow. An explicit side must match it, including feedback;
otherwise validation fails at the Port's `side`. Only omitted appearance or
`{ "type": "bar" }` is accepted on Concat; ordinary Block appearances remain unrestricted.

The bar body stays thin (12 logical units plus allowance for a border wider than 1),
while length grows for ordered input slots and receiver labels. Visible module/Port
names are reserved outside the bar. Width/height minimums apply to its layout envelope,
not bar thickness; measured node bounds can therefore be larger than the filled body.
The output is centered between the first and last input. Never infer bit-range labels.
Connection endpoints and arrow tips attach to the physical bar edges, even when
multiline titles, visible Port names or explicit size minimums enlarge the layout envelope.
After ELK placement the runtime restores these physical anchors and reroutes affected
connections; it does not treat the surrounding text envelope as the Concat body.
This applies to Auto, Grid and scoped layouts without authoring new coordinates.

Concat cannot convert to a Boundary group. See [concat-feedback.json](../examples/blockchart/concat-feedback.json).

### Block appearance and signal notation

An ordinary module optionally accepts `appearance`. Omit it for the original rectangle,
or use `{ "type": "rectangle" }`. Other profiles are
`{ "type": "stacked", "layers": 2 }` (integer 1–3 backing plates, default 2) and
`{ "type": "trapezoid", "rightHeightRatio": 0.6 }` (finite 0.2–1, default 0.6).
Only keys for the selected type are accepted. Geometry controls title, side-port placement
and the full footprint; text and relative minimum sizes can enlarge it. Routing uses
conservative rectangular bounds. Stacked is visual only: no members, count, expand action
or endpoint projection. Groups reject `appearance`; reset a module to Rectangle before
converting it to a Boundary group. See [block appearances](../examples/blockchart/block-appearances.json).

Every text style accepts boolean `hidden`, default `false`. Terminal and individual Port
use `style.hidden`; Block/Group/Connection names use `style.label.hidden`. Shared Port
styles use `portLabel.hidden`, `inputPortLabel.hidden` and `outputPortLabel.hidden` at the
same diagram/module/group layers as other text properties. Existing per-property precedence
applies; explicit `false` restores text hidden by an inherited `true`.

Hidden text includes backgrounds and bus notation and reserves no text space. Preserve the
original name, IDs, endpoints and owning object. Terminal anchors and real Port targets remain
usable. Omitted labels still use ID fallback where supported; blank labels remain invalid.
`showPortLabels` is removed with no compatibility handling; update input files to text-style
`hidden`. See [hidden labels](../examples/blockchart/hidden-labels.json).

`diagram.style.connection.endArrow` and connection `style.endArrow` accept `none` (default)
or `triangle`. The arrow points into the destination along the final routed segment and
inherits line color/opacity. Its size is limited by that segment. Geometry participates in
image bounds and edge-label avoidance and is shared by SVG, PNG and DOM.

`layout.feedbackSide` accepts `auto` (default), `top`/`bottom` for horizontal flow, or `left`/`right` for Down. A side incompatible with the direction is invalid, even when Outer is disabled. It applies only when
`feedbackRouting` is `outer` (requires Right or Down). Auto compares accessible sides by
bends then length. A blocked requested side keeps the original ELK route and reports
`routingInfo.reason: "outer-access-blocked"`; it does not silently switch sides. Existing
terminal, boundary-scope and group-view fallbacks still apply. This is a diagram-wide setting. Ordinary
Container headings do not block the endpoint access segments, including Down flow.
Actual hardware and reserved signal-name nodes remain obstacles; Boundary headers
and collapsed frames retain their protection.
See [signal schematic](../examples/blockchart/signal-schematic.json) for all four features together.

### Portable style fields

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
[the styled example](../examples/blockchart/style-gallery.json) and Schema definitions for exact keys.

## Validate, render, inspect

From the repository root, install with `npm.cmd ci` (Node 22.12+), then run:

```powershell
npm.cmd run validate:diagram -- examples/blockchart/agent-minimal.json
npm.cmd run validate:diagram -- examples/blockchart/agent-minimal.json --svg output/agent-minimal.svg
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
coincident paths can overlap. See [the 16-instance example](../examples/blockchart/collection-instances.json).

Canonical types are `container` (default), `boundary`, `collection`. The old `portMode` field is rejected. Only Boundary ports are real endpoints.

### Group views are layout options

Keep the full document when drawing one group. After createDiagramModel(input), call
layoutDiagram(model, {rootGroupId: 'Inner'}); omit the option or use null for Top.
Do not remove external definitions or add rootGroupId to input JSON. Full validation precedes
scope projection. Group-view output has rootGroupId and keeps original connection IDs and
port ownership. The root is shown expanded without changing its stored collapsed flag;
descendants honor theirs. Outside edges, including outside same-group feedback, are omitted.
SVG/PNG from this layout show only the group; source JSON still describes the whole design.

## Vertical flow

Blockchart uses one layout configuration with module/layer spacing defaults of 20/30.
The former `layout.density` field is rejected; remove it from authoring JSON. Explicit
spacing, Grid gaps and physical width/height minimums retain their contracts. See
[layout defaults and routing](layout-defaults.md).

Routing uses body-stroke channel clearance, endpoint-local arrows, obstacle-aware
fixed paths and same-side Terminal rails near content. Eligible Auto regions credit
Container gutters against layer spacing. Ordinary Container titles occupy a top band;
wires may cross it and overlap the text directly, without a Container title mask.
Explicit text backgrounds still paint normally. Layout bounds and saved JSON are unchanged.

Ordinary Blocks without visible Port names use title-driven Auto sizing (minimum
64 x 36, text clearance 12/8 plus label padding and border). Receiver names and Port
slots may enlarge the face. Explicit width/height units remain 140 x 84; Concat keeps
its separate thin-bar geometry. See [the title-sized example](../examples/blockchart/compact-labels.json).

Use `layout.direction: "down"` for Top to bottom. Keep all module, port, terminal and
connection identities, widths and Concat input order. Inputs use top ports and outputs bottom
ports, with each side ordered left to right. Text remains horizontal, with space measured
for names and padding. Concat Bar becomes horizontal; trapezoid input/output sides become
top/bottom, with the existing `rightHeightRatio` parameter controlling the shorter output side.
Stack backing plates remain part of the full occupied bounds. Width/height minima remain
screen dimensions. Groups, collapsed groups, virtual Collection ports and scoped views use
the same axis. Terminals appear above/below the diagram.

Down exterior routing uses `feedbackSide: "auto"`, `"left"` or `"right"`; use `top`/`bottom`
only for horizontal flow. The editor maps sides when its Flow select changes axes; raw JSON
must already be consistent. Scoped/boundary/terminal and blocked-access fallbacks still
apply. See [vertical-flow.json](../examples/blockchart/vertical-flow.json).

## Grid and overview additions

Groups may set `layout.moduleSpacing` and/or `layout.layerSpacing` independently of
their layout type. Both are optional finite positive numbers. Omit to inherit the
nearest ancestor value, then root/default; null is invalid. They affect expanded
interior Auto layout (including Auto neighbors of a partial Grid), while the parent
controls external spacing. Grid `rowGap`/`columnGap` remain independent. Group views
retain inheritance, and collapsed groups preserve inactive overrides. Derived values
never enter saved group configs. `resolveLayoutSpacing(document, groupId)` from the
pure library resolves both values without mutation. See
[local-layout-spacing.json](../examples/blockchart/local-layout-spacing.json) and
[spacing contracts](layout-defaults.md#container-local-auto-spacing).

Root `layout` and group `layout` support `type: "auto"` (default) or `"grid"`. Grid requires
rectangular `cells`, containing any subset of direct members, at most once each, with null for blank cells.
Root direct members exclude grouped items and Terminals. Rows/columns are screen-space,
independent of Flow. Optional non-negative `rowGap` and `columnGap` default to 50 and 80.
They are minimum gaps. Down Grid regions automatically reserve horizontal tracks between
rows (Right uses vertical tracks between columns) and enlarge only crowded gaps. One
Net shares a track, disjoint ranges can reuse tracks and different Nets reserve separate
ink space. Blocked access keeps the prior route; perpendicular crossings remain possible.
Eligible ordinary Auto Containers also reserve tracks between adjacent geometric
flow bands, using existing local/inherited layer spacing and adding only missing space.
This first phase handles congested forward facing-Port links inside one Container;
cross-Container, skipped-band, feedback and side-facing links retain general routing.
Grid-controlled and protected subtrees retain their rules. See
[auto-routing-channels.json](../examples/blockchart/auto-routing-channels.json),
[grid-routing-channels.json](../examples/blockchart/grid-routing-channels.json)
and [routing contracts](layout-defaults.md#grid-routing-channels).
Cell sizes are measured, contents centered, and all connections rerouted orthogonally around
obstacles. Increase gaps/change sides when access is obstructed. Nested grids and scoped
group views retain IDs; collapse never rewrites stored cells. Unlisted members stay Auto.
The selected Grid is measured first and placed as one temporary rectangle among Auto
neighbors using real placement-affecting connections. Auto never enters the Grid rectangle,
including its empty tracks. No group or fake signal is added to JSON. An all-null Grid
reserves no rectangle and leaves every member automatic. New/moved-in members stay Auto;
deletion commands must explicitly replace removed references with nulls. See [partial-grid.json](../examples/blockchart/partial-grid.json).

Grid expansion is inferred entirely from `cells`. Place a nonempty direct Container ID
to keep it atomic, or replace it with all of its direct children, exactly once each, to
expand it. Parent and child IDs cannot coexist. Do not write `expandGroups`; the obsolete
field is rejected. Descendants beyond that one level stay inside their own atomic group. Boundary
and Collection cannot be expanded. Each Container's children must span a rectangular region
containing only its children or null; expanded regions cannot overlap even in empty cells.
Track gutters reserve headers/borders and minimum group sizes while all cells in a row or
column retain shared centers. Fit real Container frames after placement, then reroute.
Group membership, Port identity and real signals are unchanged. The ancestor Grid controls
positions while expanded; the Container's saved `layout` is retained for standalone group
views. All scopes remain validated. Adding an expanded Container member requires placing
it before exporting; ordinary unselected direct members remain Auto.
See [processor-cross-group-grid.json](../examples/blockchart/processor-cross-group-grid.json).

Ordinary blocks may omit `ports` or use `[]`; Concat keeps its port-count/sum rules.
Port `side` optionally fixes left/right/top/bottom; omission follows Flow. Input/output roles
are independent of side. `direction: "inout"` supports ordinary modules and Boundary ports,
with common/individual text styles and a right/bottom default side. Concat rejects inout.
When all Port names are hidden, block sizing uses its title and appearance plus minimum
connection-slot spacing, without invisible text lanes or extra Port rows. More Ports may
still enlarge the block; explicit width/height minima remain effective. Showing names
restores text-aware sizing. This applies to default and explicit sides in either Flow.
Connection `direction: "both"` requires inout at both ends and represents two directed paths,
validating both receiving faces. `forward` is default. Both defaults to triangle arrows at
each end; `style.startArrow` and `style.endArrow` can override independently.
`constraint: false` removes only placement participation; the real edge remains validated
and rendered after layout. Its drivers, widths and boundary checks are unchanged.

`diagram.caption` supplies a multiline footer; `diagram.style.caption` is a direct portable
text style, including hidden. It participates in image bounds and scoped exports.
See [Processor cluster overview](../examples/blockchart/processor-overview.json), which demonstrates nested
Grids, a transparent layout-only Container, isolated portless blocks, an upper-side
non-constraining bidirectional link, styles and a caption.

## Rounded groups and signal-only nodes

Group `style.borderRadius` is a non-negative logical SVG radius, default 0. Expanded
Container/Boundary/Collection frames and collapsed group faces/backing cards use it;
the renderer clamps it to half the inset rectangle width/height. This is a visual style:
group size, text positions, Port anchors and routing keep their existing geometry.
Block styles do not accept this property. The GUI edits it under Group Style > Corner radius.

For signal-only DOT nodes, contract the path into a labeled Connection, preserving
fan-out, each distinct input Port and auxiliary/control/feedback direction. If any
contracted segment is non-constraining, keep the contracted edge non-constraining.
Use abstract concat for actual signal collections; omit widths when xN means signal or
instance count. External endpoints can use hidden Terminals and visible edge labels.
Keep global collections outside their original group so scoped views retain the boundary.
See [processor-components.json](../examples/blockchart/processor-components.json): 13 physical blocks, three
abstract concats, nine rounded Containers, five Terminals, 20 Nets and 34 receiving branches.
It uses nested Auto layout without Grid. External interfaces use visible Terminals without duplicate Connection labels. Processor/ALU
repetition is documented by labels/caption rather than duplicating hardware instances.

## Port adjustment

Fixed orthogonal routing scores the complete path, including turns between endpoint
escape segments and the searched middle path. Equal-length clear candidates therefore
prefer fewer total bends. Departure/arrival directions stay fixed, immediate reversals
over escape segments are rejected, and obstacle/scope constraints remain intact. This
changes wire selection without moving Blocks or Ports and adds no authoring option.

By default, `layout.portAdjustment: "reduce-bends"` slides rectangular/stacked Block Ports
after placement without resizing or moving Blocks. `layout.maxPortShift` bounds movement
from each initial anchor (default 40 logical units); zero keeps them fixed. Sides, same-side
order, minimum 16-unit anchor gaps and text clearance remain constraints. Port names follow
their anchor. Concat, other appearances, Group Ports and feedback anchors stay fixed.
Terminal anchors and names move together perpendicular to flow, within the same shift limit.
Their order and spacing are preserved, and moves overlapping Blocks, Groups or other
Terminals are rejected. Terminal adjustment also rejects changes that increase
connection-label clearance warnings. Source signal nodes may slide with their source within the existing wrapper.
All affected Net branches participate in the comparison; crossing/obstacle counts cannot
increase. A deterministic search (four passes, 128 trials maximum) accepts improvements in
bends, displacement, then length. Reserved Inline names follow their Ports; final arrows follow adjustment. This applies to
Auto, Grid and group views; saved JSON contains settings, never adjusted coordinates.
Set `layout.portAdjustment: "fixed"` to disable sliding. An obstacle or disjoint ranges can require bends even with adjustment.
Use examples/blockchart/port-adjustment.json for a six-interface reference.

Reduce-bends prioritizes fewer bends, then less total displacement from initial
Port/Terminal anchors, then shorter routed length. It does not move an initially
fixed anchor solely to shorten a route with the same bend count. Real bend reduction
can still justify movement within the existing bounds and safety constraints.

Reduce-bends first tries aligning at the current Port position of the less-populated
face when both endpoints can move. This keeps a centered single-Port interface stable
when the multi-Port peer can make the alignment. Sparse faces remain movable if that
choice is blocked or out of range; existing bounds/safety/quality checks still apply.

## Single-source Nets and source signal nodes

Prefer a Connection with a stable `id`, one `from` and a nonempty `to` array. A target is an
endpoint or an object with `endpoint`, optional `constraint`, `feedback` and line-only `style`.
Names, text styles and the source arrow are common to the Net; branch styles cannot contain `label` or `startArrow`. A source
belongs to one Net. Duplicate receivers, a receiver equal to the main endpoint, conflicting
drivers, inconsistent known widths and boundary violations are rejected. Omit unknown widths.
Every `to` value must be a nonempty array, including one-to-one Nets.

`direction: "both"` extends a Net to an abstract main/reference endpoint plus multiple peers.
Every participating Port must be `inout`. Repeated participation of the main endpoint inside
one Net is legal; occupied receiving faces cannot belong to an unrelated Net. This does not
simulate commands, arbitration, selected responders, electrical driving or timing. Arrows
are independent style overrides. Concat continues to be an element with ordinary input/output
Nets, not a multi-source Net.

A labeled Net compiles to a small virtual signal node in an invisible local source group,
with text-sized geometry and an 8-unit gap. Enclosing Auto/Grid layout includes its footprint.
The virtual structures are removed from exported hardware/layout membership and saved JSON.
One shared Inline name remains near the source; common trunks are drawn once.
`style.label.repeatAtEnd` (`auto`/`always`/`never`, default `auto`) controls receiver Inline
nodes placed beside the receiving Port. Always reserves them before the first layout; Never
omits them. Auto compares first-pass routed branch length against positive `longThreshold`
(default 600), freezes the selected branches and runs one additional layout. No third pass
or removal/reselection occurs when routes change. Receiver footprints follow Port sides and
order, may enlarge multi-Port targets (including Concat) across the flow, and can change
Block placement. Arrows still terminate at physical Ports. Output Terminal names are packed
with their receiver nodes. Saved JSON and public hardware membership contain no virtual
objects. Hidden omits every source/receiver footprint and label. Old label placement/position
fields are rejected.
Compiled branches expose `netId`, `connectionIndex`, `branchIndex` and ordinary endpoint IDs.
See net-fanout.json and net-bidirectional.json in examples, plus processor-components.json.

### Net label frames

Net `style.label` and `diagram.style.connection.label` additionally support
`borderColor` (default transparent), `borderWidth` (default 1; zero disables the frame),
`borderOpacity` (default 1) and `borderRadius` (default 0). Width and radius must be finite
and non-negative; opacity is in [0, 1]. Frames use a solid stroke and apply to both the
shared source name and destination Inline labels. They are independent of the Net line color.
Strokes stay inside the reserved text-and-padding bounds; width and radius are clamped to
fit. Use `padding` for breathing room around text. `hidden` hides text, fill and frame.
These frame fields belong only to connection labels, not Terminal or Port text styles.
The editor exposes them in Connection style > Label; blank values inherit defaults.

```text
{
  "backgroundColor": "#FFF9E6",
  "padding": 4,
  "borderColor": "#B38900",
  "borderWidth": 0.8,
  "borderRadius": 4
}
```

The snippet is the value of `style.label`. See `examples/blockchart/connection-labels.json` for a
complete diagram (Agent Kit users can author the same style directly).

## Runtime ownership

Hardware diagram implementation lives in `src/lib/blockchart`. Existing public entries
`src/lib/index.js`, `node.js`, `browser.js` and `export/dom.js` retain their exports.
Flowchart uses a separate schema and runtime under `src/lib/flowchart`; see
[Flowchart documentation](flowchart.md). Do not feed Flowchart JSON to the Blockchart CLI
or Agent Kit. Both domains use the tools in `src/lib/shared`.

## Diagram style defaults

The editor's **Defaults** workspace page edits the current document, using Text, Blocks,
Groups, Connections, Terminals and Caption categories. Apply validates every category and
commits one Undo step; Discard removes only unapplied edits. Category/page changes preserve
raw drafts; local recovery also restores them. Save JSON and image export require applying
or discarding the draft. Preview reflects committed styles.

`diagram.style.text` is a common portable text base. `module`, `group`, `connection`,
`terminal` and `caption` provide type-specific defaults. Module/Group names and Net names use
`label` subobjects; Terminal, Caption and Text styles are direct text objects. Local fields
win independently. Omitted fields inherit; explicit false and zero remain overrides where
allowed. Do not copy computed defaults into each object.

Port precedence is built-in text, shared Text, diagram module All ports/direction, diagram
Group All ports/direction for Group interfaces, owner All ports/direction, then Port style.
This keeps diagram module Port defaults shared with Group interfaces, while Group defaults
can specialize them. Collapsed Collection virtual Ports use the same resolution.

Individual Style dialogs show the inherited value and its source. Blank controls remain
blank; placeholders and help are informative, never authored values. Defaults also show
the next inherited value, ending at the built-in style. Diagram styling does not change
editor chrome or application preferences. See [the defaults example](../examples/blockchart/default-styles.json).

## Text alignment

Text styles accept `textAlign: "left" | "center" | "right"` for lines inside the
existing text block. Omission preserves current alignment; geometry and single-line
placement stay unchanged. See [the shared alignment contract](text-alignment.md)
for inheritance, field paths and Statechart description alignment.
