# Statechart runtime

Flat state machines use separate `states` and `transitions` collections and the
[Statechart schema](../schema/statechart.schema.json). This runtime draws diagrams;
conditions, outputs and actions are plain text, never executable behavior.
Composite states, concurrency, history/choice/fork/join and nested semantics are
outside this version. No reachability, determinism or completeness analysis is implied.

```powershell
npm run statechart -- examples/statechart/task-controller.mmd --output output/task-controller.json
npm run statechart -- output/task-controller.json --output output/task-controller.svg
npm run statechart -- output/task-controller.json --output output/task-controller.png --scale 2
npm run statechart -- output/task-controller.json --check
```

The primary example is a batch task controller with seven states and sixteen
transitions: Idle, optional Preparing, Running, inter-step Waiting, and one Paused
state for each active phase. It includes repeated reset/pause conditions, resumes,
parallel return transitions and long labels. No hardware-specific vocabulary or
inferred initial transition is required. The MMD defines the structure; the paired
`task-controller.json` adds state colors, transition colors, label backgrounds,
font/alignment settings and `labelMaxWidth`. Conditions remain illustrative text.
The former Timer primary example is retained under `tests/fixtures/statechart/`
for runtime regression checks.

The [Agent Kit guide](statechart-agent-kit-readme.md) specifies supported syntax and
authoring fields. Repeated state descriptions are joined into a body below the
state name. `state "Name" as ID` specifies the name explicitly. Start and end `[*]`
uses separate generated IDs (shared within the flat diagram), avoiding declared-ID
collisions. Unsupported statements report line/column errors, never silently vanish.
Transition labels are literal text; use JSON for multiline conditions.

## API

`rtl-diagram/statechart` exports `parseMermaid`, `createStatechartModel`,
`layoutStatechart`, `renderStatechartSvg`, `StatechartSyntaxError` and
`StatechartValidationError`, and `StatechartLayoutError`. Node/browser entries add the same shared export helpers
as Flowchart. Schema/model validation rejects unsupported fields and references.
Validation/model/layout never mutate inputs. The normalized model materializes kinds
and transition IDs but preserves authoring transition kinds. Defaults and inferred
loop classification used for geometry stay in layout.

Statechart uses its own label-aware ELK Layered graph, sharing Flowchart's validated
styles, state measurement and SVG edge rendering. Flowchart placement defaults
remain unchanged. Each labeled transition gets one temporary rectangular label
node and two internal edges. Labels therefore reserve space during layer ordering,
state placement and orthogonal routing. They are removed from the public layout;
only real states/transitions and their authoring identities remain. States can be
offset within the layers. There is no hub, radial or composite-state strategy.

Before placement, structural analysis prioritizes the real state skeleton. It
uses distinct neighbors, incoming/outgoing structure, strongly connected circuits,
repeated incoming condition text from distinct sources and bounded label pressure.
Names such as IDLE/Pause have no special meaning. A regular state with exactly one
bidirectional neighbor is deferred as a satellite only when that owner has other
neighbors; a standalone two-state cycle stays core. Core traversal prefers to
complete its current circuit before taking a one-way exit. Initial symbols are
considered first; no initial-state semantics are inferred from a state name.

Four bounded candidates compare core-first source/target label ordering, an
alternate core traversal and ordinary declaration ordering. Backbone edges receive
soft direction/straightness priorities; satellites receive owner-proximity
preferences. All state coordinates remain free to change during label-aware ELK
placement. This is not fixed placement or a new authored group structure.

After mandatory route/label safety checks, candidate quality is compared in order:
number of collinearly overlapping transition pairs, crossing/contact points,
overlap length, Manhattan wire length plus bend cost, and area. Contacts away from
a shared real state port count as intersections; shared state endpoints are allowed.
The valid declaration candidate is retained as a baseline, so a topology proposal
cannot win solely because its ordering changed. Zero intersections are not required
for every topology; improving them can increase wire length or diagram bounds.

States render rounded boxes, with a separator before a description. Initial/final
pseudostates render a solid dot / bullseye. All transitions, including returns,
parallel edges and self loops, remain independent. States have separate transition
ports; ELK can order those ports within their sides to reduce crossings. Explicit
endpoint sides are respected. Layered routing uses reverse-facing ports on back transitions. It no
longer uses Flowchart's outer-loop corridor algorithm. These are geometric choices,
not changes to persisted transition kinds or state-machine execution semantics.
Statechart does not accept global `layout.loopSide` (including `"auto"`); remove
that field from Statechart JSON. The schema/runtime reject it at `layout.loopSide`
rather than silently ignoring or converting it. Individual transition `fromSide`
and `toSide` remain available. Flowchart retains its separate `loopSide` option.

`layout.labelMaxWidth` is an optional positive finite SVG-unit width (default 240)
for **display-only** transition label wrapping. Existing line breaks are preserved;
long tokens may break at Unicode code-point boundaries, with a single oversized
glyph retained intact. JSON `label` stays unchanged. Layout transitions expose the
original `label` plus derived `displayLabel`, measured `labelBounds` and
`labelPosition`. Renderer alignment uses the display text. This option is Statechart
only; `graphDocument()` removes it when lowering to Flowchart's normalized style model.
`STATECHART_LAYOUT_DEFAULTS.labelMaxWidth` exports the default for consumers such
as GUI placeholders, without copying it into authoring documents.

Each label rectangle reserves clearance from other routes, states and labels. Its
own wire passes through the rectangle exactly once, on a straight horizontal or
vertical segment; text stays horizontal. Background paint does not hide a foreign
crossing to satisfy this rule. Geometry is checked before returning a layout.
Each spacing round evaluates up to four deterministic candidates, choosing the best
safe result. Only when none is safe does it increase node/layer spacing (1x, 1.5x,
2.25x), for at most twelve placements. If a valid reservation cannot be found, `StatechartLayoutError`
exposes a transition path instead of emitting an ambiguous diagram. This does not
guarantee zero crossings outside label regions or a smaller diagram for every FSM.

See `examples/statechart/label-layout/timer.mmd` and `.json`. Neither adds an initial
state to the source Timer FSM. More separation can increase height and total wire
length while improving ownership and reducing shared/overlapping paths.
`examples/statechart/label-layout/trigger-processor.mmd` and `.json` demonstrate
core ordering with three deferred single-owner pause branches. Role analysis and
candidate scores are internal and never persisted as authoring fields.

Layout uses `states`, `transitions`, bounds and diagram/layout metadata. Each state
has geometry, resolved style and its authoring ID; transitions have IDs, sections,
side and optional label geometry. SVG node hit targets use `statechart-state`;
shared transition targets retain `flow-edge` / `flow-edge-label`, with `data-id`.
Styles inherit `diagram.style.state` / `.transition`. Use literal hex colors or
transparent; labels are XML-escaped.

## Editor support

`src/editor/statechart/commands.js` exports `emptyDocument`, `validateDocument`,
`addState(doc, props)`, `renameState(doc, id, nextId)`, `removeState(doc, id)`,
`addTransition(doc, from, to, props)`, `removeTransition(doc, id)` and
`reconnectTransition(doc, id, 'from' | 'to', stateId)`. Like Flowchart, edits validate
and return new authoring documents; failures expose `path` and leave inputs intact.
The starter contains one Idle state. Deleting the last state is rejected. State
deletion drops incident transitions. Edge-array edits materialize implicit IDs
before deletion so surviving transitions retain identity. IDs generated by add
commands override IDs in props; endpoint arguments override endpoint props.

`src/editor/statechart/services/layout.js` supplies `new LayoutService(onResult)`
and `request(document)`, with shared debounce (180 ms), invalidation and disposal.
The domain has its own module/inline Worker factories and `runLayoutJob`. Replies
are `{revision, layout, svg}` or `{revision, error, path}`. SVG equals converter text,
including its trailing newline; each layout transition gains `editorKey === id`.
Computed metadata never belongs in saved JSON. Dispatch by exactly one own root
key: modules / nodes / states for Blockchart / Flowchart / Statechart; then validate.
GUI integration and acceptance belong to Claude.

## Text alignment

Text styles accept `textAlign: "left" | "center" | "right"` for lines inside the
existing text block. Omission preserves current alignment; geometry and single-line
placement stay unchanged. See [the shared alignment contract](text-alignment.md)
for inheritance, field paths and Statechart description alignment.

## Transition corner rendering

Statechart SVG/PNG rounds orthogonal transition corners with quadratic curves,
using a default radius of 8 layout units. Short adjacent segments reduce the
radius; a straight final run is retained for the existing arrowhead. Corners
near states, condition-label bounds or other transition wires shrink further or
remain angular to preserve clearance. Straight runs are unchanged.
This is rendering only: layout `sections[].points`, state/label positions, bounds,
transition IDs and endpoints retain their orthogonal geometry. Arrowheads use
the original endpoint direction and size. No authoring/schema setting is added.
Flowchart and Blockchart paths retain their existing rendering.
