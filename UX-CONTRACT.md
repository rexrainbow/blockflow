# Diagram Studio behavior contract

Connection labels are optional multiline document text. Blank editor input removes the
property; JSON requires non-blank text when present. Changes commit on blur (Enter inserts a newline) with the
existing IME, invalid draft, history and camera behavior. Add connection accepts the same
optional Label. Connection Style reuses the shared modal with Line/Label tabs and transactional
OK/Cancel, validation and focus restoration. Label clicks select the owning connection.
The library measures/reserves label space, then checks final routes after feedback routing.
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
File > Open JSON: size limit, JSON parsing, legacy migration, model validation and dirty
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
dialog expose endpoints, labels, feedback and Style; new connections contain from/to, plus feedback:true only when selected; styles remain optional.

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
SVG while pending/error. Worker errors have a retry action. Export waits for a current valid
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

The GUI, library and CLI share once layout for all visible edges. Old editor JSON/drafts
are upgraded by removing retired connection order/alignment and layout.orderMode fields.
Current schema/core input rejects these fields. Other settings and graph content are retained.

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
Export owns SVG, PNG and the labeled native PNG scale select. Undo/Redo, view cycling and
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

The offline build uses the same editor, tokens and controls. Deliver the entire dist-offline
folder (index.html, app.js, style.css); users open index.html directly, without a server or
network connection. There is no new export-menu action or embedded current-document snapshot.
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

Block Width/Height are positive finite relative minima, with step 0.1 and blank = Auto.
They are document geometry fields, separate from port bit width and style. Native number
inputs reuse the canonical field validation/draft/focus adapter; invalid edits preserve raw
document geometry and disable export until corrected or undone. Enter/blur commits one
history step. Key changes remap dimension drafts, and block deletion discards them.
Content sizing remains the lower bound. Shared base units are fixed, not derived from each
block's contents or styles. Increased height adds equal space above/between/below port rows;
paired input/output rows, title position, text size, border width and padding stay consistent.
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
