# Blockflow Agent Kit

Blockflow combines **Blockchart** (hardware block diagrams) and **Flowchart** (process
diagrams). This offline kit contains five files. Choose the converter and Schema for the
diagram domain; their JSON formats are separate.

| Domain                     | Converter                | Schema                   | Input                                      | Output    |
| -------------------------- | ------------------------ | ------------------------ | ------------------------------------------ | --------- |
| Hardware / signal diagrams | `blockchart-convert.mjs` | `blockchart.schema.json` | Blockchart JSON                            | JSON, SVG |
| Process / control flow     | `flowchart-convert.mjs`  | `flowchart.schema.json`  | Mermaid Flowchart subset or Flowchart JSON | JSON, SVG |

Both converters contain their own validator, ELK layout and SVG renderer. Requires
**Node.js 22.12+**; no npm install, project source, browser, server or network is needed.
Move this folder to any location. Either converter can run independently; its Schema and
this guide help agents author input. The converters interpret neither screenshots nor
natural language: an agent translates those sources into Mermaid or domain-specific JSON.

- Blockchart build: `blockchart-agent-kit-aa0595fd1abc831afc8e`
- Flowchart build: `flowchart-agent-kit-8564411ef430ee2d4b6c`

## Quick start

```sh
node blockchart-convert.mjs hardware.json --check
node blockchart-convert.mjs hardware.json --output hardware.svg

node flowchart-convert.mjs process.mmd --check
node flowchart-convert.mjs process.mmd --output process.json
node flowchart-convert.mjs process.json --output process.svg
node flowchart-convert.mjs process.mmd --output - --format svg
```

Run `node <converter>.mjs --help` for flags and `--version` for its build ID. The Flowchart
text syntax is a documented subset, not the complete Mermaid language. Both standalone
tools export JSON and SVG. For PNG, the full project offers SVG-to-PNG exports and the
Flowchart project CLI (`npm run flowchart -- process.json --output process.png --scale 2`).
Native Sharp dependencies are intentionally kept outside these single-file converters.

## Maintainers

In the source checkout, `npm run build:agent-kit` regenerates both converters, both Schemas
and this README together. `build:agent-kit:blockchart` remains an alias for this complete
build, so it cannot overwrite the shared guide with an incomplete version. The two
domain guides below are generated from maintained templates. Each bundle embeds the ELK
license attribution; its full license appears at the end of this README.


## Blockchart Agent Kit

Build: `blockchart-agent-kit-aa0595fd1abc831afc8e`

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

### Recommended agent workflow

1. Identify real blocks, external interfaces, ports and connections. Assign stable IDs.
2. Choose horizontal or vertical flow. Reproduce connectivity and intent first; ELK owns
   placement. Exact screenshot coordinates and pixel matching are not supported.
3. Write a raw version 1 authoring document using the schema and rules below. Do not write
   normalized models, layout records, localStorage wrappers, HTML or SVG as input.
4. Run `--check`, fix the reported semantic error, and repeat until valid.
5. Export SVG. Inspect the image and any label-placement warnings, then adjust names,
   grouping, relative sizes, styles or spacing and render again.
6. Deliver the JSON and/or SVG. Open the JSON with the Blockflow editor's Open JSON command
   or drop it into the editor to continue editing.

Schema validation alone cannot check references, driver conflicts, hierarchy, boundary
crossings or Concat sums. The converter's model validator is authoritative. It does not
silently migrate obsolete fields, repair broken links or insert defaults into saved JSON.

### CLI

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

### Minimal complete document

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

### Identity, names and connectivity

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

### Flow, appearance and labels

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
collapsed behavior is controlled by group type. Appearance never changes Concat semantics.

### Concat: optional widths and ordered composition

Use module `type: "concat"` for multiple ordered input ports and exactly one output.
Ordinary modules omit `type` or use `"block"`. First input is the high part for bit-level
concatenation, independently of where source blocks are placed. Do not simulate this by
giving one input multiple drivers. Each input keeps its own endpoint.

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

### External terminals

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

### Groups and real boundaries

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

### Portable styles and hiding text

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

### Nets and virtual signal labels

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

### Layout and exterior feedback

All connections participate together in one layout, not staged batches. The accepted
layout options are:

| Field                 | Values / default                                               |
| --------------------- | -------------------------------------------------------------- |
| `direction`           | `right` default, `down`                                        |
| `routing`             | `orthogonal` only                                              |
| `placement`           | `default` default, `relaxed`, `simple`                         |
| `moduleSpacing`       | Positive finite number, default 50                             |
| `layerSpacing`        | Positive finite number, default 80                             |
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

Connection `feedback: true` lowers its direction priority during cycle breaking. It does
not itself enable Outer, force backward routing, align blocks or remove ranking constraints.
Omit it or use false for normal priority. Unused ports, cycles, long labels and groups can
change the arrangement; reproduce intent instead of promising exact screenshot geometry.

### Port adjustment

By default, `layout.portAdjustment: "reduce-bends"` enables a bounded post-placement pass that may slide
rectangular/stacked Block Ports along their existing side. It preserves Block positions and
sizes, Port order, at least 24-unit anchor spacing and label/title clearance. Names move with
anchors; source signal nodes move only within their reserved wrapper. Concat, other shapes,
Group Ports and feedback anchors remain fixed. Terminal anchors and names move together
perpendicular to flow with the same shift limit; order and separation are preserved, and
moves overlapping Blocks, Groups or other Terminals are rejected. Terminal adjustment also rejects changes that increase
connection-label clearance warnings. `maxPortShift` limits movement
from the initial anchor (default 40); zero or `portAdjustment: "fixed"` disables it. All affected Net branches are checked together.
Obstacle-hit and foreign-Net crossing counts cannot increase; accepted changes improve
bends, length, then displacement. Search is deterministic and bounded to four passes/128
trials, with no global optimum guarantee. Reserved Inline names follow their Ports; final arrows follow this pass. Auto/Grid,
group views and the editor share this pipeline. JSON export preserves configuration only.

### Importable JavaScript API

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

### Bundle provenance

The converter bundles the project's model/layout/SVG code and elkjs 0.12.1.
ELK source and notices: https://github.com/kieler/elkjs . Its license is reproduced below.
No Sharp or PNG renderer is bundled. The separate schema is for agent/editor tooling;
conversion uses the bundled authoritative validator and does not fetch external schemas.

Project maintainers regenerate all three artifacts with `npm run build:agent-kit` in the
source checkout. Kit consumers never need that checkout or the build toolchain.

### Grid and overview diagrams

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

To align across Containers, set Grid `expandGroups` to an array of nonempty direct
Container IDs, e.g. `["ComputeCluster"]`. Their IDs are replaced by their direct children as eligible
cell values; every such child must occur exactly once. Do not also put the Container ID
in a cell. Boundary and Collection remain whole participants. Each expanded Container
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

#### Net label frames

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

The snippet is the value of `style.label`. See `examples/connection-labels.json` for a
complete diagram (Agent Kit users can author the same style directly).

### Diagram domain

This converter accepts Blockchart (hardware diagram) JSON. Use `flowchart-convert.mjs`
with `flowchart.schema.json` for process diagrams. The two formats are independent.
Source relocation into `src/lib/blockchart` preserves the Blockchart API and formats.


## Flowchart Agent Kit

Build: `flowchart-agent-kit-8564411ef430ee2d4b6c`

Use `flowchart-convert.mjs` for process diagrams. `flowchart.schema.json` is the standalone
JSON Schema Draft 2020-12; it has no dependency on the Blockchart Schema. The validator
also checks references, groups, notes and styles. JSON export preserves authoring data,
not coordinates or layout records. Mermaid input is compiled to the same Flowchart JSON.

### Agent workflow

1. Identify process steps, decisions, start/end points, condition labels and notes.
2. Write supported Mermaid text, or write Flowchart JSON against its Schema.
3. Run `--check`; fix syntax and semantic errors before rendering.
4. Export SVG and inspect the result and any label-clearance warnings.
5. Deliver Mermaid and/or JSON with SVG. The source project can additionally export PNG.

```sh
node flowchart-convert.mjs process.mmd --check --diagnostics json
node flowchart-convert.mjs process.mmd --output process.json
node flowchart-convert.mjs process.json --output process.svg
node flowchart-convert.mjs - --input-format mermaid --output - --format svg
node flowchart-convert.mjs - --input-format json --output - --format json
```

`.json` input is parsed as JSON; other extensions default to Mermaid. Override with
`--input-format json|mermaid`; stdin defaults to Mermaid. Output format is inferred from
`.json` or `.svg`, or specified with `--format`. Stdout requires `--format`. `--check` does
not lay out or write files. Output is staged and replaced only after conversion succeeds;
input cannot be overwritten. Text checks print an OK message; JSON diagnostics go to
stderr. Errors include a stage and, where applicable, path or source line/column.
Exit codes: 0 success, 1 parse/validation/layout/I/O failure, 2 invalid arguments.
Warnings do not fail conversion. No PNG, group-scoped export or image recognition is
included in the standalone Flowchart converter.

### Supported Mermaid subset

```mermaid
flowchart TD
  Start(["Begin"])
  Work["Stage a command"]
  More{"More commands?"}
  Done(["Commit all changes"])
  Help@{ shape: doc, label: "Examples\n- Start / stop\n- GPIO settings" }
  Start --> Work --> More
  More -->|No| Done
  More -->|Yes| Work
  Work -.- Help
  classDef decision fill:#FFF4D6,stroke:#D48A00
  class More decision
  linkStyle 3 stroke:#D48A00,color:#996000
```

Supported syntax:

- `flowchart` / `graph`, with TD/TB, LR, RL or BT.
- ASCII IDs: letter/underscore first, followed by letters, digits or underscore.
- `A["Process"]`, `A{"Decision"}`, `A(["Terminator"])`, `A("Terminator")`, and bare IDs.
- Expanded shapes: `rect`/`rectangle`, `diam`/`diamond`/`decision`, `stadium`/`rounded`,
  and `doc`/`document`. Document nodes render as folded notes attached to a process node.
- Quoted plain-text labels, JSON escapes (`\n`, `\\`), and `<br/>` line breaks.
  Other HTML is escaped as text; Markdown labels are unsupported.
- `-->`, `---`, `-.->`, `-.-`, `==>`, chains, `-->|condition|`, and `-- condition -->`.
- Nested `subgraph ID["Title"]` ... `end`; edges attach to nodes, not groups.
- `classDef`, `class A,B name`, `:::name`, `style ID ...`, and zero-based
  `linkStyle 0,1 ...` / `linkStyle default ...` (indices include associations).
- Styles: `fill`, `stroke`, `color`, `stroke-width`, `font-size`, `opacity`.
  Colors are hex or `transparent`; font/width numbers accept optional `px`.
- Semicolons, CRLF and standalone `%%` comments.

Unsupported constructs are errors: init/frontmatter configuration, callbacks, images,
arbitrary CSS, circle shapes, `&` fan-out shorthand, custom edge IDs, and subgraph-specific
direction. Do not assume full Mermaid compatibility.

### Flowchart JSON

```json
{
  "version": 1,
  "diagram": { "name": "Batch update" },
  "layout": { "direction": "down", "loopSide": "right" },
  "nodes": [
    { "id": "Start", "type": "terminator", "label": "Begin" },
    { "id": "Work", "label": "Stage a command" },
    { "id": "More", "type": "decision", "label": "More commands?" },
    { "id": "Done", "type": "terminator", "label": "Commit" },
    { "id": "Help", "type": "note", "label": "Staged writes", "attachTo": "Work", "side": "right" }
  ],
  "edges": [
    { "from": "Start", "to": "Work" },
    { "from": "Work", "to": "More" },
    { "from": "More", "to": "Done", "label": "No" },
    { "from": "More", "to": "Work", "kind": "loop", "label": "Yes" },
    { "from": "Work", "to": "Help", "kind": "association" }
  ]
}
```

Required: `version:1`, `diagram.name`, nonempty `nodes`, and `edges`. Optional `groups`
are flat objects with `id`, optional `label` and `style`, and nonempty unique `members`.
Nodes/groups share unique IDs and a member can have only one parent; cycles are rejected.
JSON IDs allow letters/underscore first, then letters, digits, underscore or hyphen.
Do not put `$schema`, coordinates, normalized models, or layout results in input JSON.

Node fields: `id`, `label` (default ID), `type` (process/decision/terminator/start/end/note),
positive logical `width`/`height` minima, and `style`. Notes additionally have `attachTo`
and left/right/top/bottom `side`. A note can infer its attachment from an association to
a non-note node. One note per owner is supported; note and owner must belong to the same
group. Notes reserve space beside their owner without introducing a flow level.

Edge fields: optional unique `id`, `from`, `to`, optional `label`, `kind` (flow/loop/association),
boolean `arrow`, `fromSide`/`toSide`, and `style`. IDs default deterministically. Back edges
are inferred as loops in the normalized model; explicit `kind:"loop"` clarifies intent.
Associations default to dotted and arrowless. Separate outgoing edges have separate
condition labels. Flowchart has no hardware Ports, bit widths, Nets or Concat nodes.

Layout: `direction` down/right/up/left, positive `nodeSpacing` (40), `layerSpacing` (60),
`noteGap` (40), and `loopSide` auto/left/right/top/bottom. Loop side must be perpendicular
to flow; auto uses right for vertical flow or bottom for horizontal flow. Notes default to
right for vertical flow or bottom for horizontal flow. Use larger spacing, shorter labels
or explicit sides if rendering reports `FLOW_LABEL_OVERLAP`.

Node/group styles: `fillColor`, `borderColor`, positive `borderWidth`, `borderStyle`,
non-negative `borderRadius`, `color`, positive `fontSize`, non-negative `padding`, `opacity`.
Edge styles: `strokeColor`, positive `strokeWidth`, `lineStyle`, `color`, positive `fontSize`,
`labelBackgroundColor`, `opacity`. Colors accept hex or `transparent`; patterns are
solid/dashed/dotted; opacity is in [0,1]. Global defaults are under
`diagram.style.node`, `.edge`, `.group`, `.note`; per-object styles override properties.
`diagram.caption` adds text below the chart. Text uses portable monospace measurements.

### Importable API

```javascript
import { parseMermaid, validateFlowchart, convertFlowchart, KIT_VERSION } from './flowchart-convert.mjs';

const text = 'flowchart TD\nA["Start"] --> B["Finish"]';
const document = parseMermaid(text);
validateFlowchart(document); // { ok: true }
const json = await convertFlowchart(text, { format: 'json' });
const svg = await convertFlowchart(document, { format: 'svg' });
console.log(svg.text);
```

Strings default to Mermaid; objects default to JSON. For a JSON string, pass
`{inputFormat:"json"}`. `convertFlowchart` returns `{format,text,warnings}` and supports
only JSON/SVG. Input objects remain unchanged. Errors include `stage`, and syntax errors
include `line` / `column`. Importing the module does not run the CLI or write files.


## Bundled elkjs license

# Eclipse Public License - v 2.0

THE ACCOMPANYING PROGRAM IS PROVIDED UNDER THE TERMS OF THIS ECLIPSE
PUBLIC LICENSE (“AGREEMENT”). ANY USE, REPRODUCTION OR DISTRIBUTION OF
THE PROGRAM CONSTITUTES RECIPIENT'S ACCEPTANCE OF THIS AGREEMENT.

## 1. DEFINITIONS

“Contribution” means:

-   a\) in the case of the initial Contributor, the initial content
    Distributed under this Agreement, and
-   b\) in the case of each subsequent Contributor:
    -   i\) changes to the Program, and
    -   ii\) additions to the Program;

    where such changes and/or additions to the Program originate from
    and are Distributed by that particular Contributor. A Contribution
    “originates” from a Contributor if it was added to the Program by
    such Contributor itself or anyone acting on such Contributor's
    behalf. Contributions do not include changes or additions to the
    Program that are not Modified Works.

“Contributor” means any person or entity that Distributes the Program.

“Licensed Patents” mean patent claims licensable by a Contributor which
are necessarily infringed by the use or sale of its Contribution alone
or when combined with the Program.

“Program” means the Contributions Distributed in accordance with this
Agreement.

“Recipient” means anyone who receives the Program under this Agreement
or any Secondary License (as applicable), including Contributors.

“Derivative Works” shall mean any work, whether in Source Code or other
form, that is based on (or derived from) the Program and for which the
editorial revisions, annotations, elaborations, or other modifications
represent, as a whole, an original work of authorship.

“Modified Works” shall mean any work in Source Code or other form that
results from an addition to, deletion from, or modification of the
contents of the Program, including, for purposes of clarity any new file
in Source Code form that contains any contents of the Program. Modified
Works shall not include works that contain only declarations,
interfaces, types, classes, structures, or files of the Program solely
in each case in order to link to, bind by name, or subclass the Program
or Modified Works thereof.

“Distribute” means the acts of a) distributing or b) making available in
any manner that enables the transfer of a copy.

“Source Code” means the form of a Program preferred for making
modifications, including but not limited to software source code,
documentation source, and configuration files.

“Secondary License” means either the GNU General Public License, Version
2.0, or any later versions of that license, including any exceptions or
additional permissions as identified by the initial Contributor.

## 2. GRANT OF RIGHTS

-   a\) Subject to the terms of this Agreement, each Contributor hereby
    grants Recipient a non-exclusive, worldwide, royalty-free copyright
    license to reproduce, prepare Derivative Works of, publicly display,
    publicly perform, Distribute and sublicense the Contribution of such
    Contributor, if any, and such Derivative Works.
-   b\) Subject to the terms of this Agreement, each Contributor hereby
    grants Recipient a non-exclusive, worldwide, royalty-free patent license
    under Licensed Patents to make, use, sell, offer to sell, import and
    otherwise transfer the Contribution of such Contributor, if any, in
    Source Code or other form. This patent license shall apply to the
    combination of the Contribution and the Program if, at the time the
    Contribution is added by the Contributor, such addition of the
    Contribution causes such combination to be covered by the
    Licensed Patents. The patent license shall not apply to any other
    combinations which include the Contribution. No hardware per se is
    licensed hereunder.
-   c\) Recipient understands that although each Contributor grants the
    licenses to its Contributions set forth herein, no assurances are
    provided by any Contributor that the Program does not infringe the
    patent or other intellectual property rights of any other entity. Each
    Contributor disclaims any liability to Recipient for claims brought by
    any other entity based on infringement of intellectual property rights
    or otherwise. As a condition to exercising the rights and licenses
    granted hereunder, each Recipient hereby assumes sole responsibility to
    secure any other intellectual property rights needed, if any. For
    example, if a third party patent license is required to allow Recipient
    to Distribute the Program, it is Recipient's responsibility to acquire
    that license before distributing the Program.
-   d\) Each Contributor represents that to its knowledge it has sufficient
    copyright rights in its Contribution, if any, to grant the copyright
    license set forth in this Agreement.
-   e\) Notwithstanding the terms of any Secondary License, no Contributor
    makes additional grants to any Recipient (other than those set forth in
    this Agreement) as a result of such Recipient's receipt of the Program
    under the terms of a Secondary License (if permitted under the terms of
    Section 3).

## 3. REQUIREMENTS

3.1 If a Contributor Distributes the Program in any form, then:

-   a\) the Program must also be made available as Source Code, in accordance
    with section 3.2, and the Contributor must accompany the Program with a
    statement that the Source Code for the Program is available under this
    Agreement, and informs Recipients how to obtain it in a reasonable
    manner on or through a medium customarily used for software exchange;
    and
-   b\) the Contributor may Distribute the Program under a license different
    than this Agreement, provided that such license:
    -   i\) effectively disclaims on behalf of all other Contributors all
        warranties and conditions, express and implied, including warranties or
        conditions of title and non-infringement, and implied warranties or
        conditions of merchantability and fitness for a particular purpose;
    -   ii\) effectively excludes on behalf of all other Contributors all
        liability for damages, including direct, indirect, special, incidental
        and consequential damages, such as lost profits;
    -   iii\) does not attempt to limit or alter the recipients' rights in the
        Source Code under section 3.2; and
    -   iv\) requires any subsequent distribution of the Program by any party to
        be under a license that satisfies the requirements of this section 3.

3.2 When the Program is Distributed as Source Code:

-   a\) it must be made available under this Agreement, or if the Program (i)
    is combined with other material in a separate file or files made
    available under a Secondary License, and (ii) the initial Contributor
    attached to the Source Code the notice described in Exhibit A of this
    Agreement, then the Program may be made available under the terms of
    such Secondary Licenses, and
-   b\) a copy of this Agreement must be included with each copy of
    the Program.

3.3 Contributors may not remove or alter any copyright, patent,
trademark, attribution notices, disclaimers of warranty, or limitations
of liability (‘notices’) contained within the Program from any copy of
the Program which they Distribute, provided that Contributors may add
their own appropriate notices.

## 4. COMMERCIAL DISTRIBUTION

Commercial distributors of software may accept certain responsibilities
with respect to end users, business partners and the like. While this
license is intended to facilitate the commercial use of the Program, the
Contributor who includes the Program in a commercial product offering
should do so in a manner which does not create potential liability for
other Contributors. Therefore, if a Contributor includes the Program in
a commercial product offering, such Contributor (“Commercial
Contributor”) hereby agrees to defend and indemnify every other
Contributor (“Indemnified Contributor”) against any losses, damages and
costs (collectively “Losses”) arising from claims, lawsuits and other
legal actions brought by a third party against the Indemnified
Contributor to the extent caused by the acts or omissions of such
Commercial Contributor in connection with its distribution of the
Program in a commercial product offering. The obligations in this
section do not apply to any claims or Losses relating to any actual or
alleged intellectual property infringement. In order to qualify, an
Indemnified Contributor must: a) promptly notify the Commercial
Contributor in writing of such claim, and b) allow the Commercial
Contributor to control, and cooperate with the Commercial Contributor
in, the defense and any related settlement negotiations. The Indemnified
Contributor may participate in any such claim at its own expense.

For example, a Contributor might include the Program in a commercial
product offering, Product X. That Contributor is then a Commercial
Contributor. If that Commercial Contributor then makes performance
claims, or offers warranties related to Product X, those performance
claims and warranties are such Commercial Contributor's responsibility
alone. Under this section, the Commercial Contributor would have to
defend claims against the other Contributors related to those
performance claims and warranties, and if a court requires any other
Contributor to pay any damages as a result, the Commercial Contributor
must pay those damages.

## 5. NO WARRANTY {#warranty}

EXCEPT AS EXPRESSLY SET FORTH IN THIS AGREEMENT, AND TO THE EXTENT
PERMITTED BY APPLICABLE LAW, THE PROGRAM IS PROVIDED ON AN “AS IS”
BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, EITHER EXPRESS OR
IMPLIED INCLUDING, WITHOUT LIMITATION, ANY WARRANTIES OR CONDITIONS OF
TITLE, NON-INFRINGEMENT, MERCHANTABILITY OR FITNESS FOR A PARTICULAR
PURPOSE. Each Recipient is solely responsible for determining the
appropriateness of using and distributing the Program and assumes all
risks associated with its exercise of rights under this Agreement,
including but not limited to the risks and costs of program errors,
compliance with applicable laws, damage to or loss of data, programs or
equipment, and unavailability or interruption of operations.

## 6. DISCLAIMER OF LIABILITY {#disclaimer}

EXCEPT AS EXPRESSLY SET FORTH IN THIS AGREEMENT, AND TO THE EXTENT
PERMITTED BY APPLICABLE LAW, NEITHER RECIPIENT NOR ANY CONTRIBUTORS
SHALL HAVE ANY LIABILITY FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING WITHOUT LIMITATION LOST
PROFITS), HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OR DISTRIBUTION OF THE PROGRAM OR THE
EXERCISE OF ANY RIGHTS GRANTED HEREUNDER, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGES.

## 7. GENERAL

If any provision of this Agreement is invalid or unenforceable under
applicable law, it shall not affect the validity or enforceability of
the remainder of the terms of this Agreement, and without further action
by the parties hereto, such provision shall be reformed to the minimum
extent necessary to make such provision valid and enforceable.

If Recipient institutes patent litigation against any entity (including
a cross-claim or counterclaim in a lawsuit) alleging that the Program
itself (excluding combinations of the Program with other software or
hardware) infringes such Recipient's patent(s), then such Recipient's
rights granted under Section 2(b) shall terminate as of the date such
litigation is filed.

All Recipient's rights under this Agreement shall terminate if it fails
to comply with any of the material terms or conditions of this Agreement
and does not cure such failure in a reasonable period of time after
becoming aware of such noncompliance. If all Recipient's rights under
this Agreement terminate, Recipient agrees to cease use and distribution
of the Program as soon as reasonably practicable. However, Recipient's
obligations under this Agreement and any licenses granted by Recipient
relating to the Program shall continue and survive.

Everyone is permitted to copy and distribute copies of this Agreement,
but in order to avoid inconsistency the Agreement is copyrighted and may
only be modified in the following manner. The Agreement Steward reserves
the right to publish new versions (including revisions) of this
Agreement from time to time. No one other than the Agreement Steward has
the right to modify this Agreement. The Eclipse Foundation is the
initial Agreement Steward. The Eclipse Foundation may assign the
responsibility to serve as the Agreement Steward to a suitable separate
entity. Each new version of the Agreement will be given a distinguishing
version number. The Program (including Contributions) may always be
Distributed subject to the version of the Agreement under which it was
received. In addition, after a new version of the Agreement is
published, Contributor may elect to Distribute the Program (including
its Contributions) under the new version.

Except as expressly stated in Sections 2(a) and 2(b) above, Recipient
receives no rights or licenses to the intellectual property of any
Contributor under this Agreement, whether expressly, by implication,
estoppel or otherwise. All rights in the Program not expressly granted
under this Agreement are reserved. Nothing in this Agreement is intended
to be enforceable by any entity that is not a Contributor or Recipient.
No third-party beneficiary rights are created under this Agreement.

## Exhibit A – Form of Secondary Licenses Notice {#exhibit-a}

“This Source Code may also be made available under the following
Secondary Licenses when the conditions for such availability set forth
in the Eclipse Public License, v. 2.0 are satisfied: GNU General Public License v3.0 or later”

> Simply including a copy of this Agreement, including this Exhibit A is
> not sufficient to license the Source Code under Secondary Licenses.
>
> If it is not possible or desirable to put the notice in a particular
> file, then You may include the notice in a location (such as a LICENSE
> file in a relevant directory) where a recipient would be likely to
> look for such a notice.
>
> You may add additional accurate notices of copyright ownership.

