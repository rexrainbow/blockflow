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

## Moving blocks and groups

Membership changes three ways, all the same `placeBlock` command with one Undo step:
drag a block, or a group by its **title strip**, onto a group (dragging inside a group
pans the canvas); **Move to…** in the block or group context menu; or **Inside** under
Identity in the inspector. Targets list Top level and every group in outline order, without
the item itself or its descendants. The title strip stays at least 16 screen px tall when
zoomed out (never taller than the group) and shows a grab cursor; wires crossing it remain
on top and clickable.

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
saved. Changing Flow does not transpose Cells. Typed Cells are never repaired. An invalid edit stays in the field with the row and column of the
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

Below 1000 px the outline and inspector become drawers; the canvas keeps the full width.

## Styles

The style editor is driven by `src/studio/state/style-schema.js`. Every field shows a dot: filled means the
value is set on this item (click it to inherit), hollow means inherited, with the value in use as the
placeholder. Quick styles write ordinary values; the schema has no named-style storage. Copy style and
Paste style work between items of the same kind. Diagram defaults (`diagram.style`) use the same editor.

## Theme

`src/studio/styles/tokens.css` defines primitives and semantic tokens for light and dark. The setting is
System, Light or Dark (top bar or command palette) and is applied before first paint. Only the editor
chrome changes: the diagram sheet always stays the exported white artboard, and the overlay colours are
tuned for that sheet.

## Copy JSON

**Copy JSON to clipboard** (File menu, Export › Whole diagram source › Copy JSON, command
palette) copies exactly what Save JSON writes: the whole document, 2-space indented, in any
group view. A toast confirms the block count and size. If the browser blocks the clipboard,
the legacy copy command is tried, then a dialog shows the JSON already selected. There is no
shortcut: Ctrl+C is kept for copying selections and Ctrl+Shift+C opens browser devtools.

## Keyboard

`Ctrl+K` command palette and go-to · `B` add block · `G` add group · `A` add menu · `F2`/double-click rename ·
`Delete` remove · `Ctrl+D` duplicate · `Ctrl+G` group · `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo · arrows move
between blocks · `Shift+1` fit · `Shift+2` zoom to selection · `Space`+drag pan · `Escape` clear selection
or leave group view · `?` shortcut list.

## Files

```
src/studio/
  main.js, app.js          shell, commands, menus, keyboard, files, export, toasts
  examples.js              bundled examples (first one loads on a first visit)
  components/canvas.js     artboard + overlay, pan/zoom, drag-to-connect, drag-to-regroup, inline rename, minimap
  components/outline.js    tree, nets, problems
  components/inspector.js  properties, layout hints, style tabs
  components/style-editor.js, palette.js
  state/store.js           history, selection, view root, persistence (same localStorage key as before)
  state/actions.js         net planning, concat, deletes, renames, problems
  state/grid-sync.js       Grid cell updates for membership commands
  state/style-schema.js    style fields, built-in defaults, quick styles
  styles/tokens.css, studio.css
  ui/dom.js, controls.js, icons.js
```
