# Statechart Agent Kit

Build: `{{KIT_VERSION}}`; bundled ELK: `{{ELK_VERSION}}`.

Use `statechart-convert.mjs` with `statechart.schema.json` to generate flat FSM
diagrams. Input is Statechart JSON or the documented `stateDiagram-v2` subset;
output is JSON or SVG. No project files, npm installation or network is required.

```sh
node statechart-convert.mjs task-controller.mmd --output task-controller.json
node statechart-convert.mjs task-controller.json --output task-controller.svg
node statechart-convert.mjs task-controller.json --check
```

Text starts with `stateDiagram-v2`. Supports bare IDs, `state "Name" as ID`,
`ID: Description`, `A --> B: condition`, `[*] --> A`, `A --> [*]`, directions
TB/TD/LR/BT/RL and standalone `%%` comments. Repeated `ID: ...` lines use the first
as the display name and later lines as the state's description; a quoted name
keeps its name and all description lines become body text. Quoted names accept
JSON escapes. Transition labels are literal text; HTML and actions are never run.
Composite states, concurrency, choice/fork/join, notes, styling directives,
frontmatter, chained transitions and semicolon statements are rejected with a
line/column error. Use JSON for styles, multiline transition labels and side hints.

Required JSON root: `version: 1`, `diagram: {name}`, nonempty `states`, `transitions`.
State: `id`, optional `kind` (state/initial/final), `label`, `description`, `width`,
`height`, `style`. Initial/final pseudostates have fixed dimensions and no text.
Transition: `from`, `to`, optional `id`, `label`, `kind` (flow/loop), `fromSide`,
`toSide`, `style`. Omitted IDs become `transition_N` in normalized data; parallel
transitions are distinct. Final states cannot be sources; initial states cannot
be targets. Layout direction is down/right/up/left; node/layer spacing fields
match Flowchart. Global `layout.loopSide` is unsupported, including `auto`; delete
it from Statechart JSON. Individual transition endpoint sides remain supported.
Diagram defaults are `diagram.style.state` and `.transition`.
Styles use hex colors or transparent; unsupported properties are errors.

`layout.labelMaxWidth` is a positive finite target width for condition display
wrapping (default 240 SVG units). JSON conditions stay unchanged; SVG uses derived
display text. Explicit line breaks are preserved. Long tokens can break at Unicode
code points; a single oversized glyph is not clipped. JSON export preserves the
original strings and does not add defaults or layout-only fields.

Statechart uses label-aware layered placement. Temporary label rectangles reserve
space and state ports are distributed per transition; parallel and self transitions
remain distinct. Text is centered over its own horizontal or vertical wire segment.
Foreign wires, states and other labels cannot enter its label rectangle. Fixed
endpoint-side hints remain respected. Layout retries with increased spacing
in up to three spacing rounds; unresolved collisions produce a layout error with a transition
path, not a warning and overlapping output. Flowchart's routing algorithm is unchanged.

Placement first analyzes distinct-neighbor structure, repeated incoming text and
strongly connected circuits. Core states get ordering/straightness preferences;
single-owner bidirectional satellites are placed with lower priority. State names
are not interpreted. Up to four candidates per spacing round are compared, retaining
ordinary declaration ordering as a baseline. Mandatory label/state avoidance comes
first, then collinear overlap, crossings/contacts, wire/bend cost and area. At most
twelve placements are attempted. No role, priority or fixed-coordinate fields are
added to JSON; coordinates remain free and zero crossings are not universally guaranteed.

Conditions, outputs and actions are display text, not executable FSM semantics.
Layout back-edge detection does not change persisted transition kinds. No groups
or nested state semantics are supported. Use the selected domain's schema.

JS exports: `parseMermaid`, `validateStatechart`, `convertStatechart`, `KIT_VERSION`.
`convertStatechart(input, {format: 'json' | 'svg'})` returns `{format,text,warnings}`.
String input defaults to Mermaid; use `{inputFormat:'json'}` for JSON strings.

## Text alignment

Text-bearing styles accept `textAlign` as `left`, `center` or `right`. It aligns
multiline text inside its existing measured text block; it does not move the label,
change geometry or reposition a single line. Omit the field to retain current
alignment/inherit; null and `inherit` are invalid. Use existing global/local style
paths. Blockchart uses text styles (including module/group label and port-label
sections, connection.label, terminals and caption); Flowchart uses node/note/edge/
group styles; Statechart uses state/transition styles. Statechart state styles also
accept `descriptionAlign`, inherited globally/locally and falling back to resolved
state `textAlign` when omitted. This separately aligns the description below the
name; it is invalid on transitions and in the other diagram domains. JSON only;
no new Mermaid alignment directive is supported.

### Rounded transition corners

Statechart SVG rounds transition turns with a default radius of 8 layout units.
Short segments, arrowhead access and nearby states, condition labels or other
wires limit the radius; unsafe corners remain angular. Stored/layout points,
endpoints, arrowheads and label positions are unchanged. This render-only default
adds no JSON field and does not change Flowchart or Blockchart paths.
