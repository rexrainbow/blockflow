# Blockflow Agent Kit

Build: `{{KIT_VERSION}}`

Use this kit to turn a screenshot or a text description into editable Blockflow JSON and
an automatically laid-out SVG. The agent interprets the source and writes JSON; the
converter validates and renders that JSON. It does not recognize images or call an AI.

The complete kit contains exactly three files:

- `blockflow.schema.json`: JSON Schema Draft 2020-12 for authoring documents.
- `README.md`: field semantics, authoring workflow and executable examples.
- `blockflow-convert.mjs`: standalone Node.js CLI and importable API, including the
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
6. Deliver the JSON and/or SVG. Open the JSON with the Blockflow editor's Open JSON command
   or drop it into the editor to continue editing.

Schema validation alone cannot check references, driver conflicts, hierarchy, boundary
crossings or Concat sums. The converter's model validator is authoritative. It does not
silently migrate obsolete fields, repair broken links or insert defaults into saved JSON.

## CLI

```powershell
node blockflow-convert.mjs diagram.json --check
node blockflow-convert.mjs diagram.json --output diagram.svg
node blockflow-convert.mjs diagram.json --output formatted.json
node blockflow-convert.mjs diagram.json --output group.svg --view Processing
node blockflow-convert.mjs diagram.json --output diagram.svg --diagnostics json
node blockflow-convert.mjs --version
node blockflow-convert.mjs --help
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
  "diagram": { "name": "Source to Sink" },
  "modules": [
    { "id": "Source", "ports": [{ "id": "out", "direction": "output" }] },
    { "id": "Sink", "ports": [{ "id": "in", "direction": "input" }] }
  ],
  "connections": [{ "from": "Source.out", "to": "Sink.in", "label": "Data" }],
  "layout": { "direction": "right" }
}
```

## Identity, names and connectivity

- Required root fields: `version: 1`, `diagram` with non-blank `name`, and `modules`.
  Optional: `connections`, `groups`, `terminals`, `layout`. Unknown properties are rejected;
  do not add `$schema` inside a diagram. Configure schema association outside the document.
- At least one module or group is required. `modules: []` is valid for group-only diagrams.
  A real module needs at least one port. Unconnected ports and empty groups are allowed.
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
Legacy `"left"` is accepted with fixed left/right port sides and may need detours.
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

## Concat: optional widths and ordered composition

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
  "diagram": { "name": "Abstract composition" },
  "modules": [
    {
      "id": "Combine",
      "type": "concat",
      "label": "Concat",
      "style": { "label": { "hidden": true }, "portLabel": { "hidden": true } },
      "ports": [
        { "id": "first", "direction": "input" },
        { "id": "second", "direction": "input" },
        { "id": "out", "direction": "output" }
      ]
    }
  ],
  "layout": { "direction": "down" }
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

```json
{
  "version": 1,
  "diagram": { "name": "External interfaces" },
  "terminals": [
    { "id": "ExternalInput", "label": "Input", "direction": "input" },
    { "id": "ExternalOutput", "label": "Output", "direction": "output" }
  ],
  "modules": [
    {
      "id": "Logic",
      "ports": [
        { "id": "in", "direction": "input" },
        { "id": "out", "direction": "output" }
      ]
    }
  ],
  "connections": [
    { "from": { "terminal": "ExternalInput" }, "to": "Logic.in" },
    { "from": "Logic.out", "to": { "terminal": "ExternalOutput" } }
  ]
}
```

## Groups and real boundaries

Keep modules and connections flat. Root `groups` entries require `id` and `members`
(module or group IDs); optional fields include `label`, `type`, `style`, `width`, `height`,
`ports`, `collapsed` and the legacy `portMode`. An object has at most one parent. No duplicate
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
same-rank alignment or fixed positions. `portMode` is legacy (`direct`/`boundary`); when
combined with `type`, they must agree. Prefer the canonical `type`.

## Portable styles and hiding text

Defaults are `diagram.style.module` and `diagram.style.connection`. Local module, group,
port, terminal and connection `style` objects override supported fields per property.
Use exact keys from the schema, never CSS, HTML, URLs, font-family strings or scripts.

- Module/group border/fill: `borderColor`, `borderWidth`, `borderStyle`, `borderOpacity`,
  `fillColor`, `fillOpacity`; text subgroups: `label`, `portLabel`, `inputPortLabel`,
  `outputPortLabel`.
- Connection: `strokeColor`, `strokeWidth`, `lineStyle`, `opacity`, `endArrow` (`none` default
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

Connection labels are automatically placed beside routes, with bounded spacing retries.
Never author `xlabel`, label positions or rotations. Text stays horizontal in Down flow.
SVG uses monospace text with conservative width estimates; actual font appearance depends
on the viewer. Inspect the rendered result when long or non-Latin names are important.

## Layout and exterior feedback

All connections participate together in one layout, not staged batches. The accepted
layout options are:

| Field                 | Values / default                                               |
| --------------------- | -------------------------------------------------------------- |
| `direction`           | `right` default, `down`, legacy `left`                         |
| `routing`             | `orthogonal` only                                              |
| `placement`           | `default` default, `relaxed`, legacy `simple`                  |
| `moduleSpacing`       | Positive finite number, default 50                             |
| `layerSpacing`        | Positive finite number, default 80                             |
| `feedbackRouting`     | `elk` default or `outer`                                       |
| `feedbackSide`        | `auto` default; horizontal `top`/`bottom`, Down `left`/`right` |
| `feedbackMargin`      | Positive finite number, default 20                             |
| `feedbackLaneSpacing` | Positive finite number, default 12                             |

An incompatible side is invalid even when Outer is disabled. When changing JSON flow axes,
map Top ↔ Left and Bottom ↔ Right yourself; the converter does not rewrite settings.
`outer` supports Right and Down, not legacy Left. It attempts routes outside the visible
bounding rectangles. A blocked requested side keeps the ELK route without switching sides.
Terminal edges, boundary-scoped edges and group views retain their ELK routing fallbacks.

Connection `feedback: true` lowers its direction priority during cycle breaking. It does
not itself enable Outer, force backward routing, align blocks or remove ranking constraints.
Omit it or use false for normal priority. Unused ports, cycles, long labels and groups can
change the arrangement; reproduce intent instead of promising exact screenshot geometry.

## Importable JavaScript API

Importing the converter performs no CLI work:

```javascript
import { validateDiagram, convertDiagram, KIT_VERSION } from './blockflow-convert.mjs';
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
