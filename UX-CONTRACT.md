# Diagram Studio behavior contract

## Grid and overview authoring

Blocks / Connections / Layout / Defaults are four keyboard tabs using the same retained workspace.
Layout chooses Top or a group; Auto remains default. Grid edits are local drafts until Apply
layout, with Reset draft and inline validation; any subset of direct members may appear,
each at most once. Rows/Columns resize the matrix (positive integers, at most 10,000 cells
in the GUI); selected members outside a smaller matrix return to Auto. New grids start
empty. Auto arranged lists unselected members. Selecting an already placed member moves
it to the new cell and clears its old cell, retaining selection focus and scroll position.
Rows/columns and gap controls use native selects/inputs and a horizontally scrollable table.
Layout fills the workspace width in Split and Editor views and follows splitter/window
resizing. Its Grid cells never shrink away in a short panel: scroll the form vertically
and the table horizontally. Auto explicitly points to Arrangement > Grid to reveal cells.
Successful Apply is one Undo step, failed Apply preserves the document and focuses a cell.
Undo/Redo and document replacement reset the displayed draft to the committed configuration.
Membership changes clear stale references without filling blank cells; new members stay
Auto. ID changes retain cell positions. Grid cells are layout
references, never fake signal connections. Auto parents retain placement unless resized
children overlap. Fixed routes avoid block interiors; obstructed access reports a layout
error and disables image export until corrected. Partial Grids occupy one temporary
rectangle among Auto neighbors, preserving empty tracks and never altering JSON hierarchy
or signal identity. All-null Grids leave every member Auto and reserve no rectangle.

Container expansion has no separate control: it is derived from Cells. Placing any direct
child of a nonempty, non-collapsed direct Container expands it; placing the Container id keeps
it one cell. A hint lists each eligible Container with its children and marks expanded ones.
Typed Cells are never repaired: errors name the row and column and keep the draft. Commands
that change membership keep Grids valid in the same Undo step: deleted IDs leave empty cells;
new or moved children of an expanded Container fill its first empty cell, else a new row
(column in Down flow); moved-out IDs become Auto; a new group takes its first item's cell;
a Container that stops being expandable folds into one cell; ungrouping keeps children placed.
Each expanded Container spans a disjoint rectangle containing only its members or null.
Apply failures retain the draft and focus the relevant checkbox/cell. Unchecking clears
child cells and returns the whole Container to Auto unless explicitly placed. Membership
changes keep references but never auto-fill: a new expanded member must be placed before
valid export. Shared track gutters reserve Container titles, borders and size minima.
Real frames fit around cells and preserve ancestry, Port/edge identity and selection.
Ancestor control suspends the expanded Container's saved layout only in that view; group
views reuse the saved local layout. Boundary/Collection stay atomic. One-level expansion
per scope keeps nested groups whole while their own internal layouts continue to work.
An expanded Container's Layout scope includes a note naming the ancestor Grid and
explaining when it controls positions and when the local settings apply.

Portless ordinary blocks are valid, with port count zero reflected in details. With all Port names hidden, block
geometry omits text lanes and proxy Port rows, using title/appearance geometry plus
minimum slot extents. Ports and their identity remain intact, explicit minimum dimensions
are honored, and showing Port names restores text-aware geometry in either Flow.
Concat keeps its minimum input/one-output rule. Add bidirectional port creates inout; Side selects Follow
Flow or a physical side on ordinary blocks; Concat shows its Flow side as fixed text. Connections support Both directions (two inout receiving faces)
and Affect placement, preserving all signal validation. Style has Start arrow and End arrow.
Layout's Diagram caption edits the global multiline footer with normal blur/history behavior.
Schema, scoped/collapsed layouts, SVG/PNG, DOM, offline and Agent Kit share these rules.

## Rounded group styles

Group Style adds Corner radius as the shared non-negative numeric field. Blank inherits
the diagram Group default (built-in 0); zero draws square corners. Cancel/Escape discard, OK validates and commits one Undo
step, and invalid values retain the dialog and focus the field. Expanded group frames,
collapsed faces/cards, Preview, SVG/PNG and DOM share the same clamped radius. This group
style does not alter geometry, routing, Port anchors or signal semantics. Blocks do not
expose this field. Signal-only labels/abstract concat reuse existing Connection, Terminal
and Concat controls; no diagram-specific renderer or layout behavior.

## Flow direction

Preview uses a native Flow select beside View for Left to right / Top to bottom, sharing
layout.direction with Layout settings. Only Right and Down are available.
preserve endpoint/Concat order and selection, and fit after the latest worker result is
accepted. Undo/Redo also synchronize selectors and fit. Clear cached scope cameras on a
direction change so another view cannot restore geometry from a different axis. Invalid or
pending results retain the existing export/action guards.

Text remains horizontal; measure ports, names and terminals for the selected axis. Down
uses top/bottom ports ordered left to right, a horizontal Concat bar and output-shortened
trapezoids. Groups, real and virtual interfaces, collection stacks and scoped views follow
the same flow. Feedback-side options depend on the axis; blocked exterior access keeps ELK.
Use shared select styling, wrapping toolbar layout and normal keyboard behavior. SVG/PNG,
offline and DOM use the accepted layout geometry without editor-only controls.

## Concat

Add Concat reuses Add block's creation, group placement, selection and history flow. Create
two input ports and one output with unspecified widths, a stored Concat name and hidden
title/port text. Reuse existing Port rename, width, text style, ordering and deletion controls;
disable Add output and reject deletion of the sole output or last input atomically. Show
composition-order and optional-width guidance in block details. First input is the high part;
reordering is a real semantic edit with Undo. Ordinary block behavior stays unchanged.

Concat is always a thin Flow-aligned Bar: Down puts inputs on top and the output at the bottom,
Right puts inputs left and the output right. Its Port rows show that side as fixed text and the
Shape section is absent, so no control can write a conflicting side or appearance. The block
toolbar adds the next input; Add output is disabled while the output exists. A Flow change
(canvas switch or Layout tab) removes explicit Concat sides and a Flow-specific feedback side in
the same Undo step. Opened files keep their values; conflicting sides or shapes are reported at
their runtime path and leave the document unchanged. Hit targets use published Port anchors.

Only all-explicit input/output widths trigger the sum check. Mismatches disable accepted
preview/image export through normal validation and remain recoverable after draft reload.
No width inference or bit-range text is generated. Style shows Bar as Concat's implicit
appearance and preserves omission on unchanged OK. Concat remains selectable as a block,
including hidden names and real port targets. Reject Boundary conversion to preserve its
semantics. Preview, scoped groups, SVG/PNG, offline and DOM share geometry and identity.

## Block appearances and signal notation

Block Style reuses the existing Block tab for Appearance and conditional Stack layers or
Right height ratio controls. Rectangle remains the implicit default. Numeric blanks use
profile defaults; malformed parameters remain drafts with inline errors and focused fields.
OK commits appearance and style together as one undoable transaction; Cancel discards both.
Shape changes preserve selection, endpoints and the existing camera anchoring behavior.
Visual stacking has no group membership, disclosure control or member count. Conversion to
Boundary requires Rectangle; explain this without silently dropping a shape.

Every text-style section exposes Hidden with Inherit default, Yes and No. Hidden affects
only text, background and width notation, preserves names/identity and reserves no text
space. Per-property inheritance allows explicit false to restore a hidden label. Connection Style's
Line tab adds End arrow with Inherit default, None and Triangle. Defaults owns shared
Port visibility and Connection arrows, committed through Apply with Undo. Layout settings
owns Auto/Top/Bottom Feedback side, committed immediately with Undo. Explain that Feedback side
applies only to Outer routing and blocked access keeps ELK. Hidden port text reserves no
space, while port targets, endpoint identities and accessible names remain usable. Terminal names can be hidden through their own text style. Shapes, arrows and visibility use the same layout/SVG path for Preview,
offline, SVG/PNG export and DOM viewer. No new dependencies or separate interaction system.

Connection labels are optional multiline document text. Blank editor input removes the
property; JSON requires non-blank text when present. Changes commit on blur (Enter inserts a newline) with the
existing IME, invalid draft, history and camera behavior. Add connection accepts the same
optional Label. Connection Style reuses the shared modal with Line/Label tabs and transactional
OK/Cancel, validation and focus restoration. Label clicks select the owning connection.
Compact layout places blocks and routes without reserving Connection label rectangles in
ELK, then measures/fits all labels on final routes after feedback routing.
Labels remain visible when clearance cannot be achieved, with structured layout warnings
shown in the existing preview message surface; valid SVG/PNG exports remain available.

Authority: the user's GUI and optional-width decisions, SPEC.md, and the core JSON API.
Visual source: DESIGN.md → src/editor/styles/tokens.css. This new app has no sibling UI;
Blocks, Ports and Connections share the same primitives and transactional history.

## Canonical UI Map

| Capability     | Canonical owner                         | Source of truth            | Allowed variants         | Verification                                   |
| -------------- | --------------------------------------- | -------------------------- | ------------------------ | ---------------------------------------------- |
| Select/Listbox | components/ui.js native select          | This contract              | native OS popup          | e2e/editor.spec.js                             |
| Form           | components/ui.js + app.js field adapter | Core model + this contract | create/edit/style        | e2e/editor.spec.js                             |
| Scrollbar      | styles/tokens.css                       | DESIGN.md                  | panel geometry           | e2e/editor.spec.js                             |
| Toast          | app.js single live status               | This contract              | success/error/info       | e2e/editor.spec.js                             |
| CRUD           | state/commands.js + state/history.js    | Core JSON schema           | blocks/ports/connections | tests/editor/state.test.js, e2e/editor.spec.js |

No searchable server table, date picker, authentication, permissions or external writes.
No pagination: these are complete local document lists in bounded scroll regions.

## Document and history

History is up to 100 independently cloned raw JSON snapshots. One commit is one step;
typing commits on change/blur/Enter after IME composition, never on each character.
New edits clear redo. Delete block/port and dependent edges is one reversible transaction.
Document edits persist locally as a recoverable draft, not a cloud save. Storage failures
show a persistent warning. JSON download marks a document saved. New/import/example replace
documents only after an app dialog if unsaved, and remain recoverable with Undo.

Dropping one JSON file anywhere inside the editor uses the same openFile pipeline as
File > Open JSON: size limit, JSON parsing, model validation and dirty
replacement confirmation. Prevent browser navigation on file drag/drop; use the copy cursor
when available. Reject multiple files and unsupported file types through the existing notice
without changing the document. Keep internal block/group/port/connection reordering separate.
An open dialog retains its draft; ask the user to close it before accepting a dropped file.
Only one file read runs at a time. The same behavior works in the offline build.

Port width omitted means unknown (normalized null), not one bit. Only two explicit widths
must match. One explicit side determines the connection's display width without changing
the unknown port. No width inference across fanout. Inputs cannot have multiple drivers.
Input/output order controls port placement; block and connection list order do not impose
layout position. Connections form one flat list in document order. Reordering rows changes
only array order. GUI rows and the Add connection
dialog expose endpoints, labels, feedback and Style; new Nets contain an ID, one from and array targets, plus selected direction/feedback flags; styles remain optional.

## Forms and recovery

Block list rows show the display name and key; input/output counts are omitted from the list.
Block details has a labeled [?] help button. Its app-owned dialog contains the key rename and
optional-width instructions previously shown inline. Done/Escape restores focus; opening and
closing Help changes neither the document, history nor layout.

Connections uses one ungrouped list in #connection-list with a single vertical scrollbar.
Main/Others headers, wrappers, collapse controls and tier-transfer buttons are absent. A single
Add connection action lives in the fixed panel footer. Its dialog accepts endpoints and an optional feedback preference.
Selection and scroll remain stable across edits and tabs.

Draft rows may temporarily have zero ports; retain last valid SVG, mark preview stale,
disable image export and explain which block needs a port. An empty document shows a clear
add-block invitation. Import validates before replacing; invalid files leave the document
intact. Field errors preserve entered values, aria-invalid and aria-describedby. Native
forms use novalidate, no native validation bubbles. Source/target options show incompatible
width/occupied reasons. Rename port updates endpoints atomically. ID is distinct from label.

## Async and preview

Block selection is UI state and may explicitly be null. Clicking a block in the list or
preview selects it. Clicking only the block-list background (inside its client area, excluding
rows, controls and scrollbars) or the preview background clears selection. Preview classifies
the gesture on pointer-up: movement below 4 CSS pixels is a click, while crossing the threshold
at any point is a pan, even if the pointer returns to its start. Canceled/lost-capture gestures
do not clear selection. Sub-threshold jitter does not move the viewport.

Escape clears selection after dialogs and sort menus have handled it; IME composition and
native select controls retain their own Escape behavior. Clearing removes the list highlight,
SVG selection outline and block detail controls, showing the select-a-block empty state.
Keyboard focus returns to the list or preview container when the selected control is removed.
Pending block field edits finish through the normal change handler, with invalid drafts retained
for reselection; unrelated pending fields are untouched. Clearing alone does not edit JSON,
add history, run layout or change pan/zoom. Null selection survives re-rendering and Undo/Redo;
initial load/import and adding a block may select a block explicitly.

Layout service owns a module Worker; a revision token suppresses stale results immediately
on edit, with a 180ms coalescing delay. Work can restart a busy worker. Keep previous valid
SVG while pending/error; after 500ms pending, or on error, it dims with a status chip
(selection stays full strength), never for fast or paint-only results. Worker errors have a retry action. Export waits for a current valid
result. Browser PNG uses SVG → Canvas, 1/2/3 scale, white background, same size limits as Node;
browser/server font rasterization can differ. No diagram data sent to a server.

Pan/zoom is UI state, never document history. Wheel zoom anchors cursor, background drag
pans; keyboard arrows pan, +/- zoom, 0 fits. Selection syncs list and preview. Updates preserve
current scale and a surviving selected/center-nearest block at its screen location; read
viewport at result application, not request start. Initial/import fit is explicit. Overlay
selection and grid are not exported. Splitter supports pointer and keyboard changes.

## Accessibility and lifecycle

Connection selection is mutually exclusive with block selection. Preview has transparent,
12 CSS-pixel hit paths with non-scaling strokes; block hit rectangles are layered above them.
A connection click or Enter/Space draws a primary dashed path plus a subtle halo, activates
Connections and scrolls its row into view. Full
Preview mode retains its view; the selected row is revealed when settings becomes visible.
Editor row clicks and focus within any row control select that route without rebuilding the
row or interrupting input. Rows have accessible names, visible selection and aria-current.
Background clicks and Escape clear either selection with the existing dialog/menu priority;
dragging on a line or background pans and retains selection.

Endpoint pairs identify selected connections outside the JSON document. Commits follow the
selected draft object through endpoint changes and reordering; undo/redo remaps endpoint edits,
and deleting a selected edge clears it. Worker results attach editor-only endpoint keys and
labels to their own layout snapshot, so a stale hit cannot select an unrelated current index.
Selection overlays and hit targets are added only to the preview DOM. JSON, SVG and PNG
exports use the original document/render output without editor annotations or highlights.

English (en-US) UI, accessible icon labels, visible focus, polite shared live status, reduced motion,
real buttons, native labeled selects. Every drag has keyboard Alt+Up/Down and visible sort
menu alternatives. Dialog has accessible title, focus containment, Escape/cancel and focus
restoration. Ctrl/Cmd+Z and redo shortcuts apply outside editing controls. A beforeunload
handler is only active for unsaved state. All commits recheck model errors; invalid edits
never silently delete a connection. Narrow layout uses document scrolling, no horizontal loss.

## Layout and view controls

Desktop settings and preview share a horizontal row, initially 50/50. The vertical separator
supports pointer dragging and Left/Right keys (2 percentage points), Home (30%) and End (70%).
Its accessible value reports the settings share. Below 1001px, areas stack and the separator
is hidden. Blocks / Connections tabs share the settings space; inactive panels use hidden and
leave keyboard navigation. Tabs support Left/Right wrapping and Home/End, roving focus and
aria-selected. They persist separately from document history. Switching tabs never rebuilds
forms or triggers layout, preserving draft input, selected block and each list's scroll.
Selecting a block in the preview opens the Blocks tab without changing the view mode.
Split / Editor / Preview continue to support both tabs, editing, export and undo/redo.

The GUI, library and CLI share Auto/Grid layout for all visible Nets. Retired connection order/alignment and layout.orderMode fields are rejected on import and restore without migration.

The cycle-view button maps Split → Editor → Preview → Split. This is a locally persisted
UI preference outside document history. Hidden panels are removed from keyboard navigation;
editing and export continue. Preview queues the latest result while hidden and applies it
when measurable, preserving zoom and the viewing anchor. Resizing retains the viewport center.

Preview owns user-select: none, selectstart/dragstart prevention, pointerdown preventDefault
and pointer capture. Do not disable selection globally or convert SVG text to paths. Exported
SVG is unchanged. Legacy saved validation messages are replaced by English correction text;
user labels, identifiers and entered values are never translated.

## Transactional style dialogs

All former style disclosures are Style buttons. components/style-dialog.js owns the shared
fields, independent draft, validation and tabs; app.js resolves the target and commits once.
Opening, typing and changing tabs never change the document, history, local draft or preview.
OK validates all fields (including hidden tabs) through the library style parser, switches to
the invalid tab and focuses its field on failure. Success writes the selected component's
style in one undoable update, then re-layouts. Cancel/Escape discard the draft and restore focus
to that component's Style button; no-op OK adds no history. No nested style dialogs.

Block tabs expose border/fill, label text, shared port text and direction-specific port text.
Per-port dialogs expose color, background, font size, padding, text/background opacity, and
override only the selected Input/Output port. Blank fields remove an override to inherit;
individual styles still take precedence over Block direction/shared defaults. Connection
dialogs expose color, width, pattern and opacity. Dialogs remain English and usable at narrow
widths, with native labeled fields, proper tab keyboard behavior and visible OK/Cancel.

# Editable block keys

Block Key (ID) and Display name are separate inputs. Connection selectors identify endpoints by
key.port, with the display name added where useful. Keys use the library identifier syntax.
Renaming a key updates every incoming and outgoing connection in one undo step and preserves
custom display names, selection and preview anchor. New blocks omit label and display their key;
implicit names follow key changes, while explicitly entered or imported labels are preserved.
Invalid keys remain editable with inline errors.
Duplicate keys automatically receive the first available suffix starting at _2; an application
warning dialog reports the resolved key. OK or Escape dismisses the notice and returns focus to
the key input. The rename is already applied; Undo restores it and all endpoint references.

## Compact document tools and notifications

The desktop toolbar is one 49px row. File is the single owner of New document, Open JSON,
Save JSON and Load example (the empty preview can also offer its contextual starter).
Export owns SVG, PNG and the labeled native PNG scale select. Its "Whole diagram source"
section repeats Save JSON and Copy JSON to clipboard under the File menu's names. Copy JSON
(File, Export, command palette; no shortcut) copies exactly the Save JSON
text for the whole document in any view, confirms with block count and size, and falls back
to execCommand and then a dialog with the text selected when the clipboard is blocked. Undo/Redo, view cycling and
Layout settings remain directly accessible. There is no workspace caption or global footer.
The native details disclosures use components/ui.js bindDisclosureMenus, shared with reorder
controls. Only one opens at a time; outside clicks, focus leaving, scrolling outside and window
resizing dismiss it. Enter/Space toggles the summary; Tab traverses enabled controls. Escape
closes and restores summary focus, without clearing diagram selection. Native selects keep
Escape precedence. Command invocation closes its disclosure and focuses the summary before
opening a dialog, so dialog cancellation returns to a visible control.

Save state is a dot beside the diagram name with a full accessible name and title. Clicking it
reveals details in the shared notification. Dirty state means a local draft, not a file save.
The notification does not reserve document space or steal focus. Success/info expire after
four seconds unless keyboard focus is inside; errors persist until dismissal/replacement.
Dismissal returns focus to its previous visible owner. Routine selection produces no toast.
Storage failure overrides routine success notifications and remains on the labeled indicator
after manual dismissal. Field errors and the preview error banner remain persistent in place.

## Connection feedback preference

components/ui.js feedbackControl owns the native Feedback checkbox in rows and
the Add connection dialog, using the existing check-label typography and checkbox tokens.
False/omitted maps to ELK direction priority 10; true maps to 0. This preference does not
create layout batches, remove an edge from layout, force backward routing or enable outer
routing. Its accessible description explains that block positions may still change.
A row toggle commits one history step, persists and schedules the existing debounced layout;
focus remains on its checkbox and preview navigation uses the existing camera rules.
Unchecking removes the optional raw field. Creation defaults unchecked and omits the field;
checking writes feedback:true only on confirmation. Cancel/Escape discard the dialog draft.
Imported explicit false stays intact until edited. Raw JSON download preserves flags, and
SVG/PNG use the resulting geometry without editor controls. Numeric priorities are internal.

## Offline browser runtime

The offline build uses the same editors, tokens and controls. Deliver the entire dist-offline
folder: its index.html links studio/, story/ and wave/, each holding index.html, app.js and style.css.
Users open any of these index.html files directly, without a server or network connection; the
two pages find each other as sibling folders. Neither page embeds a current-document snapshot.
The normal default example and Open JSON are the entry workflow. Brand navigation explicitly
uses ./index.html, including when opened from a local folder.

LayoutService owns revision, debounce, cancellation and retry in both builds. Its worker
factory is replaced only at offline build time with the inline Blob-worker implementation.
No main-thread layout fallback or network-dependent worker loading. Worker errors use the
existing preview error/retry state. JSON and image downloads keep the same validation rules.
File-origin local storage is best effort; existing persistent storage warnings and JSON
save remain usable. A moved/renamed folder or different browser need not restore the draft.

The offline browser suite uses file:// with networking disabled and no webServer. Accessibility
scans disable axe stylesheet preloading because its XMLHttpRequest fallback cannot read local
CSS; the browser still loads the stylesheet normally and the WCAG rules remain enabled.

## Single-level group workflow

components/block-list.js owns the grouped list renderer, commands.js owns membership/identity,
and app.js owns selection and the existing transaction/dialog adapters. This is a nested list
with native disclosure buttons and labeled member regions, not an ARIA tree requiring a new
keyboard model. Existing shared sort/menu buttons and native labeled selects remain canonical.

Add group creates an empty group; Create group with this block also moves the target block.
Move to group... uses an owned dialog and native Group select with No group (root); cancel
changes nothing. Dragging a block onto a group adds it, onto root removes membership, and
onto a block inserts within that block's parent. Top-third drops insert before; others after.
A 500ms hover opens a collapsed group. Show container highlights and insertion indicators.
Root and group deletion/sorting must address stable block IDs, never sibling-index module IDs.

Group headers select group name/style details; preview headers mirror selection and outline.
Preview block selection expands its parent and reveals the row. Collapse leaves the diagram
visible. Group style reuses style-dialog.js with Group/Label tabs and transactional OK/Cancel.
Ungroup preserves blocks and connections and focuses the list; block rename/delete updates
members. Membership and document styles participate in normal single-step history and local
recovery. Deleting a group discards only its unfinished name draft. Duplicate names are allowed;
IDs are unique across groups/blocks and groups cannot themselves be members.

The inner list separator stores preferred 200..340px width (default 260px); CSS reduces it when
space is limited. Collapse and width preferences are separate from document history and do
not schedule layout. Root blocks need no synthetic Ungrouped container. Mobile stacks panels.
The worker uses compound once layout, just like the library/CLI. Empty groups preview even without blocks.

## Nested hierarchy extension

This supersedes the single-level membership restriction above. Groups can contain groups
or blocks; each item has a single parent and cycles are rejected. lib/hierarchy.js owns shared
parent, ancestor, descendant and path helpers. Core validation checks all references before
cycle detection, and mutation guards reject invalid moves before changing membership.
Ungroup promotes direct contents to the removed group's original parent and keeps endpoints.

Recursive block-list.js disclosures retain native buttons/regions, not ARIA tree semantics.
Group grips and menus provide subtree moves; native parent selects omit self/descendants and
show complete paths plus IDs. Add group uses the selected group as parent; Add subgroup is
explicit in the group menu. Block wrapping creates its new container in the block's parent.
Search matches IDs/labels, shows ancestors and matching group subtrees, and displays an owned
no-results message. Search disables individual collapse toggles while paths are forced open;
Collapse all clears the filter. Neither filter/disclosure nor width changes touch history or
layout. Preview/result selection expands all ancestors and clears the filter. Details path
buttons navigate to ancestors without rewriting data. Search never hides a form draft.

Split/Editor/Preview remain available. Preferred list widths are separately remembered for
split (260px) and full Editor (360px), with 200..560px keyboard/pointer adjustment and responsive
stacking. Group preview headers, shared style dialogs, undo/recovery and offline exports keep
the same owners. Hierarchy is exported as flat group definitions with stable member IDs.

## Multiline display text and port identity

Port controls expose Key (ID) and Display name. Raw port.label is optional and supports LF
line breaks, as do module/group/connection labels. IDs and diagram.name stay single-line.
Block and port blank display inputs remove label and restore ID fallback. Explicit display
names survive key changes. Port key edits update all references in one transaction; duplicates
within either direction of the same block receive the first available _2, _3 suffix and use
the shared key-adjustment alert dialog with focus restoration.

Shared ui.js textareas own Enter-newline, blur-commit and auto-growth (52–240px, then scroll);
IME, caret, draft errors, history and preview camera retain existing owners. Port display
fields occupy a full row below Key/Width. Width suffixes attach to the last display line.
Label geometry reserves each blank line at 1.5 times font size; SVG tspans use explicit
line centers and existing horizontal anchors. Single-line rendering remains unchanged.

## Relative block minimum dimensions

Port adjustment uses the shared portAdjustmentFields native select/number adapter in
layout-panel.js, reused by Layout settings. These are global immediate settings, independent
of the Grid Apply/Reset draft. Default Reduce bends uses maximum shift 40. Explicit Fixed preserves fixed-port output.
Reduce bends keeps hardware placement/dimensions and Port identity/order intact; names
follow anchors. Terminal anchors and names move together perpendicular to flow within the
same shift limit, preserving order and separation and avoiding Blocks, Groups and other
Terminals. Feedback anchors remain fixed. Zero shift is valid, invalid limits preserve the document and expose the
existing field error. Settings are persisted and undoable, including offline. The page owns
recoverable numeric drafts/focus; the existing settings modal retains its immediate-edit
contract. Do not add drag handles or export UI overlays for this automatic pass.

Block Width/Height are positive finite relative minima, with step 0.1 and blank = Auto.
They are document geometry fields, separate from port bit width and style. Native number
inputs reuse the canonical field validation/draft/focus adapter; invalid edits preserve raw
document geometry and disable export until corrected or undone. Enter/blur commits one
history step. Key changes remap dimension drafts, and block deletion discards them.
The Block/Group Style first tab also exposes Size using the same native field adapter.
Blank is Auto, 1 is the shared base unit; dimensions remain top-level geometry properties.
Style sessions snapshot dimensions alongside appearance and styles. OK applies all changes
in one history step; Cancel/Escape discards every draft. Invalid dimensions reveal the
first tab and focus the offending field without changing the document or preview.
Content sizing remains the lower bound. Shared base units are fixed, not derived from each
block's contents or styles. Increased height adds equal space above/between/below port rows;
paired input/output rows stay paired with Fixed Port adjustment. Reduce bends may slide
opposite sides independently. Title position, text size, border width and padding stay consistent.
Layout precedes rendering; once, grouping, feedback, SVG/PNG and offline use the
same geometry. Straight connections remain a layout preference, not a sizing guarantee.

## Standalone DOM view

src/lib/export/dom.js owns the reusable view; src/lib/view owns event and layout validation.
It exposes focusable SVG target groups with native-equivalent Enter/Space activation,
exclusive selection and Escape clearing. Background/target drags use the existing four-pixel
threshold and never activate after a pan or cancellation. Port labels/anchors and connection
labels share their corresponding target. Group hits occupy titles. Scope select prevention
to the SVG; preserve surrounding form behavior. Wheel/keyboard navigation remain available.

Events are synchronous read-only snapshots with originalEvent for interaction. on/once
return unsubscribe handles, off removes listeners, errors are reported without suppressing
other handlers. Connection endpoint keys preserve identity across layout-array reorder.
setLayout validates before replacement, restores focus/camera for surviving selection and
prunes removed targets. Runtime status/value overlays do not mutate JSON, rerun layout or
appear in static exports. destroy releases observation/listeners/state and removes only
the owned SVG; multiple views and host content remain independent.

The example uses canonical ui.js buttons and existing token/button CSS, one live status
and a bounded event log. It is a viewer demonstration, without forms, simulation or server
operations. Offline and narrow accessibility evidence lives in e2e/dom.spec.js.

## Group boundary port editing

Container is the default. Group type Boundary enables explicit input/output keys and strict
per-layer crossings. Group port forms support labels, optional widths, styles, drag and
keyboard ordering, rename reference updates, deletion with dependent connections and
undo/redo. Switching modes is atomic: reject with affected connections when existing
edges become invalid; keep definitions inactive when switching to Container or Collection. Ungrouping
referenced group ports and membership moves invalidating boundaries are blocked.
Connection choices validate inside/outside roles, drivers and explicit widths together.
The same document renders through SVG, PNG, offline and the standalone DOM view.
DOM port descriptors use ownerId/ownerType and groupId or blockId; group ports support
portclick, selection, focus and runtime values through the existing port API.

## Hidden group contents

Group collapsed is a persisted boolean, default false, valid as true in Boundary or Collection.
Hide contents creates one undo step, preserves all descendants/connections and reruns layout.
Layout validates the complete input before constructing its visible graph. Hidden nodes,
internal edges/labels and their sizing/styles do not affect layout. Collapsed parents hide
their subtree without rewriting nested settings. List disclosure/search/editing is separate.
Collapsed bodies select the group and expose groupclick in DOM; portclick keeps group owner
identity. Removed hidden hit targets, selected targets and transient DOM states are pruned by
setLayout; visible group/port state survives. Expanding restores source data, not transient
state of formerly hidden targets. All exporters and offline builds share this projection.

## Block conversion and group size

Convert to boundary group is one history update, preserving ID, label fallback, raw port
definitions, endpoint strings, connection metadata, parent membership/order and size minima.
Create an empty boundary group with hidden contents. Capture resolved block border/fill/title
styles so group defaults cannot change its appearance; retain shared port-label overrides.
Validate the candidate before committing and preserve the document and unfinished drafts on
failure. Undo/Redo transfers editor selection between block/group for the same key.
Group Width/Height fields share block input validation, Auto omission and units; expanded
group size is at least the requested minimum and the space required by its children/labels.
All visible connections use once layout. DOM bodies now
emit groupclick; existing port keys persist with ownerType group and groupId payloads.

## Collection group type

One group tree contains Container, Boundary and Collection. Group type uses the shared
native select. Container auto-expands and hides Hide contents. Boundary exposes real
port forms; Collection exposes Hide contents without real port forms. Preserve inactive
definitions. Changes validate atomically, list affected connections in the owned modal
on failure and return focus to Group type. Undo restores type and visibility together.
List disclosure is independent. Collapse retains all original data for JSON downloads.

Collection draws a direct-member count, up to two backing cards and virtual Input/Output.
Validate real data first. Keep original external edge identities/selection through both
states; internal links disappear visually. Keep edges separately even if paths overlap.
SVG/PNG, offline and DOM share the result. Synthetic anchor activation selects/emits
for the group, not a port. Hidden real targets and transient states follow normal pruning.

## Preview style and visibility editing

External terminals are root objects with global IDs, input/output direction, optional
multiline label, bit width and portable text style. Raw endpoint objects use only `terminal`;
ordinary Block.port strings remain valid. Inputs source inward, outputs receive outward;
reject terminal-to-terminal links, multiple output drivers, mismatched explicit widths,
duplicate links and boundary bypass. Terminal membership in groups is invalid.

Connections owns Add terminal; Add connection can open New external input/output and must
restore its selected endpoints, label and feedback draft on Save or Cancel/Escape. Saving
the terminal is its own undoable document edit; cancelling connection creation keeps an
explicitly saved terminal. The shared terminal dialog validates ID/direction/width before
committing, preserves invalid input and reports a focused inline error. Referenced key
renames update all endpoint objects atomically; unsafe direction/width edits change nothing.

Preview terminal targets use normal selection, double-click Style and the shared context
actions: Edit label, Edit style, Edit terminal and Delete terminal. Delete removes dependent
connections in one Undo step. Hidden/invalid/stale targets cannot be edited. Restore focus
after modal close and asynchronous layout without resetting mode/zoom. No block frame is
drawn; helper nodes exist only inside layout. Group views omit root terminals; Collection
projection preserves original terminal endpoints. Exports and offline mode share geometry.

Same-side Terminal anchors align by default: a common X for each input/output side in
horizontal flow, or a common Y for each side in Down flow. Terminal text and associated
virtual signal labels move together. Their complete envelopes stay outside the internal
Block/Group layout; overlapping same-side envelopes are separated along the side before
affected connections are rerouted. Reduce bends then moves Terminals only along that side,
preserving alignment. No authoring setting or coordinates are required.

The shared action definitions in components/preview-actions.js own the Preview toolbar
disclosure and right-click/Shift+F10 context menu. Select the clicked target before opening.
All block/group/edge targets offer Edit style… and Edit label…; show group-only operations
only where applicable. Keep double-click opening Style.

Edit label opens the existing modal shell with the raw optional label, a key/endpoint
identity, a multiline Label textarea and Save/Cancel. An omitted block/group label uses
its ID as the placeholder, preserving omission on an unchanged save. Enter inserts a line
break; Ctrl/Cmd+Enter saves outside IME composition. Cancel/Escape discard all edits.
Save validates with normalizeDisplayText and the model, creates one Undo step and reruns
layout. Empty/whitespace-only text deletes label: blocks/groups fall back to ID and edges
show no text. IDs, endpoints and unrelated data remain unchanged. Invalid input stays
in the focused field with inline accessible error feedback; no document/history mutation.
Restore preview target focus and preserve view, zoom and logical camera anchoring.
Pending, stale, failed and invalid-field previews disable both edit actions with an explanation.

User-approved direct editing: single click selects; double click on a block, group title,
collapsed group, edge segment or label opens the shared Style modal. Native double-click
must correspond to two valid clicks on the same stable target; drags, canceled gestures,
intervening controls and blank double clicks do not open Style. Preview Style button and
actions disclosure provide keyboard/touch alternatives. Preserve Split/Editor/Preview mode.
Pending, stale, failed or invalid-field previews disable these mutation controls.

Style OK creates one history step, validates through the existing adapter and reruns layout;
Cancel/Escape discard the draft. Restore focus to the original visible hit or the canvas,
including after asynchronous replacement; do not steal focus from a subsequent form edit.
Keep zoom and existing logical camera anchoring without an automatic fit.

Boundary/Collection title arrows toggle document collapsed as one persisted undoable edit;
Container has no arrow. The block-list disclosure preference remains separate. Raw children,
ports, connections and nested visibility flags are retained. Arrow clicks/double clicks never
pan or open Style. Arrow labels expose Hide/Show contents and aria-expanded. Right-click or
Shift+F10 on visible targets opens the canonical actions disclosure, clamped to the viewport;
Style and label editing are shared and Hide/Show contents appears only for eligible groups. Outside click,
Escape, focus exit, scroll and resize follow existing disclosure dismissal. Exported graph
contains no editor arrows, menus, selection or buttons.

## Top and group view

View target is a native select in Preview. All groups are selectable regardless of ancestor
collapse. The first option is Top; group options show display name or ID when unnamed.
Only duplicate displayed names (including Top) append [ID]. Compare names after multiline
flattening, keep document order, and retain the full selected path/IDs in the selector title
and the existing breadcrumb navigation. Group-list actions and preview context actions share View contents. Top/ancestor
breadcrumbs navigate without document mutation, Undo steps or a workspace-mode change.
Target removal/ungrouping falls back to Top; undoing deletion does not change the view again.
Changing documents resets Top and clears cameras. Root selection/cameras are session-only.
The editor continues to edit the complete graph and preserve invalid field drafts.

Validate the full graph before scope projection and layout. Draw the selected group's frame,
label and real ports, expand that root only, honor descendants' collapsed settings, and omit
ancestors/siblings/external edges. Scope identity distinguishes inside pass-through from
outside same-group feedback. Container/Collection do not fabricate ports. Keep scope edges
inside the frame with ELK even when global outer feedback routing is selected. Original edge
keys, port ownership, Style drafts and JSON connection metadata remain unchanged.

Hide the view root's preview collapse arrow/action. Descendant toggles remain real undoable
collapsed edits, separate from navigation and list disclosure. Keep Top and each group's
zoom/pan independently; fit only first entry or explicit Fit. Resize and edits preserve the
logical view center/anchor. Worker revisions include the requested scope so rapid switching
cannot display/export a prior view. Pending/failed views disable image export and actions.
SVG/PNG reflect the accepted current view; JSON always contains the full project. Offline
uses the same scope, gesture, validation, navigation and export implementations.

## Connection label positions and long traces

Source: the user's approved Net labels and virtual receiver-node discussion.
Connection Style > Label uses the native select/field adapter for Destination labels
(Long branches, Always, Never) and Long branch threshold. Blank inherits; defaults are Auto
and 600. Cancel/Escape discard; OK commits in one Undo operation. Saved JSON accepts
`repeatAtEnd` and `longThreshold`; retired `placement` and `position` fields are rejected.
Other text styles reject these connection-only fields. Hidden removes all instances.

Names follow source-to-target identity independently of arrows. One shared source label
selects its Net; every branch and receiving name remains selectable. Collapsed Collection
branches sharing a visible receiving Port also share one receiving footprint, while retaining
semantic endpoint IDs. Names use reserved Inline nodes and mask only their own wire.
Layouts retain honest conflict warnings. Geometry, exported bounds, SVG/PNG, Preview and
DOM hit areas include both instances; DOM mask IDs are scoped per view.
`labelPosition`/`labelBounds` remain aliases for the first instance.

## Net and Concat connection creation

Source: the user's approved one-source/N-peer Net and virtual label-node discussion.
Reuse ui.js native select/checkbox/field/button primitives and the existing transactional dialog,
history, validation, notices and Preview owners. Add connection chooses Net or Concat. Net has
one main endpoint, target add/remove and a Bidirectional checkbox; all endpoints must be inout
when checked. Concat accepts multiple sources and creates its element plus input/output Nets
atomically, in the common scope when available. Errors stay inline with drafts preserved.
Connection rows edit Net ID/common text, targets, direction, shared Style and target placement
influence. Removing a receiver prunes only that branch; the last receiver cannot be removed
from the row. Deleting an actual endpoint prunes affected branches and removes an empty Net.
All connections are Nets. Old files are rejected without conversion.

Canonical ownership: components/net-controls.js owns shared Net row/dialog markup using ui.js;
state/commands.js owns rename/prune/conversion; lib/nets.js owns target traversal and identities.
No separate dialog, menu, notification, token palette or persistence system is introduced.

Net label geometry is text-sized, with an 8-unit gap in a routing-only source wrapper before
outer Auto/Grid placement. Synthetic structures never appear in JSON, hardware hits or public
membership. A source name is common to all branches. Destination labels are reserved Inline nodes controlled
by Style/Label Destination labels (Auto/Always/Never) and Long branch threshold (positive, 600).
Always reserves receiving nodes before the first layout. Never omits them. Auto selects
branches exceeding the first-pass routed threshold and freezes that selection for a second
layout, with no further iteration. Receiver names follow Port sides/order beside hardware,
including Concat and Terminal targets; they may enlarge multi-Port targets and affect placement.
The short tail and arrow end at the physical Port. Hidden removes every virtual footprint
and label. No new authoring fields or controls are introduced.
A source label selects the whole Net; a branch selects that Net and reveals its target row.
Branch routing identities remain available to DOM hosts via netId/branchIndex. Layout warnings
remain honest when full clearance is impossible. Narrow viewport, native popup, Cancel, atomic
Undo, offline and SVG/PNG parity use the same existing application contracts.

## Net label frames

Connection style > Label reuses the shared color/number controls for border color, width,
opacity and corner radius. Blank inherits; zero width/opacity disables the frame. Negative
width/radius and out-of-range opacity retain drafts and use existing inline validation and
focus recovery. OK commits with other Net label fields in one Undo step; Cancel discards.
Frames are shared-source/receiver label presentation, never branch line styles. In SVG,
PNG, Preview, DOM and Agent Kit output their ink stays inside the same label/hit bounds.
Hidden labels suppress fill, border and text together. Default transparent border preserves
existing unframed diagrams. No new screen, menu, palette preset or interaction overlay.

## Diagram style defaults

Source: the user's approved Defaults page and property-wise inheritance discussion.
Defaults is document-scoped data in diagram.style: shared text plus module, group,
connection, terminal and caption. Native category selection and shared Style sections own
all controls. style-dialog.js owns field definitions/rendering/hints; styles.js owns ordered
resolution and provenance; state/defaults.js owns raw draft parsing and validation;
components/defaults-panel.js owns the transactional page; app.js owns navigation/history.
Apply validates all categories, reveals/focuses the first invalid field and commits one Undo
step. Discard changes only the draft. Draft inputs and category/section survive navigation
and local reload. Global style history changes synchronize the draft base before persistence;
Undo first discards an unapplied Defaults draft, then traverses history. Replacement uses the
existing unsaved-document guard. Save JSON and exports are disabled until Apply/Discard.
Preview uses committed data; draft controls never trigger layout. IME never applies a partial
composition. Successful Apply/Discard focuses category selection. Keyboard tabs, native
popup operation, narrow scroll ownership, offline and accessibility use existing contracts.
Per-object Style fields show inherited values and sources, keeping blank values and field
validation help correctly associated. Clear removes an override, never writes a fallback.
Default visibility/arrows move out of Layout settings into Defaults, with one navigation
shortcut in Layout settings. Edit defaults reveals the workspace in Split mode when invoked
from Preview-only mode and focuses the Defaults tab. The document schema and agent kit
share the same hierarchy.

## Story editor

Presentations are authored in the separate Story editor page (story.html), never inside the
Studio. The Studio offers Export › Open in Story editor for the whole Block diagram and hands
story files and exported presentations over instead of opening them as diagrams. The Story
editor reads a Block diagram and never edits it. It writes a story JSON naming its diagram and
exports one offline HTML file carrying the player, the drawn SVG and both sources; opening that
file in the Story editor restores both for editing. Undo/Redo apply to the story. The stage,
the exported page and Preview run one shared player, so authoring shows what the audience
sees. Stories refer to wires by endpoints and keep references the diagram lacks, marked and
skipped when playing. The player selects wires, arrows and blocks only through the rendered
SVG identity metadata and draws over the unchanged runtime SVG, including every owner of a
shared path. A chapter can embed one waveform, shown as a strip under the diagram;
each step focuses a window and some of its signals, links and markers, dimming the rest, and
signals tied to Block ports light those wires. Waveforms are edited in the Waveform editor and
sent back to the Story editor as one undoable change. Old timing-strip data is not drawn.

## Waveform editor

The Waveform editor page (wave.html) draws synchronous timing diagrams and never edits
diagrams. Every change goes through the runtime's waveform operations or its parser, so the
page holds no validation of its own. Problems such as delay mismatches stay visible instead
of blocking edits; refused edits leave the document unchanged and say why. The canvas shows
the runtime SVG unchanged; selection lives on an overlay. Transitions drag with snapping to
ticks or bits and locked links follow. Links are made from one transition to the one it
causes. VCD import lets the user choose signals, a window and a timescale, and reports
errors in its dialog. Exports are the runtime SVG, PNG and the normalized JSON.
