# Blockchart Agent Kit

Build: `{{KIT_VERSION}}`

Use this kit to turn a screenshot or a text description into editable Blockchart JSON and
an automatically laid-out SVG. The agent interprets the source and writes JSON; the
converter validates and renders that JSON. It does not recognize images or call an AI.

Blockflow is the project name, covering Blockchart and Flowchart. This section describes
the Blockchart (hardware diagram) converter. The independent Flowchart converter is
documented in its own section below.

To use Blockchart alone, copy these three files:

- `blockchart.schema.json`: JSON Schema Draft 2020-12 for authoring documents.
- `README.md`: field semantics, authoring workflow and executable examples.
- `blockchart-convert.mjs`: standalone Node.js CLI and importable API, including the
  authoritative model validator, ELK layout and SVG renderer.

Requires **Node.js 22.12 or later**. No package installation, project source, browser,
network, server or editor is needed. Move these three files together to any directory.
Only JSON and SVG output are supported. PNG is not included.

## Recommended agent workflow

1. Identify real blocks, external interfaces, ports and connections. Assign stable IDs.
2. Choose horizontal or vertical flow. Reproduce connectivity and intent first; ELK owns
   placement. Exact screenshot coordinates and pixel matching are not supported.
3. Write a raw version 1 authoring document using the schema and rules below. Do not write
   normalized models, layout records, localStorage wrappers, HTML or SVG as input.
4. Run `--check`, fix the reported semantic error, and repeat until valid.
5. Export SVG. Inspect the image and any label-placement warnings, then adjust names,
   grouping, relative sizes, styles or spacing and render again.
6. Deliver the JSON and/or SVG. The JSON remains editable authoring data.

Open or edit the JSON in blockflow Studio. For GUI usage, see the
[Studio editing guide](https://github.com/rexrainbow/blockflow/blob/main/docs/studio.md).
This kit documents the JSON contract and converter APIs; the optional GUI guide is
external to the standalone kit.

Schema validation alone cannot check references, driver conflicts, hierarchy, boundary
crossings or Concat sums. The converter's model validator is authoritative. It does not
silently migrate obsolete fields, repair broken links or insert defaults into saved JSON.

## CLI

```powershell
node blockchart-convert.mjs diagram.json --check
node blockchart-convert.mjs diagram.json --output diagram.svg
node blockchart-convert.mjs diagram.json --output formatted.json
node blockchart-convert.mjs diagram.json --output group.svg --view Processing
node blockchart-convert.mjs diagram.json --output diagram.svg --diagnostics json
node blockchart-convert.mjs --version
node blockchart-convert.mjs --help
```

Quote paths containing spaces. Any working directory is supported; input/output paths
resolve relative to that working directory. `--view` is SVG-only and selects an existing
group ID; omit it to draw the entire diagram. The whole graph is validated before scoping.
SVG shows that group's frame, real interface ports and subtree, excluding external edges.
The selected root is expanded; descendants keep their collapsed settings.

Use input `-` to read UTF-8 JSON from stdin. A UTF-8 BOM is accepted. Use `--output -` with
`--format json` or `--format svg` to send data to stdout. Otherwise the output filename
must end in `.json` or `.svg`; an explicit `--format` must match its extension.

`--check` only validates; it does not perform layout or create files. JSON export validates
and pretty-prints the original full document, preserving port order, optional omissions,
labels and styles. It never saves inferred widths, layout coordinates or virtual ports.
SVG export uses the same model/layout/renderer as the editor. Export creates parent output
directories and replaces an existing output file, but refuses to overwrite the input JSON,
including path aliases. Validation/layout failures leave existing output files untouched.

**All diagnostics go to stderr.** Only explicit stdout export, help and version use stdout.
`--diagnostics json` emits one JSON diagnostic object with `ok`, `stage`, optional `path`,
`message` on failure, `warnings` on success, and `kitVersion`. This keeps data pipelines clean.
Stages include `arguments`, `read`, `JSON`, `validation`, `layout`, `SVG`, `write` and `export`.
Exit codes: **0** success, **1** input/validation/layout/I/O failure, **2** argument error.
Label-placement warnings such as `EDGE_LABEL_OVERLAP` keep a usable SVG and exit 0; inspect
the image and shorten labels or increase spacing. A check-only success does not guarantee
that a later layout has no warnings.

## Minimal complete document

Save this as `diagram.json`, then run the first two commands above:

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
          "id": "out",
          "direction": "output"
        }
      ]
    },
    {
      "id": "Sink",
      "ports": [
        {
          "id": "in",
          "direction": "input"
        }
      ]
    }
  ],
  "connections": [
    {
      "from": "Source.out",
      "to": ["Sink.in"],
      "label": "Data"
    }
  ],
  "layout": {
    "direction": "right"
  }
}
```

## Identity, names and connectivity

- Required root fields: `version: 1`, `diagram` with non-blank `name`, and `modules`.
  Optional: `connections`, `groups`, `terminals`, `layout`. Unknown properties are rejected;
  do not add `$schema` inside a diagram. Configure schema association outside the document.
- At least one module or group is required. `modules: []` is valid for group-only diagrams.
  Ordinary modules may omit ports or use an empty array. Concat still requires input/output ports. Unconnected ports and empty groups are allowed.
- IDs match `[A-Za-z_][A-Za-z0-9_]*`. Block, group and terminal IDs share one unique namespace;
  port IDs are unique within their owner across input/output directions.
- Optional `label` is display text; omit it to use the ID for blocks, groups, ports and
  terminals. Omit a connection label for no text. Explicit blank strings and null are invalid.
  Display text supports Unicode and LF line breaks; CRLF becomes LF. IDs and `diagram.name`
  are single-line; tabs, bare CR and unsupported XML/control characters are invalid.
  The diagram name is metadata, not a rendered heading. Renaming an ID requires updating
  every affected endpoint and group membership reference.
- Normal endpoints are strings such as `Source.out`. `from` must send and `to` must receive.
  One output may fan out; an input has one driver. Duplicate edges are invalid. Self-loops
  and multi-block cycles are allowed. Crossing lines do not create junctions or shared nets.
- Port `width` is an optional positive safe integer **bit count**. Omit it for unknown;
  never write null. Only two explicitly known endpoint widths must match. One known end
  determines that connection's width, without inferring any other port or branch width.
  Bus notation is appended to port/terminal names when width is greater than one.
- Module/group `width` and `height` are optional positive finite **relative minimum sizes**
  in fixed 140-by-84 units. They are unrelated to port bit width. Omit for Auto; content may
  enlarge the shape. Text and strokes are not scaled. Extra size does not force straight wires.

## Flow, appearance and labels

Use `layout.direction: "right"` for Left to right or `"down"` for Top to bottom.
Only `right` and `down` flow are accepted.
Input/output ports use left/right for horizontal flow and top/bottom for Down. Port array
order is top-to-bottom horizontally and left-to-right in Down. Text remains horizontal.
Relative width/height stay screen dimensions. Module and connection array order does not
guarantee placement. Do not invent coordinates, edge IDs, ranks, `alignmentGroups`,
`layout.orderMode`, edge order or alignment fields.

Optional module `appearance` is an object with one of these exact profiles:

| Type        | Parameters                             | Meaning                                                          |
| ----------- | -------------------------------------- | ---------------------------------------------------------------- |
| `rectangle` | `type` only                            | Default ordinary block                                           |
| `bar`       | `type` only                            | Compact bar; default for Concat; horizontal in Down              |
| `stacked`   | `layers`: integer 1–3, default 2       | Visual backing plates only; no members or expansion              |
| `trapezoid` | `rightHeightRatio`: 0.2–1, default 0.6 | Shorter centered output side; right horizontally, bottom in Down |

Appearance controls title, port placement and the full occupied bounds. Routing avoids a
conservative rectangular footprint. Groups do not accept module `appearance`; their
collapsed behavior is controlled by group type. Concat only permits Bar (or omitted appearance); ordinary Block appearances do not change connectivity.

## Concat: optional widths and ordered composition

Use module `type: "concat"` for multiple ordered input ports and exactly one output.
Ordinary modules omit `type` or use `"block"`. First input is the high part for bit-level
concatenation, independently of where source blocks are placed. Do not simulate this by
giving one input multiple drivers. Each input keeps its own endpoint.

Concat always uses a thin Flow-aligned Bar. Down: inputs top, output bottom, horizontal
bar. Right (also the default): inputs left, output right, vertical bar. Omit Port `side`
to follow Flow; an explicit conflicting side is rejected, including on feedback inputs.
Concat only accepts omitted `appearance` or `{ "type": "bar" }`. Ordinary Block Bar
appearance retains its general-purpose behavior and side choices.

Input order determines anchor order; the output is centered between the outer inputs.
The filled body thickness is 12 logical units plus border-width allowance, independent
of label sizes. Names, visible Port text and receiving Net labels reserve external
layout space or lengthen the bar. Width/height minima apply to the layout envelope;
they do not thicken its body. JSON retains only authoring values, never these calculated
positions or label reservations.
Physical input/output anchors and arrow tips stay on the bar edges, including with
multiline titles, visible Port names and explicit size minimums. The engine restores
bar anchors after ELK and repairs affected routes in Auto, Grid and scoped views.
The reserved text envelope remains available for placement and obstacle avoidance.

- No widths: abstract composition, no sum check.
- Partial widths: preserve annotations; skip the sum check.
- Every input and the output explicitly sized: output must equal the input sum.

Widths are never inferred or propagated. Existing per-connection width checks still apply.
There are no automatic bit-range labels. This standalone example is abstract; adding widths
16, 16 and 32 to its three ports enables the sum check:

```json
{
  "version": 1,
  "diagram": {
    "name": "Abstract composition"
  },
  "modules": [
    {
      "id": "Combine",
      "type": "concat",
      "label": "Concat",
      "style": {
        "label": {
          "hidden": true
        },
        "portLabel": {
          "hidden": true
        }
      },
      "ports": [
        {
          "id": "first",
          "direction": "input"
        },
        {
          "id": "second",
          "direction": "input"
        },
        {
          "id": "out",
          "direction": "output"
        }
      ]
    }
  ],
  "layout": {
    "direction": "down"
  }
}
```

## External terminals

Root `terminals` are named external interfaces without real blocks. Each requires `id`
and `direction` (`input` supplies the graph, `output` receives from it); optional fields are
multiline `label`, bit `width` and direct text `style`. Use an endpoint object containing
**only** `terminal`, such as `{ "terminal": "ExternalInput" }`. Do not use a bare terminal
ID or an `@terminal:` string. The other end must be a real block/Boundary port. An external
input may fan out; an external output has one incoming driver. Terminals are root items,
cannot be group members or bypass boundaries, and do not replace the required block/group.
They appear left/right or top/bottom for the selected flow.

Same-side Terminal anchors align by default: a common X for each input/output side in
horizontal flow, or a common Y for each side in Down flow. Terminal text and associated
virtual signal labels move together. Their complete envelopes stay outside the internal
Block/Group layout; overlapping same-side envelopes are separated along the side before
affected connections are rerouted. Reduce bends then moves Terminals only along that side,
preserving alignment. No authoring setting or coordinates are required.

```json
{
  "version": 1,
  "diagram": {
    "name": "External interfaces"
  },
  "terminals": [
    {
      "id": "ExternalInput",
      "label": "Input",
      "direction": "input"
    },
    {
      "id": "ExternalOutput",
      "label": "Output",
      "direction": "output"
    }
  ],
  "modules": [
    {
      "id": "Logic",
      "ports": [
        {
          "id": "in",
          "direction": "input"
        },
        {
          "id": "out",
          "direction": "output"
        }
      ]
    }
  ],
  "connections": [
    {
      "from": {
        "terminal": "ExternalInput"
      },
      "to": ["Logic.in"]
    },
    {
      "from": "Logic.out",
      "to": [
        {
          "terminal": "ExternalOutput"
        }
      ]
    }
  ]
}
```

## Groups and real boundaries

Keep modules and connections flat. Root `groups` entries require `id` and `members`
(module or group IDs); optional fields include `label`, `type`, `style`, `width`, `height`,
`ports` and `collapsed`. An object has at most one parent. No duplicate
members, unknown members, self/indirect cycles or terminal members. Unlisted items stay root.

| Group type            | Connectivity                                                             | Collapse                                                |
| --------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| `container` (default) | Direct child connections; stored group ports inactive                    | Cannot collapse                                         |
| `boundary`            | Real interface ports; every boundary must be crossed one level at a time | Same ports on the collapsed face                        |
| `collection`          | Direct when expanded                                                     | Visual stack and member count; virtual crossing anchors |

For a Boundary, outside input receives and outside output sends; inside input sends to
children and inside output receives from children. Use explicit edges at every level:
`Source.out -> Outer.in -> Inner.in -> Child.in`, then
`Child.out -> Inner.out -> Outer.out -> Sink.in`. Each endpoint face has a single incoming
driver and may fan out. Input-to-output inside pass-through and output-to-input outside
feedback are distinct valid connections. Width checks remain per connection.

Set `collapsed: true` on Boundary/Collection to hide contents while preserving all members,
definitions and original edges. Full validation still runs for hidden data. Container
rejects true. Ancestor collapse wins. Collection uses virtual Input/Output anchors only
in layout; never author them in JSON or rewrite original endpoints. Crossing edges retain
separate identities and styles, even when visually coincident. Grouping does not impose
same-rank alignment or fixed positions. The old `portMode` field is rejected.

## Portable styles and hiding text

Defaults are `diagram.style.module` and `diagram.style.connection`. Local module, group,
port, terminal and connection `style` objects override supported fields per property.
Use exact keys from the schema, never CSS, HTML, URLs, font-family strings or scripts.

- Module/group border/fill: `borderColor`, `borderWidth`, `borderStyle`, `borderOpacity`,
  `fillColor`, `fillOpacity`; text subgroups: `label`, `portLabel`, `inputPortLabel`,
  `outputPortLabel`.
- Connection: `strokeColor`, `strokeWidth`, `lineStyle`, `opacity`, `startArrow` / `endArrow` (`none` default
  or `triangle` at the destination), and `label` text style. Arrows follow the final route
  and share line color/opacity. Bit width does not force a user-specified stroke width.
- Text: `color`, `fontSize`, `backgroundColor`, `padding`, `opacity`, `backgroundOpacity`,
  `hidden`. Terminal and individual Port styles are text styles directly.
- Colors: hex `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA` or `transparent`. No CSS color names or
  functions. Patterns: `solid`, `dashed`, `dotted`. Font/border/stroke sizes must be positive
  finite numbers; padding is non-negative. All opacity values are in [0, 1].
- Port text precedence: diagram common, diagram direction, owner common, owner direction,
  individual Port. Group border/title defaults are independent of module border/title
  defaults; shared diagram Port text defaults also apply to group interfaces.

Every text style supports boolean `hidden`, default false. Terminal/Port use `style.hidden`;
Block/Group/Connection names use `style.label.hidden`; shared Port names use
`style.portLabel.hidden` or direction-specific text styles. Explicit false overrides
inherited true. Hidden text, backgrounds and bus notation reserve no text space; preserve
the original name and owning object, anchors and connections. Omission still uses ID fallback
where supported. Empty labels remain invalid. `showPortLabels` is not supported.

Source and receiver Inline labels reserve virtual nodes beside their Ports, controlled by `repeatAtEnd` and `longThreshold`.
Never author `xlabel`, manual label coordinates or rotations.
SVG uses monospace text with conservative width estimates; actual font appearance depends
on the viewer. Inspect the rendered result when long or non-Latin names are important.

## Nets and virtual signal labels

For new authoring, prefer array-target Connections such as
`{"id":"data","from":"ALU.result","to":["Register.data","Comparator.data"],"label":"Result"}`.
Each target may instead be an object with `endpoint`, optional `constraint`, `feedback` and
line-only `style`; label styles and `startArrow` belong to the whole Net. A source has one Net. Targets cannot
repeat, equal the main endpoint or conflict with another driver. All known shared widths
must agree. Unknown widths remain valid. Boundary-port face rules are unchanged.

Set `direction: "both"` for one main/reference endpoint plus N abstract bidirectional peers;
all Ports must be `inout`. The main endpoint may participate in every branch of the same Net.
Unrelated Nets cannot claim occupied faces. This describes connectivity without arbitration,
responder selection, electrical or timing simulation. Arrow style overrides remain cosmetic.
Concat remains a real element joining separate input Nets into its output Net.

A labeled Net reserves one small source-adjacent virtual signal node, with measured text and
an 8-unit local gap. Its source footprint participates in hierarchical Auto/Grid placement.
Virtual nodes/groups never enter saved JSON or exported hardware. A common Inline name stays
near the source. Receiver names are also Inline nodes, adjacent to their receiving Ports:
`style.label.repeatAtEnd` is `auto` (default), `always` or `never`; positive `longThreshold`
defaults to 600 logical units. Always includes receiver footprints in the first layout; Never
omits them. Auto tests first-pass routed source-to-target length, freezes the selected
branches and runs one more layout with their receiver nodes. At most two passes are used;
second-pass lengths do not alter the selection. Receiver nodes follow Port sides and order.
Multi-Port targets, including Concat, may grow across the flow to fit names. Terminal receiver
names are packed locally too. Placement may change; explicit dimensions remain minima.
The short tail still ends at the physical Port. Hidden removes every virtual footprint and
label. Conflicts still produce warnings. Scalar targets and retired fields are rejected
without automatic migration.

## Layout and exterior feedback

All connections participate together in one layout, not staged batches. The accepted
layout options are:

| Field                 | Values / default                                               |
| --------------------- | -------------------------------------------------------------- |
| `direction`           | `right` default, `down`                                        |
| `routing`             | `orthogonal` only                                              |
| `placement`           | `default` default, `relaxed`, `simple`                         |
| `moduleSpacing`       | Positive finite number, default 20                             |
| `layerSpacing`        | Positive finite number, default 30                             |
| `portAdjustment`      | `reduce-bends` default, or `fixed`                             |
| `maxPortShift`        | Finite non-negative logical SVG distance, default 40           |
| `feedbackRouting`     | `elk` default or `outer`                                       |
| `feedbackSide`        | `auto` default; horizontal `top`/`bottom`, Down `left`/`right` |
| `feedbackMargin`      | Positive finite number, default 20                             |
| `feedbackLaneSpacing` | Positive finite number, default 12                             |

An incompatible side is invalid even when Outer is disabled. When changing JSON flow axes,
map Top ↔ Left and Bottom ↔ Right yourself; the converter does not rewrite settings.
`outer` supports Right and Down. It attempts routes outside the visible
bounding rectangles. A blocked requested side keeps the ELK route without switching sides.
Terminal edges, boundary-scoped edges and group views retain their ELK routing fallbacks.
Endpoint access may pass through an ordinary Container heading in Right or Down flow.
Real hardware and reserved signal labels still block access; Boundary headings and
collapsed frames keep their existing protection. A genuinely blocked side falls back.

Connection `feedback: true` lowers its direction priority during cycle breaking. It does
not itself enable Outer, force backward routing, align blocks or remove ranking constraints.
Omit it or use false for normal priority. Unused ports, cycles, long labels and groups can
change the arrangement; reproduce intent instead of promising exact screenshot geometry.

## Port adjustment

Fixed orthogonal routing scores the complete path, including turns between endpoint
escape segments and the searched middle path. Equal-length clear candidates therefore
prefer fewer total bends. Departure/arrival directions stay fixed, immediate reversals
over escape segments are rejected, and obstacle/scope constraints remain intact. This
changes wire selection without moving Blocks or Ports and adds no authoring option.

By default, `layout.portAdjustment: "reduce-bends"` enables a bounded post-placement pass that may slide
rectangular/stacked Block Ports along their existing side. It preserves Block positions and
sizes, Port order, at least 16-unit anchor spacing and label/title clearance. Names move with
anchors; source signal nodes move only within their reserved wrapper. Concat, other shapes,
Group Ports and feedback anchors remain fixed. Terminal anchors and names move together
perpendicular to flow with the same shift limit; order and separation are preserved, and
moves overlapping Blocks, Groups or other Terminals are rejected. Terminal adjustment also rejects changes that increase
connection-label clearance warnings. `maxPortShift` limits movement
from the initial anchor (default 40); zero or `portAdjustment: "fixed"` disables it. All affected Net branches are checked together.
Obstacle-hit and foreign-Net crossing counts cannot increase; accepted changes improve
bends, displacement, then length. Search is deterministic and bounded to four passes/128
trials, with no global optimum guarantee. Reserved Inline names follow their Ports; final arrows follow this pass. Auto/Grid,
group views and the editor share this pipeline. JSON export preserves configuration only.

Reduce-bends prioritizes fewer bends, then less total displacement from initial
Port/Terminal anchors, then shorter routed length. It does not move an initially
fixed anchor solely to shorten a route with the same bend count. Real bend reduction
can still justify movement within the existing bounds and safety constraints.

Reduce-bends first tries aligning at the current Port position of the less-populated
face when both endpoints can move. This keeps a centered single-Port interface stable
when the multi-Port peer can make the alignment. Sparse faces remain movable if that
choice is blocked or out of range; existing bounds/safety/quality checks still apply.

## Importable JavaScript API

Importing the converter performs no CLI work:

```javascript
import { validateDiagram, convertDiagram, KIT_VERSION } from './blockchart-convert.mjs';
validateDiagram(document); // { ok: true }, or throws with stage/path
const svg = await convertDiagram(document, { format: 'svg' });
// svg.text is SVG; svg.warnings contains layout warnings.
const json = await convertDiagram(document, { format: 'json' });
const scoped = await convertDiagram(document, { format: 'svg', rootGroupId: 'Processing' });
```

The default format is SVG. Input objects are not mutated. JSON always saves the full raw
document; `rootGroupId` is SVG-only. These functions return strings and do not write files.
Use `KIT_VERSION` or CLI `--version` to identify this matched build of schema, guide and code.

## Bundle provenance

The converter bundles the project's model/layout/SVG code and elkjs {{ELK_VERSION}}.
ELK source and notices: https://github.com/kieler/elkjs . Its license is reproduced below.
No Sharp or PNG renderer is bundled. The separate schema is for agent/editor tooling;
conversion uses the bundled authoritative validator and does not fetch external schemas.

Project maintainers regenerate all three artifacts with `npm run build:agent-kit` in the
source checkout. Kit consumers never need that checkout or the build toolchain.

## Grid and overview diagrams

Groups can override `layout.moduleSpacing` and `layout.layerSpacing` with finite
positive numbers. Each omitted property inherits the nearest ancestor override, then
root/default. Null/zero are invalid. These are interior Auto spacing budgets; the
parent controls the group's external spacing. Grid row/column gaps stay independent,
but Auto neighbors of a partial Grid use local spacing. Collapsed groups retain
inactive settings, and group views retain inherited values. Saved JSON preserves
omissions rather than copying effective defaults onto every group. For example,
`"layout": { "layerSpacing": 60 }` keeps Auto mode and inherits module spacing.

Grid gaps are minima: Down reserves horizontal routing tracks between source rows;
Right reserves vertical tracks between source columns. Only crowded gaps expand.
One Net shares its fan-out track, disjoint spans may reuse a track and different Nets
reserve separate ink space. Physical/synthetic labels and scoped obstacle rules still
apply. Blocked access keeps the previous path; perpendicular crossings can remain.
This is automatic runtime behavior with no additional authoring fields. Eligible
ordinary Auto Containers also reserve tracks between adjacent geometric flow bands.
Only congested forward facing-Port links within one Container participate. Local or
inherited layerSpacing provides the initial budget; only missing space is added.
Transverse positions/order stay fixed while later layers and enclosing frames may
move/grow. Root/cross-Container traffic, skipped layers, feedback, bidirectional and
side-facing links keep general routing. Grid-controlled and Boundary/Collection
subtrees retain their existing behavior. Safe-access failure retains a general route;
arbitrary diagrams are not promised to be crossing/overlap-free.

Use `layout.type: "grid"` and rectangular `layout.cells` at the root, or put the same
configuration in a group's `layout`. Omission or `type: "auto"` keeps automatic placement.
Each non-null cell is a direct member ID, used at most once; null reserves an empty slot.
Choose any subset; unlisted direct members remain automatic. Root members exclude items already
in a group and exclude Terminals. Rows run top to bottom and columns left to right,
independently of Flow. Cells share measured row heights/column widths and center their
contents. Optional non-negative `rowGap` / `columnGap` default to 50 / 80. Empty tracks use
140-by-84 logical minimum space. Container nesting can express layout-only columns: hide
its title, border and fill when no frame should appear. Grid does not imply electrical links.

The selected Grid is measured first and acts as one temporary rectangle in automatic
placement among unlisted members, using the real constraint-enabled signals. Empty tracks
remain reserved: Auto cannot fill the rectangle. This never changes JSON groups or real
connections. An all-null Grid leaves every member automatic and reserves no rectangle.
Rows/columns are implied by cells, without separate dimension fields. New members stay Auto.
Auto neighbors may move or their routes may lengthen when the Grid changes.

To align across Containers, put the direct children of a nonempty direct Container
(e.g. ComputeCluster) in `cells` instead of its ID. Expansion is inferred from the cells;
every such child must occur exactly once. Do not also put the Container ID in a cell.
Omitting both keeps the Container automatic. The obsolete `expandGroups` field is rejected. Boundary and Collection remain whole participants. Each expanded Container
must occupy a disjoint rectangular cell region with no outside members (null is allowed).
Shared tracks reserve group header/frame gutters and minimum dimensions, then fit the
real frames around those regions. The controlling Grid suspends each expanded Container's
own saved layout, while standalone group views use that saved layout again. Membership,
Ports and signals never change. Other direct members may remain Auto; expanded members
may not. New members need Grid placement before export. Expansion is one level per scope;
child groups remain whole participants and can use their own layouts internally.

Grid uses fixed placements followed by obstacle-aware orthogonal routing. Increase gaps or
change port sides if the router reports obstructed access. Auto parents preserve their
layout where possible and move overlapping siblings after a nested Grid grows. Collapse
keeps saved grids; group views use the selected subtree's grids, not the root grid.

Port `side` optionally chooses `left`, `right`, `top` or `bottom`, independently of direction.
Omit it to follow Flow. Explicit physical sides stay fixed when changing Flow. Ordinary
modules and Boundary interfaces accept `direction: "inout"`; its default side is right
(or bottom for Down). Shared Port text styles apply to inout ports; input/output-specific
text defaults do not. Concat does not accept inout.

Group `style.borderRadius` optionally sets a non-negative logical SVG corner radius,
default 0. Values such as 12 round expanded group frames and collapsed faces/cards;
values exceeding half the inset rectangle dimensions are clamped. Group geometry and
Port/routing positions are unchanged. This is a group-only style, not a Block appearance.

When a source diagram uses nodes only to name signals, prefer labeled connections and
abstract concat collections. Preserve separate input roles, fan-out, feedback/control
styles and non-constraining edges; do not infer Port widths from signal/instance counts.
Hidden Terminals can anchor external labeled wires. Keep cross-group/global collection
concats in their original scope, and omit wrappers left empty after removing signal nodes.
When every Port name is hidden, the block reserves only connection-slot spacing around
its title/appearance, without text lanes or phantom Port rows. Port count may still grow
the block; explicit width/height minima are retained. Visible names use text-aware sizing.

Connection `direction: "both"` requires two inout ports and represents two directed paths.
Both receiving faces participate in driver validation; known widths must match. It defaults
to triangle arrows at both ends, with shared/local startArrow/endArrow style overrides.
Ordinary `forward` connections may also use inout ports. `constraint: false` leaves all
reference, width, boundary and driver checks enabled, but removes the edge from placement
and routes it afterward. It does not create an invisible fake signal.

Use `diagram.caption` for a non-blank multiline footer. Its direct text style is
`diagram.style.caption`; hidden removes text, background and reserved space. Caption bounds
are included in SVG/PNG/DOM and scoped SVG exports. Ordinary blocks can now have zero ports
(including omitted ports); Concat retains its at-least-one-input/exactly-one-output rule.

### Net label frames

Net `style.label` and `diagram.style.connection.label` additionally support
`borderColor` (default transparent), `borderWidth` (default 1; zero disables the frame),
`borderOpacity` (default 1) and `borderRadius` (default 0). Width and radius must be finite
and non-negative; opacity is in [0, 1]. Frames use a solid stroke and apply to both the
shared source name and destination Inline labels. They are independent of the Net line color.
Strokes stay inside the reserved text-and-padding bounds; width and radius are clamped to
fit. Use `padding` for breathing room around text. `hidden` hides text, fill and frame.
These frame fields belong only to connection labels, not Terminal or Port text styles.
Omit individual fields to inherit diagram defaults or built-in values.

```text
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

## Diagram domain

Blockchart uses one layout configuration with module/layer spacing defaults of 20/30.
The retired `layout.density` field is rejected, including `"standard"` and `"compact"`;
remove it from existing JSON. Explicit spacing, Grid gaps and physical size minimums
keep their contracts. No derived geometry or internal mode is serialized.

The engine uses body-stroke channel spacing, endpoint-local arrows, obstacle-aware
routing and same-side Terminal rails near content. Eligible Auto Container regions
credit existing gutters against layer spacing. Ordinary Container titles reserve a
top band and minimum frame width. Wires overlap headings directly, without a Container
title mask; conservative text bounds are only layout/hit geometry. Explicit text
backgrounds still paint normally. Transparent and nested frames are not repainted.

Blocks without visible Port names use title-driven Auto faces (minimum 64 x 36),
with text clearance 12/8 per side plus label padding and border allowance. Port counts,
receiver names and shapes may enlarge them. Visible Port names keep text-aware geometry.
Explicit width/height units remain 140 x 84. Concat retains thin-bar geometry and actual
per-Port receiver-name reservations. Smaller Blocks can reflow the layout; fewer bends
or smaller total area are not guaranteed.

This converter accepts Blockchart (hardware diagram) JSON. Use `flowchart-convert.mjs`
with `flowchart.schema.json` for process diagrams. The two formats are independent.
Source relocation into `src/lib/blockchart` preserves the Blockchart API and formats.

## Diagram style defaults

`diagram.style.text` is a common portable text base. `module`, `group`, `connection`,
`terminal` and `caption` provide type-specific defaults. Module/Group names and Net names use
`label` subobjects; Terminal, Caption and Text styles are direct text objects. Local fields
win independently. Omitted fields inherit; explicit false and zero remain overrides where
allowed. Do not copy computed defaults into each object.

Port precedence is built-in text, shared Text, diagram module All ports/direction, diagram
Group All ports/direction for Group interfaces, owner All ports/direction, then Port style.
This keeps diagram module Port defaults shared with Group interfaces, while Group defaults
can specialize them. Collapsed Collection virtual Ports use the same resolution.

Inheritance is resolved when validating and rendering; JSON export preserves the
authored values and omissions without inserting computed defaults. These fields style
the diagram, independently of Studio theme or application preferences. The repository's
examples/default-styles.json demonstrates these settings.
