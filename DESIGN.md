---
version: alpha
name: blockflow Diagram Studio
description: A quiet engineering workbench for editing hardware blocks and connections.
colors:
  primary: '#2457d6'
  background: '#eef2f7'
  surface: '#ffffff'
  ink: '#18243b'
  muted: '#59677d'
  border: '#d7dfe9'
  input: '#126280'
  output: '#26704a'
  danger: '#b42b3d'
  amber: '#946016'
typography:
  sans:
    fontFamily: 'Segoe UI, Microsoft JhengHei, sans-serif'
  mono:
    fontFamily: 'Cascadia Code, Consolas, monospace'
  display:
    fontFamily: 'Bahnschrift, Segoe UI, sans-serif'
rounded:
  DEFAULT: '6px'
  sm: '4px'
spacing:
  unit: '4px'
  panel-gap: '12px'
components:
  button: {}
  field: {}
  panel: {}
  dialog: {}
  status: {}
---

# blockflow Diagram Studio

Connection text uses an optional Label field in each connection row and the creation dialog.
Reuse the shared field adapter and Style modal; connection styles have Line and Label tabs.
Keep diagram text horizontal, Inline on its route by default, with the portable text styles.
Labels in the preview select their owning connection; export contains no interaction overlays.
Unresolved label clearance uses the existing preview message surface without blocking export.

Connection style > Label owns Net frame color, width, opacity and corner radius through
the existing Style grid. Fill and frame are independent of line color. Diagram palette
choices remain authored JSON rather than changes to editor chrome or global defaults.

## Overview

Terminal adjustment reuses Reduce bends and Maximum shift; anchors and names move together
perpendicular to flow without adding controls or drag handles.
Layout exposes Port adjustment (Fixed / Reduce bends) and Maximum shift using existing
native controls and field helpers. Reuse the same adapter in Layout settings. Keep these
global immediate controls visually separated from the scoped Grid draft, and explain that
Block placement and size stay fixed. Computed Port motion has no new diagram decoration.

Block and Group Style include a Size section in their first tab, beside appearance controls
for Blocks. Reuse native number fields, the Style grid and the transactional modal. Explain
Auto and relative minima; keep geometry stored on the object rather than in its style.

JSON file drops use the existing Open JSON workflow and notification/replacement dialog
surfaces. Accept one file across the editor with a copy cursor, without adding a second
import flow or changing internal drag/reorder visuals. Keep active dialog drafts intact.

The audience is engineers building RTL block diagrams; the single job is to turn blocks and
port connections into a useful, exportable diagram without writing JSON. This is a product
tool, not a landing page. The user specified desktop-oriented settings beside a zoomable SVG.
The application UI is English (en-US), including accessible names, validation and statuses.
User-authored labels retain their original language. No Japan-market assumptions.

## Creative direction

Use the physical language of a schematic workbench: white surfaces, cool drafting-paper
background, cobalt signal traces, aligned technical identifiers. The signature is a live
selection relationship between a block in the list and its outline in the diagram. Avoid
hero sections, decorative cards, large marketing type and unrelated status metrics.

Selection can be cleared through blank-list/blank-preview clicks or Escape. The unselected
state has no list highlight or dashed SVG outline; block details shows its empty invitation.
Keep keyboard focus visible on the list/preview container, and preserve navigation and drafts.

Connections share the same mutually exclusive selection model. Use a cobalt dashed trace
along the routed segments with a subtle halo, avoiding a large bounding rectangle around
feedback loops. Selected connection rows use the existing primary border and inset selection
stripe. Preview hit paths are visually transparent and wider than the drawn lines; keyboard
focus remains visible. Selecting a route reveals its connection row without changing zoom.

## Tokens and runtime mapping

This document defines intent. Exact colors above map one-to-one to --primary, --background,
--surface, --ink, --muted, --border, --input, --output, --danger and --amber in
src/editor/styles/tokens.css. That single stylesheet owns runtime tokens; components use
variables rather than copying palette values. Verification: scripts/check-design.js.

## Typography

Body and controls use sans at 13px, comfortable 1.5 line height; section headings 14px/600.
Brand uses the display stack at 22px. Identifiers and order values use mono at 12px.
System fallbacks avoid external font requests or layout shifts. Diagram font remains the
library's monospace; editor typography never changes an exported diagram.

## Layout

Desktop uses one 49px toolbar, then settings on the left and preview on the right, initially
equal widths. Small blockflow branding, editable diagram name and a labeled save-state dot share
the toolbar with Undo/Redo, File, Export, icon-only view switching and Layout settings.
File owns New/Open/Save/Load example; Export owns SVG/PNG and PNG scale. Native details
popovers share dismissal/positioning with reorder disclosures; they are not ARIA menus.
No workspace caption or bottom application status bar. Workbench height is viewport minus
69px on desktop, reclaiming 121px from the previous layout. At 700px and below, the toolbar
uses two compact rows. Preview's existing header/footer remain within its own panel.
Notifications float above the workbench: success/info hide after four seconds, errors stay
until dismissed or replaced. Routine selection does not produce notifications. Storage
failures remain discoverable from the red, labeled save-state dot after dismissal.
The settings area has Blocks / Connections tabs. Blocks contains a narrow block list beside
the selected block's details; Connections occupies the whole settings area. Both use the full
available height, bounded scrolling, persistent headers and reachable add actions. Connections
uses one flat list in a continuous scroll region, without Main/Others groups or disclosures.
A fixed panel footer provides the single Add connection action. Block list rows show the name
and key without port counts. Block
key/width instructions live in the header's [?] help dialog, keeping the detail form compact. A vertical
separator adjusts settings width between 30% and 70%. Preview owns its pan/zoom and never
scrolls the document on wheel. At 1000px and below, settings and preview stack in document
flow; tabs remain available and block list/details stack. The persistent Split / Editor /
Preview cycle button expands either area without changing document state, tab or zoom.
Hidden previews defer drawing until visible. Selected tabs use the existing cobalt accent
on drafting-paper gray; typography, colors and exported diagram styles retain their owners.
Never disable keyboard zoom for narrow users. The GUI, library and CLI use once layout.
Import and restore validate the current schema directly. Retired fields are rejected without migration.

## Shapes and elevation

Six-pixel control corners, four-pixel utility buttons, 1px boundaries. Panels are flat;
only popovers/dialogs may have a subtle shadow. Blue marks current selection and primary
actions; danger has a label/icon as well as red. Input/output use text labels plus their
different colors. Light theme only; forced-colors remains operable.

## Components and states

Shared field/select/button/disclosure primitives live in src/editor/components/ui.js.
App.js owns the single notification and save-state indicator.
Native select popups intentionally belong to the operating system, including width and
placement. Icon-only actions have accessible names and title tooltips; sorting also has
keyboard and explicit up/down menu alternatives. Focus uses a visible 2px primary ring.
Disabled controls retain size; busy export labels retain a fixed minimum width. Validation
is inline; stale preview is identified and never exported. No skeletons.

Style editing uses a component-owned Style button and a modal dialog, never an inline
expansion inside a narrow list. The canonical renderer/draft adapter is
src/editor/components/style-dialog.js. Block style has keyboard-accessible tabs for Block,
Label, All ports, Input labels and Output labels. Each individual Input/Output port has a
Style button for its text alone; each connection has its own Style dialog. Use two generous
field columns, an explicit target label, inheritance guidance and always reachable OK/Cancel.
Cancel/Escape discard the dialog draft; OK applies all fields in a single document operation.

## Motion and iconography

Use local 18px stroke SVG icons, consistent 1.7px stroke, never icon fonts. Motion is limited
to 100ms hover feedback and the pending indicator; reduced motion disables animation.
No animation of changing diagram geometry, avoiding extra visual movement during editing.
SVG preview text is non-selectable during navigation; form text and exported SVG text remain
selectable. Pointer capture and default-action prevention belong to Preview, not the page.

## Scope

One desktop workbench with responsive stacking, no server/accounts/cloud persistence.
Behavior contracts and canonical UI owners are in UX-CONTRACT.md. Screenshots and E2E
evidence are generated under output/editor/ and test-results/.

## Dark theme discussion (not implemented)

The preferred first step is dark application chrome with a white diagram artboard. UI tokens,
focus, selection, input/output, danger and amber need contrast-checked dark counterparts;
native controls would use color-scheme: dark. Add an explicit on-primary token rather than
assuming white text on a light blue accent. Document graph styles and image exports remain
independent of UI appearance. A dark graph itself would require its own background and style
defaults; do not invert the SVG with a CSS filter or silently rewrite user colors.

# Block identity controls

Expose Key (ID) beside Display name, and show the key in the block list so similarly named blocks
remain distinguishable. A duplicate key is resolved automatically and explained in an owned
warning dialog using the existing dialog typography, actions and focus behavior.

## Feedback control

Reuse the native checkbox and check-label variant for Feedback in connection rows
and creation. The shared feedbackControl primitive owns the label and explanation. Keep it
beside reorder actions in the row's wrapping utility strip, without introducing a new panel
or expanding style dialogs. Dialog help explains the preference, not a guarantee of positions.
Use existing ink/primary tokens and focus treatment; no new visual palette or layout system.

## Offline distribution

The file:// build reuses the complete visual system and interaction contract. Keep CSS as
style.css and embed no external fonts or assets. Native file pickers/downloads and the same
error, save-state, dialog, focus and camera behavior apply. No new navigation, badge or visual
variant is needed merely because the editor runs offline. Distribution details belong in
README.md and the build configuration, not in the editing workspace.

## Single-level group list

Retain the engineering workbench palette and shared controls. The block list is a nested list
with compact disclosure headers, indented members, a subtle token-based boundary and count.
Native labeled disclosure/select/button interactions own grouping; right-click is a shortcut
to the same visible Block actions menu. Do not introduce a second menu/dialog system.

Use a 260px preferred list track and a 9px inner separator, bounded by available editor width;
keep the existing outer splitter and responsive stack. Add block/Add group share the fixed
list footer. Group details expose name, count, shared Style dialog and Ungroup (keep blocks).
Drag destinations distinguish container membership from sibling insertion and root removal.
Group collapse/width changes stay visually stable and do not trigger preview layout.

Preview group fills/borders are behind routes/blocks, with measured titles and clear padding.
Group and block selection remain exclusive. Group title hits are separate from block hits;
exported SVG/PNG contain the actual group shapes but no editor hit rectangles or selection.

## Multi-level editing

Retain Split, Editor and Preview. The recursive list uses compact indentation and shared
headers, grip/menu/disclosure controls. A search field and Collapse all/Expand all belong in
the list header; matching paths expand transiently. Do not replace the list with a new tree
widget or duplicate menus/dialogs. The details breadcrumb wraps and uses existing quiet
buttons for ancestors. Full Editor starts with a 360px list, split with 260px; independent
preferences avoid losing editing space when returning to full Editor. Deep navigation remains
possible with search, native move dialogs and the existing adjustable separator. Group fills
paint ancestor-first; preview styling and export geometry retain their existing owners.

## Multiline display text

Reuse shared ui.js textareas for block, group, port and connection display labels. Use the
existing field borders, typography, surface and focus tokens; textareas grow from two rows
to a 240px bound with native scrolling and no manual resize. Port Key (ID)/Width share the
first row; Display name spans the next. Lists and breadcrumbs summarize lines compactly,
while diagram text keeps explicit line breaks and the original anchor alignment. Duplicate
port keys use the existing key-adjustment alert dialog, not a new feedback system.

## Relative block size

Block details places Width and Height in one shared two-column field row below identity.
Reuse native number inputs, field errors, history and existing tokens; blank fields show Auto.
Keep relative-size guidance in the existing help dialog, alongside the separate port bit-width
explanation. The document changes block geometry, not UI typography or graph text styles.

## Reusable DOM view and example

The standalone SVG view is owned by src/lib/export/dom.js, with input/event helpers in
src/lib/view. It shares static geometry/rendering with SVG exports and owns scoped hit,
selection, state and focus overlays. It does not import editor CSS. Default accent/status
colors follow this document's primary/amber/output/danger/muted palette; consumers can set
--portsketch-accent and --portsketch-background on the host. Graph styles remain document data.

The runnable examples/dom-viewer surface reuses editor tokens, shared button markup and
button CSS. It uses one diagram viewport and one bounded event log, with native labeled
controls and a single live status. Narrow screens stack these panels. There are no new
dialogs, CRUD flows, data-entry widgets, network requests or simulation behavior.

## Group boundary ports

Group details reuse the native Group type selector (Container, Boundary, Collection) and the same two-column port
forms, drag handles, key adjustment and Style dialog used by blocks. Group styles expose
the shared port label tabs. Do not introduce a separate port editor or silently rewire
connections. Rejected mode changes use the existing owned dialog with a bounded list of
affected endpoint pairs, preserve the document/history and return focus to Group type.
Connection selectors use Source port / Target port when boundary groups exist, since
inside-facing group ports reverse the ordinary source/output role. The preview exposes
focusable group-port labels/anchors that select their owning group. Static diagram styles
and runtime DOM view state remain separate.

## Hide group contents

Boundary and Collection Group details add Hide contents beside Group type, using the shared native
checkbox primitive and existing form/history handling. This document setting is separate
from list disclosure preferences: the list still exposes hidden descendants for editing.
Collapsed groups retain their ID/style and Group details selection; their full body is
focusable/clickable like a block. Keep existing preview camera anchoring and English copy.
Switching to Container shows contents automatically. Reject invalid boundary changes in
the owned dialog; preserve the document and restore focus. No automatic rewiring.

## Convert block to boundary group

Extend the existing block action/context menu with Convert to boundary group. Reuse the
shared menu/button owner and current success/error notice; this reversible operation needs
no confirmation. Select the resulting group and focus its row, keep the same key through
Undo/Redo and preserve camera anchoring. Refuse conversion while that block has unfinished
invalid fields; retain entered values. Empty drafts need a port before conversion.
Group and block details share the Width/Height field renderer and number-input behavior,
with Group/Block accessible names. No new tokens, menus, dialogs or size controls.

## Collection overview

Collection reuses Group details, hierarchy, native select, Hide contents, history and
existing notices/dialogs. No second tree or new visual tokens. Container is default;
Boundary alone exposes real port forms. Collection collapse draws up to two backing cards
inside its reserved footprint, a direct-member count and virtual Input/Output. Preview
anchors select the group; they are not editable endpoints or DOM port controls. Each
external edge remains selectable despite shared route points. Container expands in the
same undo step; unsafe type changes list affected links in the owned modal, returning
focus to Group type. Preserve keyboard access, viewport anchoring, narrow layout, English
interface copy and document styles.

## Preview editing actions

External terminals reuse text typography and the Preview hit/selection layer, without
block frames or port lists. External inputs occupy the left and outputs the right; retain
per-side document order. Measure multiline text/padding before routing. The Connections
footer owns Add terminal; Add connection offers New external input/output through the
shared terminal dialog and returns to the preserved connection draft. No new workspace tab
or separate terminal list. Terminal details reuse field/textarea/select adapters and the
owned modal, with atomic Save/Cancel and inline errors. Preview's shared actions expose
Edit style, Edit label, Edit terminal and Delete terminal only where applicable. Text style
reuses the existing Style dialog. Invalid/stale editing, focus restoration, view/camera,
Undo and offline behavior follow existing owners. Reuse primary hover/focus tokens.

Preview's toolbar disclosure and pointer/Shift+F10 context menu use one action definition
in components/preview-actions.js. Right-click selects the target before opening the menu.
Block, group and edge targets offer Edit style… and Edit label…; group navigation and
visibility actions appear only when applicable. Double-click continues to open Style.
Edit label reuses the shared dialog, textarea, field errors and transactional history.
Show the target key/endpoints, autofocus Label, support multiline text, Save/Cancel,
Ctrl/Cmd+Enter save and Escape cancel. Preserve IME composition and preview focus/camera.
Blank labels remove the property: blocks/groups display their ID, edges display no label.
The label draft stays inside the dialog until Save; invalid input stays editable there.
No new visual tokens or canvas text-editing layer.

Keep the existing workbench tokens and Style dialog. Preview adds a compact Style button
and the shared disclosure actions menu beside zoom controls. Block/group/edge double-click
opens that same transactional dialog, preserving the current workspace mode and camera.
Native double-click dispatch plus stable endpoint/owner identity and drag thresholds own
gesture recognition; panning/cancellation must never open Style. Group title hits preserve
child and edge hit priorities. Collection backing cards select their single group.

Boundary and Collection groups expose a native disclosure arrow at the upper right of their
title, positioned in an HTML overlay at a constant usable size through zoom. Reuse ui.js
buttons/icons and surface/border/primary tokens. Reveal on group hover, selection or keyboard
focus; offscreen controls leave the tab order. Container has no content toggle. This overlay
is editor-only and absent from SVG/PNG exports. Right-click/Shift+F10 reuse the same shared
actions disclosure at a viewport-clamped pointer/target position, with Style and a conditional
Hide contents/Show contents action. No separate menu or modal implementation.

## Group view navigation

Preview's native View target select switches between Top and any document group, including
hidden nested groups. Label the first option Top. Group options show the single-line display
name (falling back to ID), adding [ID] only for duplicate names, including a name matching Top.
Keep document group order; expose the full ancestor path and IDs as the selector title. Reuse native select styling
at compact toolbar density and existing muted/primary tokens. A wrapping breadcrumb row
appears only in group view and links Top/ancestors through shared quiet buttons. Retain
Split/Editor/Preview independently. View contents belongs to the existing preview and group
list disclosure menus; no second navigation/menu system. The selected view root has no
preview collapse arrow, while children keep their own controls and stored collapse settings.

The root frame, label, styles and real ports retain identity. Reuse the current canvas and
all selection/Style interactions. First entry fits; subsequent entries restore that view's
camera with logical anchoring through geometry changes and host resizes. View state is
session UI state, outside JSON/history, and resets on document replacement/reload. SVG/PNG
export the current view; Save JSON and Copy JSON retain the full project. No new visual tokens.

## Block appearances and signal notation

The Layout workspace tab reuses native field/select/button primitives and settings-grid
spacing. Its Grid table has explicit cell labels, an overflow container and Apply/Reset
transactional controls. Keep controls readable on narrow screens without squeezing many
columns. Rows/Columns are native numeric fields; Auto arranged reports unselected members.
Only chosen members use Grid. Empty cells stay reserved and shrinking returns removed
members to Auto. Reuse existing help, error, count and Undo patterns. The Layout panel fills the available workspace width; its form children retain
their natural height inside the shared panel scroller, and wide grids scroll horizontally.
Port Side and Both directions use existing editor controls and validation/status
surfaces. Caption is a regular multiline field. No new visual tokens or separate modal.
Hidden Port names remove text lanes and phantom rows from block geometry. Keep distinct
connection slots, explicit size minima and shape safety; title sizing governs otherwise.
Group Style's Corner radius reuses the numeric style field, validation and transactional
modal. Default square corners preserve existing diagrams; rounded frames use the same
shared SVG renderer in Preview, exports and DOM, without new tokens or layout variants.
Cross-group Grid uses the same Layout panel; expansion is derived from Cells, with a hint
listing each Container's children. Reuse help, counts and field errors; no new modal or visual tokens. Shared track
gutters reserve Container headers/frames without sacrificing cross-group row alignment.

Preview's Flow is a native select beside View using the same preview-view-control styling.
Keep Left to right / Top to bottom readable and allow the header to wrap on narrow screens.
Layout settings shares the value and shows axis-appropriate exterior feedback sides. Reuse
existing status, Undo and fit/camera behavior. Down changes geometry and port rows, never
rotates glyphs or introduces a separate canvas/menu. Concat becomes a horizontal bar.

Concat uses the canonical block list footer's Add Concat button and the existing block
detail/Port/Style controls. Keep footer wrapping at narrow widths. Reuse native selects,
text-style inheritance, field-help guidance and standard validation/status surfaces. Its
Bar is a thin Flow-aligned body: ordered inputs on the left and a centered output on the
right in Right flow, inputs on top and output at the bottom in Down flow. Port rows show the
fixed side as muted text instead of a select. Hidden text can make it a thin bar without removing accessible names.

Reuse the shared transactional Style modal and its existing Block/Group/Line tabs. Native
Appearance selects Rectangle, Stacked or Trapezoid; reveal only its relevant numeric field
with units/range/default help. Use the existing style-grid, field errors and focus handling.
Hidden text and End arrow use explicit inheritance selects; Defaults owns diagram
visibility/arrow defaults and Layout settings owns exterior feedback side. Preserve existing
spacing, tokens and responsive dialog scrolling. Draw trusted shape primitives and arrow
triangles through shared SVG geometry, with no editor-only controls in image exports.

## Connection label placement and repetition

The canonical Connection Style dialog's Label tab owns Destination labels (Long branches,
Always, Never) and Long branch threshold, with blank values inheriting defaults. Reuse native
selects, field typography, validation and modal history. Source and receiver names use Inline
virtual nodes, preserving transparent backgrounds and Group fills. All instances retain Net
identity and individual routes remain selectable. Keep responsive dialog scrolling,
SVG/PNG parity and per-view DOM mask IDs. Retired placement/position fields are rejected.
No new UI tokens or panels.

## Net editing and source signal labels

Keep the engineering workbench palette, shared field/native select/checkbox/button adapters,
transactional Style/Add dialogs and existing scroll owners. Connection creation offers Net
and Concat, with Bidirectional as a Net checkbox. A Net row has a quiet vertical target list;
the selected receiver uses the existing primary border/background tokens. Avoid separate
hardware-looking cards for virtual signal names. Source labels participate in local layout
with text-only dimensions and a small gap; only the name and routed wire are exported.
Destination names use reserved Inline nodes beside receiving Ports, with short tails and
arrows ending at hardware. Always reserves space immediately; Auto selects long branches
from the first routed layout and freezes that set for one additional layout. Receiving
slots follow Port side/order, including Concat and Terminals; footprints may change placement.
Hidden omits all virtual structures and labels. Shared Net selection highlights all branches.
No new tokens or application navigation are required. Owners and behaviors are in UX-CONTRACT.

## Runtime domains

The existing editor remains a Blockchart editor. Its domain implementation lives under
`src/lib/blockchart`; shared drawing/export utilities live under `src/lib/shared`.
Flowchart is a text/JSON conversion runtime with no new workspace, toolbar or editor UI.

## Diagram defaults workspace

The user-approved Defaults page is a fourth workspace tab. Keep the cool workbench tokens,
shared native select/field/button owners, Style tabs and one panel scroller with reachable
Apply/Discard actions. Category selection is a native select so six categories stay usable
at phone widths. Text fields use the existing two-column Style grid on desktop and a single
column on narrow screens. Inherited-value/source hints are quiet field help with wrapping;
inputs retain blank values rather than materializing defaults. Reuse existing validation,
focus, history, persistence and notification owners. Diagram font settings affect diagram
text only. This is an intentional move of global visibility/arrow controls out of Layout,
with an Edit defaults shortcut there; no new palette or duplicate settings owner.
