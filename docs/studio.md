# blockflow Studio (UI)

`index.html` now loads **blockflow Studio** from `src/studio/`. The JSON schema, the layout engine
(`src/lib/blockchart`), the converter (`src/agent-kit/blockchart-converter.js`) and the editor state layer
(`src/editor/state/commands.js`, `history.js`) and layout service (`src/editor/services/`) are unchanged and
shared. The previous editor UI has been removed.

## Principles

- **The canvas shows the exported diagram.** The layout worker (`src/editor/workers/layout.js`) runs
  `createDiagramModel → layoutDiagram → renderSvg`, the same calls as `convertDiagram`. The Studio draws
  that SVG unchanged and puts an interaction overlay on top, so what you see is what you export.
  `e2e/studio.spec.js` checks this byte for byte for every bundled example and a group view of each.
- **ELK decides every position.** No manual placement is stored. Dragging a block changes only its group;
  dragging from a port changes only connectivity. After each relayout the camera stays anchored on the
  selected item, and the old and new drawings cross-fade in 180 ms (or switch instantly with reduced motion).
- **Nets are one-to-many.** The outline lists one row per net, which expands to its branches. The inspector
  edits a net's source, a target table (endpoint, feedback, affects placement, branch style), the label and
  bidirectional mode. Drag rules on the canvas:
  - From an output that already drives a net: adds a target to that net.
  - From an output with no net: creates a new net.
  - From an input to an output: adds that input to the output's net.
  - The tooltip says which of these will happen before you release, and why a drop is not allowed.
- **Concat in one step.** Shift-click two or more output ports, then choose Concat on the floating toolbar.
- **Changes apply immediately, with Undo.** There are no OK, Apply or Discard drafts. Text fields commit on
  Enter or blur (Ctrl+Enter for multi-line fields), Escape reverts, and invalid values stay in the field
  with an inline message. Deletions show a toast with an Undo action.

## Diagram kinds

The Studio edits a **Block diagram** (Blockchart JSON, `modules`), a **Flowchart**
(Flowchart JSON, `nodes`) or a **Statechart** (flat state machine JSON, `states`) in the
same window.
The kind chip in the top bar names the current kind and opens *New diagram* for either.
Open, drag-and-drop, examples and New route a document by its root key (runtime contract:
exactly one own `modules`, `nodes` or `states`; more or none is refused; see
[Editor support APIs](editor-runtime.md)); a document of the other kind ends the current
editor session (its layout Worker and listeners are disposed) and starts that kind's
session. The opened document replaces that kind's draft as one undoable change, and the
toast offers *Back to …*. Each kind keeps its own browser draft
(`blockflow.editor.v1`, `blockflow.flowchart.v1`, `blockflow.statechart.v1`) and the last
kind is restored on reload. Mermaid files open by their first statement: `stateDiagram-v2`
as a Statechart, `flowchart` / `graph` as a Flowchart (runtime parsers; Save writes JSON).
Shared parts (top bar, files, exports, toasts, command palette, keyboard routing, camera,
minimap, inline rename, style editor) live in `src/studio/core/` and `src/studio/ui/`.
Menus open below their button, or above when only that side fits; a menu taller than
the window (File lists every kind's examples) is capped to the roomier side and scrolls,
so the last Statechart examples stay reachable with the mouse, wheel or arrow keys.

## Flowchart editor

The canvas draws the Flowchart Worker's SVG, which equals `convertFlowchart` output byte
for byte, and the overlay uses its layout geometry. Structural edits call the runtime
commands in `src/editor/flowchart/commands.js` (each returns a new validated document and
is one Undo step); simple properties are written directly and validated by the runtime.

- **Connect:** a hovered or selected step shows four handles. Drag one onto another step
  to add an edge (explicit unique id), or onto empty space to add a connected step there
  (inside the group under the pointer); its label editor opens once the layout places it.
  The tooltip names the result or quotes the runtime's reason before you release.
  Handles do not pin sides: the layout chooses, and the inspector sets From/To sides.
- **Reconnect:** a selected edge shows a handle at each end; drag one onto a step.
- **Move:** drag a step onto a group, or a group by its title strip (or use *Move to…* /
  *Inside*); a step's note moves with it and a group moves with everything inside
  (`placeNode` / `placeGroup`). Targets never include the group itself or its
  descendants; the runtime also refuses cycles. Drag a note onto a step to attach it
  there (*Attach to…* in its menu). *Group* (G) wraps the selection in a new group and
  *Ungroup* promotes its members. A group that loses its last member disappears, and
  so do emptied ancestors (runtime rule).
- **Delete:** a step takes its note and edges with it; the last step cannot be deleted.
  Edge selections use the runtime key (explicit id or `edge_N`); commands write implicit
  ids before changing the edge list, so a selected edge keeps its identity.
- **Loops:** *Loops go* Auto lets the runtime pick the shorter side per loop; a fixed
  side sends all loops around it, and sides set on an edge win. Turning the flow (canvas
  head or Layout) removes a fixed loop side that is no longer across the flow, in the
  same Undo step, with a toast (the runtime would refuse it). Statechart shares this.
- **Inspector:** Diagram (name, caption), Layout (four directions, loop side, step/layer
  spacing and note gap with the default-value dot), Defaults (steps, notes, groups,
  edges); for a step: label, ID (rename updates references), type, Inside, edges,
  *Add next step* / *Add note*, minimum size, style; for a note: owner and side; for an
  edge: label, From/To, kind (Auto shows the inferred kind), arrow, sides, style; for a
  group: label, ID, members, style. Style placeholders come from the runtime model
  (`resolvedDefaults` probes it), never restated defaults.
- **Keyboard:** `N` adds the next step after the selected one (or a step), `G` groups,
  `A` opens the add menu, plus the shared shortcuts.
- **Files:** Open accepts Flowchart JSON and Mermaid flowchart text (`.mmd`, parsed by the
  runtime; Save writes JSON). Export SVG writes the canvas text unchanged; PNG uses the
  shared exporter.

## Statechart editor

A flat state machine drawn by the Statechart Worker (SVG equals `convertStatechart`).
It reuses the Flowchart editor's canvas, outline, inspector framework and session
(`src/studio/statechart/` subclasses them) with states and transitions in place of
steps and edges; there are no groups or notes. Edits use
`src/editor/statechart/commands.js`. Conditions, outputs and actions are plain text;
the GUI implies no execution semantics or analysis.

- **States:** name, description (outputs below a line), ID (rename updates
  transitions), kind State / Initial / Final, minimum size, style. Initial and final
  pseudostates have no text or size: switching a state to one removes those fields in
  the same Undo step and says so; they cannot be renamed inline. The runtime refuses
  incoming transitions to an initial state and outgoing ones from a final state; drag
  tooltips and the inspector show its message.
- **Transitions:** drag a handle onto another state, onto the same state for a self
  transition, or onto empty space for a new connected state (inline rename opens).
  A new transition focuses its Condition field. Parallel transitions keep separate
  ids and labels, and the inspector notes how many share the pair. Condition
  (multi-line), From/To (reconnect), routing Auto / Forward / Loop, sides, style.
  Dragging a state body pans (states have nowhere to move).
- **Deletion:** a state takes its transitions; surviving transitions keep their ids,
  so a selected transition stays selected. The last state cannot be deleted.
- **Diagram:** name, caption; Layout (four directions, state and layer spacing,
  label width); Defaults for states and transitions. Placeholders come from the
  runtime's lowered model (`resolvedModel` in `state/actions.js`); the label width
  placeholder is `STATECHART_LAYOUT_DEFAULTS.labelMaxWidth`.
- **Label layout:** the runtime places states and transition labels together and
  routes returns itself, so Statechart has no *Loops go* option; per-transition sides
  stay. *Label width* wraps labels on the drawing only (`displayLabel`); the Condition
  field, inline edit and saved JSON keep the authored text. A layout the runtime
  cannot make safe (`StatechartLayoutError`) is listed under Problems with its
  transition path; the canvas keeps the last good drawing.
- **Rounded corners:** the runtime draws transitions with rounded corners (render
  only; layout points stay orthogonal). A transition's hit area and selection outline
  use the drawn path (`edgePaths` in `statechart/components/canvas.js`), so a click on a
  curve selects it at any zoom and the outline follows the curve; Flowchart keeps the
  routed sections.
- **Retired loop side:** drafts and files that still carry the global
  `layout.loopSide` open without it, and the toast says so (a browser draft is
  rewritten once). Flowchart keeps its loop side.
- **Keyboard:** `N` adds the next state after the selected one, `A` opens the add menu.

## Moving blocks and groups

Membership changes three ways, all the same `placeBlock` command with one Undo step:
drag a block, or a group by its **title strip**, onto a group (dragging inside a group
pans the canvas); **Move to…** in the block or group context menu; or **Inside** under
Identity in the inspector. Targets list Top level and every group in outline order, without
the item itself or its descendants. The title strip stays at least 16 screen px tall when
zoomed out (never taller than the group) and shows a grab cursor; wires crossing it remain
on top and clickable.

## Port order

The Ports table always lists inputs, then bidirectional ports, then outputs; within each
direction it keeps the saved order, and **Move up/down** reorders within one direction.
Listing does not change the document: a file that writes an output before an input keeps
that order. Every add (the table's **+ Input / + Output / + Bidirectional**, the block
toolbar and the context menu, all through `newPort` in `state/actions.js`) inserts the new
port after the last port of its own direction instead of at the end, so saved JSON reads in
the same order. On the canvas only the order of ports on the same side matters, so a new
port on its default side draws exactly as before.

## Concat

Concat is always a thin bar across the Flow (runtime contract: Concat in
[agent-guide.md](agent-guide.md)): inputs on top and the output at the bottom in Down flow,
inputs left and the output right in Right flow. Its Port rows show that side as fixed text
and there is no Shape section, so the GUI cannot write a conflicting side or appearance.
The block toolbar's **Input** adds the next input in composition order; Add output is
disabled while the output exists. Changing Flow (canvas switch or Layout tab) removes
explicit Concat sides and a Flow-specific feedback side in the same Undo step
(`setFlowDirection` in `state/actions.js`). Opened files are taken as written; a conflicting
side or shape is reported at its path and the document is unchanged.

## Spacing defaults

There is one layout density (the former Compact values became the runtime defaults, see
[layout-defaults.md](layout-defaults.md)), so the Layout tab has no Density control. Block and
Layer spacing use the style editor's dot: hollow means the field uses the default
(20 / 30), shown as the placeholder; filled means a value is set on this diagram, and
clicking the dot returns that field to the default in one Undo step. Explicit spacing always
wins. Defaults are never written to the JSON. Group views use the same defaults.

A group's Layout tab has **Spacing inside** with the same two fields (runtime contract:
[Container-local Auto spacing](layout-defaults.md#container-local-auto-spacing)). Each
property inherits on its own from the nearest group that sets it, then the diagram, then
the defaults: the placeholder shows the inherited value (`resolveLayoutSpacing`) and the
hollow dot's tooltip names its source ("Inherited from group Complex (80)"). Typing a
positive number sets it on this group; the filled dot clears just that property, and an
empty `layout` object is removed, so inheritance is never pinned. Zero or negative values
stay in the field with an inline error. Switching the group's arrangement between Grid
and Automatic keeps its spacing; with Grid a note says spacing still applies to automatic
members and nested groups, and a collapsed group notes that its values apply once its
contents are shown. Where the group sits among its siblings follows its parent.
Like Grid gaps, these values are minimums (runtime contract:
[Adjacent Auto routing channels](layout-defaults.md#adjacent-auto-routing-channels)): in
a crowded Auto group the runtime widens a gap just enough to give each Net its own wire
track, and the section's hint says so. The fields and saved JSON keep the typed value;
derived `routingInfo` (`auto-channel` tracks) is never saved and the GUI never computes
channels itself.

`layout.density` is a retired field: the runtime rejects it at `layout.density`, and the GUI
never writes or migrates it. Opening such a file shows that error and keeps the current
document. A browser draft the runtime rejects at startup is moved to
`blockflow.editor.v1.rejected` (so autosave cannot overwrite it). An error toast names the
field once, on that start only. **Save copy** in the toast, or **File › Save unopened draft**
(shown while a copy is kept), downloads the original unchanged as `<name>-unopened.json`
and forgets the kept copy.

## Net junction dots

The runtime marks same-Net forks with junction dots (layout `junctions`; contract:
[Automatic Net junctions](blockchart-layout.md#automatic-net-junctions)); the canvas
draws them as part of the runtime SVG. A dot is not its own object: its disk (at least
6 units) is a hit target for its first participating branch, placed under the branch
paths, so a click on a wire keeps that wire's branch and a click beside the wire on the
dot still selects the Net. Junctions and other derived routing data are never saved.

## Routing diagnostics

The runtime attaches computed `routingInfo` records to layout connections (approach
spacing, channel corridors, distributed corridor tracks; contract:
[Physical corridor distribution](blockchart-layout.md#physical-corridor-distribution)).
Studio needs no controls for them: the canvas draws the returned SVG and picks wires
from the final section points, so a moved rail is picked where it is drawn. A click
within the hit stroke of a same-Net fork may pick the sibling branch there; the
branch's own stretch beyond the fork picks that branch. These records stay in the
layout result and are never saved.

## Paint-only edits

An edit whose only change is in the runtime's reuse allowlist is sent with
`paintOnly: true`. The allowlist covers:
- body fill, border paint and border pattern of blocks and groups;
- Net/branch stroke paint and line pattern;
- text paint and multi-line alignment, at the default and override levels, including
  removing an override;
- key renames of labelled blocks, groups and ports.

The full field list is in the runtime contract,
[Paint-only Blockchart edits](editor-runtime.md#paint-only-blockchart-edits).

`BlockchartStudio.layoutHint` compares the previously requested document with the new
one by the runtime's own `geometryKey`. The Inspector, Style paste, scripts and
Undo/Redo therefore all qualify without per-control wiring. Measured properties
(`borderWidth`, `strokeWidth`, arrows, `fontSize`, `padding`, `hidden`) and renaming an
unlabelled key, which is its visible text, still run a full layout.

Text edits of ordinary rectangle Block titles and internal Port labels qualify when the
runtime's measured key is unchanged, that is, the new text keeps the Block's size.
Coordinates and routes are kept, the drawing shows the new text, and label bounds (and so
the F2 rename box) follow it. Text that adds a line or widens the Block changes the key, so
Studio requests a full layout. On DShot v3 in Top and Bank0, a same-size title or Port
edit and its Undo/Redo reach the canvas in about 75 to 200 ms. A third title line or an
overflowing Port name takes the full layout (about 2.4 to 7 s on this laptop). Evidence:
`output/gui-label-repaint-acceptance/`.

The hint is given only for a document change in the same view as the previous request.
Opening or replacing a document and real view switches are ordinary requests.
Renaming the viewed group's key is the same view. The Blockchart Store keeps the view
on that group after the edit, Undo and Redo: the group keeps its slot in `groups`, so a
missing root whose slot now holds a new key follows it. The view does not switch or
refit, and the hint treats the new root as the previous one.

The Worker re-checks its own last geometry and falls back to a full layout on a miss.
A paint edit right after a pending geometry edit or view switch therefore still ends
on the new geometry.

On DShot (d3775c12) these edits and labelled renames reach the canvas in about 45 to
330 ms in Top and Bank0. A `borderWidth` edit takes a full layout (Top about 3.7 s while
this laptop ran slowly). Evidence: `output/gui-paint-identity-acceptance/`. Save writes
the authoring document only.

## Updating layout

While a layout is computing, the canvas keeps showing the previous drawing and stays
interactive (pan, zoom, selection). If the result has not arrived 500 ms after the
request (`STALE_DELAY_MS` in `core/canvas.js`; the service's 180 ms coalescing is part of
it), the drawing dims to 45% and an "Updating layout…" chip (`role="status"`) appears at
the top of the canvas. Selection and hit targets stay at full strength. Further edits
while dimmed keep the state without a flicker; the next result removes it. Paint-only
edits and small diagrams finish first and never dim. A failed layout keeps the last
drawing dimmed with "Layout failed — showing the last result" until a good result.
With no drawing yet (first open, replace), the centered "Laying out…" is used instead.
All three diagram kinds share this through `StudioShell.requestLayout`/`onLayout`.

On DShot (`8c344c87`), changing the FIFO0 label reached the canvas in a median
of **2,092 ms in Top** and **913 ms in Bank0** after the routing optimization.
The table shows medians from six paired Studio runs on the same machine, with
the build order alternating each round. The label edit includes the normal 180 ms
coalescing delay. The warm layout measurement disables that delay.

| DShot view | Warm layout before | Warm layout after | Label edit to canvas before | Label edit to canvas after |
| ---------- | -----------------: | ----------------: | --------------------------: | -------------------------: |
| Top        |           4,547 ms |          2,000 ms |                    5,072 ms |                   2,092 ms |
| Bank0      |           1,625 ms |            712 ms |                    1,746 ms |                     913 ms |

The paired measurements come from `studio-paired.mjs` and `studio-paired-report.json`
in `output/gui-layout-latency-measure/`. For the runtime changes, see
[Orthogonal search reuse](blockchart-layout.md#orthogonal-search-reuse).

## Typing during re-renders

The Inspector and Outline are rebuilt from the document after every commit and layout
result (`replaceKeepingFocus` in `ui/dom.js`). Text fields commit on Enter or blur, so
the focused field may hold uncommitted typing when that happens. Chrome fires `change`
when a focused, edited control is removed, which used to commit the draft in the middle
of the render and then show the old value again (typed letters seemed to vanish). Now
the old control is reset silently first, and:
- the same field rebuilt from an unchanged document value keeps the draft, caret and any
  inline error; nothing is committed until Enter/blur, and Escape still reverts;
- if that document value changed elsewhere (Undo, a script), the new value wins;
- if the field is gone, the draft commits through the old control after the new
  content is in place.
`h()` records each control's built value to tell these apart. Applies to all three
diagram kinds.

## Container titles and drawing ids

Wires may cross ordinary Container titles and are drawn continuously; the title text is
painted on top, and explicit label backgrounds still paint normally. Net hit targets follow
the same continuous routes. Connection-label masks use the renderer's default id prefix, so
during the 180 ms relayout cross-fade the leaving drawing's ids are renamed (`leaving-N-…`).
The current drawing therefore always resolves its own definitions and stays identical to the
exported SVG. The minimap loads the SVG as an image, isolated from the page.

## Grid arrangement

The Layout tab edits a scope's Grid as text (Cells). Writing a Container's name keeps it one cell;
writing its blocks instead expands it so they align with the rest of the Grid (all of them, as one
rectangle). There is no expansion flag: the hint under Cells shows which Containers are expanded.
Row gap and Column gap are minimums (runtime contract:
[Grid routing channels](layout-defaults.md#grid-routing-channels)): a crowded gap widens so
each Net gets its own wire track, while the field and the saved JSON keep the typed value;
the hint under the gaps says so. Derived `routingInfo` (channel track, status) is never
saved. Block min width and Block min height (`blockMinWidth`, `blockMinHeight`, runtime
contract: [Grid Block minimum dimensions](blockchart-layout.md)) set a floor for the blocks
written in that scope's Cells, in block units (width 1 = 140, height 1 = 84). Each axis is
independent; blank is Auto and removes the key. Zero, negative and non-numeric values stay in
the field with an error. Switching the scope to Automatic removes both bounds with the other
Grid-only fields. Block alignment Left / Center / Right (`blockAlign`, runtime contract:
[Grid Block horizontal alignment](blockchart-layout.md#grid-block-horizontal-alignment))
moves the blocks and whole Container cells written in Cells within their column, in
physical horizontal terms in both Flows; it is separate from label text alignment and
never changes sizes. Omitted shows Center; choosing Center removes the key. Switching to
Automatic removes it too. Changing Flow does not transpose Cells. Typed Cells are never repaired. An invalid edit stays in the field with the row and column of the
problem, and the document is unchanged.

Commands that change membership update every Grid they affect in the same Undo step
(`src/studio/state/grid-sync.js`):

| Command                                                   | Grid effect                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Delete block or group                                     | Its cells become empty                                                                    |
| Add, duplicate or move a block into an expanded Container | Placed in the Container's first empty cell, else a new row below it (column in Down flow) |
| Move a block out of a Container                           | Its old cell becomes empty; it is Auto in the new scope                                   |
| Group placed items                                        | The new group takes the first item's cell as one cell                                     |
| Change an expanded Container to Boundary/Collection       | Its blocks fold into one cell at the rectangle's top-left                                 |
| Ungroup                                                   | Expanded children keep their cells; a one-cell group leaves an empty cell                 |

Opening a file or loading an example takes its JSON exactly as written; these updates apply only to
editing commands. The result is always validated by the runtime (`reconcileGrids`) before it is kept.

## Layout of the window

| Area      | Contents                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| Top bar   | Name, save state, command palette (Ctrl+K), undo/redo, theme, File, Export                                        |
| Outline   | Filter; Blocks (group tree, drag to regroup); Terminals; Nets (expand to branches); Problems (click to select)    |
| Canvas    | Breadcrumb group view, flow direction, floating selection toolbar, zoom bar, minimap, status bar                  |
| Inspector | Selection-dependent Properties / Layout / Style tabs. With nothing selected: Diagram, Layout options and Defaults |

In Flowchart and Statechart Problems, each row names its item first (an edge's ends and
condition, or the step or state) with the runtime message below, since several warnings
such as `FLOW_LABEL_OVERLAP` share one message; a click selects the item. The status bar
counts label warnings.

Below 1000 px the outline and inspector become drawers; the canvas keeps the full width.
Closed drawers are hidden (out of the tab order) and clipped, so the page never scrolls
sideways. Below 560 px the top bar keeps every control on screen: File and Theme move to
the command palette, the kind chip and Export show only their icons (with accessible
names), and the diagram name field takes the remaining width.

## Styles

The style editor is driven by `src/studio/state/style-schema.js`. Every field shows a dot: filled means the
value is set on this item (click it to inherit), hollow means inherited, with the value in use as the
placeholder. Quick styles write ordinary values; the schema has no named-style storage. Copy style and
Paste style work between items of the same kind. Diagram defaults (`diagram.style`) use the same editor.

Every text section has **Line alignment** (Left / Center / Right, runtime contract:
[Text alignment](text-alignment.md)): it aligns the lines of a multi-line label within
its own text block and never moves geometry. *Inherit* removes the field; with nothing
inherited the option reads "default for this text", because each text role keeps its own
default. Blockchart offers it in label, port-label, net-label and text sections;
Flowchart in step, note, group and edge text; Statechart states also have
**Description alignment** (inherit follows the line alignment), and transitions have
line alignment only. The Statechart placeholder for description alignment comes from
the layout's state styles, since the lowered graph model omits it.

## Theme

`src/studio/styles/tokens.css` defines primitives and semantic tokens for light and dark. The setting is
System, Light or Dark (top bar or command palette) and is applied before first paint. Only the editor
chrome changes: the diagram sheet always stays the exported white artboard, and the overlay colours are
tuned for that sheet.

## Copy JSON

**Copy JSON to clipboard** (File menu, Export › Whole diagram source, command palette)
copies exactly what Save JSON writes: the whole document, 2-space indented, in any
group view. A toast confirms the block count and size. If the browser blocks the clipboard,
the legacy copy command is tried, then a dialog shows the JSON already selected. There is no
shortcut: Ctrl+C is kept for copying selections and Ctrl+Shift+C opens browser devtools.

The Export menu repeats the two whole-source actions under *Whole diagram source* with the
File menu's names, **Save JSON** and **Copy JSON to clipboard**: one action has one name
wherever it appears.

## Story editor (presentations)

The **Story editor** (`story.html`, `src/story/`) is a separate page that authors a
**story**: chapters of steps that animate signals hop by hop over a Block diagram, for
presenting how data moves between hardware blocks. The diagram is input only. The Studio
has no Story mode and no story code; it imports only `src/story/handoff.js`.

- **Input and output.**
  - Input: a Block diagram JSON. The Story editor never changes it.
  - Output: a story JSON (`"format": "blockflow-story"`). *Save story JSON* adds
    `diagram: { name, sha256 }`. Opening a story made for another diagram name, or for
    another version of this diagram, says so.
  - Export: one offline HTML page. It holds the player, the drawn SVG and both sources.
  - Opening that exported HTML in the Story editor brings back its diagram and story for
    further editing.
- **Getting there.**
  - From the Studio: *Export › Open in Story editor* (Block diagrams, command palette too)
    opens `story.html` in a new tab with the whole diagram. The hand-off is one-shot browser
    storage (`blockflow.story.incoming`), removed when read and ignored after a minute.
  - Opening a story JSON or presentation HTML in the Studio keeps the current diagram and
    offers *Open Story editor*.
  - In the Story editor, *Open…*, Ctrl+O or dropping a file accepts a Block diagram, a story
    or an exported presentation. Flowcharts and statecharts are refused.
- **Drawing.** The diagram is laid out by the Block diagram Worker (`LayoutService`). The
  player shows the resulting SVG, the same text Studio *Export › SVG* writes for the whole
  diagram, unchanged.
- **The player** (`src/story/player.js`, no imports) adds a dimming mask, wire highlights,
  moving dots, note and badge chips, a camera that follows each hop, and the chapter timing
  strip. The Story editor runs it with editing picks; the exported page runs the same file
  without them. It receives no layout geometry: it finds wires and blocks through the
  SVG [identity metadata](blockchart-layout.md#rendered-svg-identity-contract).
  - A wire is every `connection-path` whose owners include its endpoint pair, either
    through `data-from`/`data-to` or through `data-endpoints` on shared paths. Its
    sections are chained from source to target, so a dot can travel the route. Its arrows
    fill in when the hop arrives.
  - A block is its `block` rect or `block-body` wrapper (`data-module`). Its tooltip and
    note name come from the `block-label` text. Terminals are `@terminal:ID`.
  - Reference checks use the same metadata (`svgIndex` in `model.js`).
- **Authoring.** The left pane lists chapters and steps. The right pane edits the selected
  step or chapter:
  - title, caption, *Animated hops* or *Chapter overview*, and camera;
  - hops in order, each with a kind and an optional badge. Clicking a wire on the stage
    adds it to the selected hop or removes it, and Shift+click starts a new hop;
  - notes, added by clicking a block or terminal;
  - timing-strip rows and range when the chapter has a strip (chapter JSON in the chapter view).
- **References by endpoint.** A hop names wires as `Module.port -> Module.port` (a terminal
  end is `@terminal:ID`), the same pairs the SVG exposes, never by layout ids. Reordering
  connections therefore keeps the story. References the diagram does not have are kept:
  they are marked in the list and editor, counted in the status bar and skipped when playing.
- **History and storage.**
  - Undo/Redo (buttons, Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y) apply to the story. Opening a
    story is one undoable change.
  - The open diagram is kept in this browser (`blockflow.story.session`), so a reload
    continues.
  - Stories are kept per diagram name (`blockflow.story.stories`). Stories from the
    former Studio Story mode (`blockflow.studio.stories`) are still read.
  - Ctrl+S saves the story JSON.
  - The theme follows the Studio's preference.
- **Playback keys** (outside text fields): ← → steps, R replays, P plays all, A toggles the
  whole-diagram camera. The wheel zooms and dragging the background pans the stage.
- **Export.** *Export HTML* (canvas head, Export menu) downloads the page:
  - player, page shell (`present.js`, `present.css`) and data inlined, with no network
    access;
  - sources in `<script type="application/json" id="blockflow-sources">`.

  *Preview* opens the same page in a new tab at the selected step. The page has chapter
  tabs, the caption, the step list, `#step-N` links, F for full screen and its own dark
  theme around the white sheet.
- **Builds.** `story.html` is a second page of the web build. Offline, `npm run
  build:offline` builds each page into its own folder:
  - `dist-offline/studio/` and `dist-offline/story/`, each with `index.html`, `app.js`
    and `style.css`;
  - `dist-offline/index.html`, which links the two.

  One classic script cannot hold two pages, so `vite.offline.config.js` runs once per page
  (`--mode story` for the Story editor). It defines where each page finds the other
  (`../story/index.html`, `../studio/index.html`).
- **Hand-off messages.** The Studio opens the Story editor tab and listens; the tab asks its
  opener with `postMessage` and receives the diagram the same way (`handoff.js`). No
  browser storage is involved, so this also works between the two offline folders under
  `file://`. A reloaded tab does not ask again; it restores its own session.
- **Tests** use the Story editor's own Block diagram and story,
  `tests/fixtures/story/signal-path.json` and `signal-path.story.json`. They contain
  terminals at both ends, a group and a start Net that fans out over a shared trunk.
  Coverage: `tests/story/model.test.js` and `e2e/story.spec.js`.

## Keyboard

`Ctrl+K` command palette and go-to · `B` add block · `G` add group · `A` add menu · `F2`/double-click rename ·
`Delete` remove · `Ctrl+D` duplicate · `Ctrl+G` group · `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo · arrows move
between blocks · `Shift+1` fit · `Shift+2` zoom to selection · `Space`+drag pan · `Escape` clear selection
or leave group view · `?` shortcut list.

## Files

```
src/studio/
  main.js, app.js          entry; the host runs one editor session per diagram kind and switches between them
  core/kinds.js            kind registry (label, examples, validator), root-key dispatch, Mermaid import
  core/shell.js            StudioShell: top bar, panes, theme, files, exports, toasts, palette, keyboard
  core/canvas.js           CanvasBase: SVG + overlay, camera, cross-fade, minimap, toolbar, inline rename
  core/store.js            history, selection, layout status, per-kind browser draft, shared preferences
  ui/                      dom.js, controls.js, icons.js, palette.js, style-editor.js (schema-driven)
  styles/tokens.css, studio.css
  blockchart/
    studio.js              Block diagram session: commands, menus, toolbar, group views
    examples.js            bundled examples (first one loads on a first visit)
    components/canvas.js   ports, nets, drag-to-connect, drag-to-regroup
    components/outline.js  tree, nets, problems
    components/inspector.js properties, layout hints, style tabs
    state/store.js         Blockchart store rules (Grid sync, port multi-select, view root)
    state/actions.js       net planning, concat, deletes, renames, problems
    state/grid-sync.js     Grid cell updates for membership commands
    state/style-schema.js  style fields, built-in defaults, quick styles
  statechart/               subclasses of the Flowchart session, canvas, outline and inspector
    studio.js, examples.js (examples/statechart/), state/actions.js, state/store.js
    components/canvas.js, outline.js, inspector.js
  flowchart/
    studio.js              Flowchart session: commands, menus, toolbar, inline rename of new steps
    examples.js            bundled Flowchart examples (examples/flowchart/)
    components/canvas.js   steps, notes, groups, edges; handles to connect, reconnect, move, attach
    components/outline.js  steps by group with notes, edges, problems
    components/inspector.js diagram, layout, defaults, step, note, edge and group views
    state/store.js         Flowchart store rules (draft key, selection existence)
    state/actions.js       lookups, edge keys, move targets, problem paths
    state/style-schema.js  node/edge style fields, runtime-probed defaults, quick styles
src/story/                  Story editor (story.html); reuses src/studio/ui and styles
  main.js, editor.js       entry; StoryEditor: page, files, hand-off, story history, list and step panes
  handoff.js               Studio → Story editor hand-off (the only file the Studio imports)
  model.js                 story format, validation, SVG identity index, sources of exported pages
  player.js, player.css    presentation player shared with the exported page (no imports)
  present.js, present.css  exported page shell around the player
  export.js                standalone presentation HTML (inlines player, shell, SVG and sources)
  story.css                story list, step editor and stage
```

Editor support comes from `src/editor/` ([Editor support APIs](editor-runtime.md)): each
kind's `commands.js` and `services/layout.js`, and `shared/history.js`. The offline build
resolves each domain service's `./worker-factory.js` to the sibling
`worker-factory.offline.js` of the same domain (`vite.offline.config.js`), so every
diagram kind gets its own inline Worker. `e2e/studio.spec.js` covers the Block diagram
editor, `e2e/flowchart.spec.js` the Flowchart editor and `e2e/statechart.spec.js` the
Statechart editor (both also cover kind switching), and `e2e/alignment.spec.js` text
alignment in all three. `e2e/story.spec.js` covers the Story editor.

`e2e/offline.spec.js` (`npm run test:e2e:offline`) copies the whole `dist-offline/` folder
and opens both pages from `file://` with no network. Studio checks:
- classic scripts and Blob workers;
- every bundled example of every kind against its converter;
- downloads, file open and drop;
- separate drafts and unavailable storage;
- phone width with an axe scan;
- recovery from a crashed worker.

Story editor checks: the test diagram against its converter, the story fixture, export
and reopening the export, and the Studio-to-Story hand-off between the two folders.
