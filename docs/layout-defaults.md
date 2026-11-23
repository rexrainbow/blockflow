# Layout defaults and routing

Blockchart uses one layout configuration, formerly called Compact. `layout.density`
is no longer supported: both schema validation and the runtime reject it, including
`"standard"` and `"compact"`. Remove the field from existing JSON. There is no internal
density field or compatibility branch. Nested and scoped layouts use the same rules.

The public `createDiagramModel`, `layoutDiagram`, SVG/PNG exports and standalone
Agent Kit share this engine. JSON export preserves authored values and omissions;
derived padding, virtual label nodes, adjusted Ports and Terminal positions stay internal.

## Defaults and precedence

Distances are logical SVG units, not a drawing-wide scale.

| Setting                                    | Default          |
| ------------------------------------------ | ---------------- |
| Module/component spacing                   | 20               |
| Layer spacing                              | 30               |
| Hidden Port pitch                          | 16               |
| Ordinary Container decorative inset        | 8 + border width |
| Title gap                                  | 6                |
| Edge-to-node / edge-to-edge base clearance | 6 / 6            |

Explicit module/layer spacing wins, with the existing body-stroke safety adjustment.
Grid row/column gap defaults remain 50/80; Grid cells, explicit gaps, fonts, strokes,
feedback spacing and Block/group minimums keep their existing contracts. Width/height
units remain 140 x 84; actual geometry may grow for text, Ports and routes.

## Ordinary Block titles

Ordinary Blocks without visible Port names, including portless Blocks, use a title-driven
Auto face with a 64 x 36 safety minimum. Text clearance per side is 12 horizontally
and 8 vertically, plus label padding and border allowance. Right and Down share this
calculation. Hidden Port text reserves no phantom lane. Any visible Port name keeps
the text-aware sizing path. Hidden Ports require 16-unit pitch and 8-unit corner
reservation, enlarged for border width. Receiver names, Port counts, stacked plates
and tapered faces may enlarge the node. Ordinary Bar appearances, synthetic labels
and Concat retain their separate geometry. See [the title-sized example](../examples/blockchart/compact-labels.json).

## Shared routing clearances

Channels account for line-body ink; triangle-arrow length is
reserved locally at endpoints rather than enlarging every node/layer gap. Edge-to-node
clearance is the default base plus half the maximum body stroke; edge-to-edge clearance
is the default base plus that stroke. The body-stroke adjustment also applies to Auto
placement beside a partial Grid. Compound children inherit the channel settings.

Fixed routing inflates obstacles by `max(3, strokeWidth / 2 + 2)`. Preferred endpoint
escape is at least 6, clearing that inflation and any local triangle length
(`max(8, strokeWidth * 3)`) by one unit. An escape ray stops before a foreign obstacle;
the actual router must still clear its own envelope. Arrow geometry retains its
available-segment clamp. Virtual signal attachments keep 3-unit escapes and 1-unit
inflation. Source/repeated names still reserve virtual nodes during ELK placement;
this does not remove labels or scale a completed drawing.

Fixed orthogonal routing scores the complete path, including turns between endpoint
escape segments and the searched middle path. Equal-length clear candidates therefore
prefer fewer total bends. Departure/arrival directions stay fixed, immediate reversals
over escape segments are rejected, and obstacle/scope constraints remain intact. This
changes wire selection without moving Blocks or Ports and adds no authoring option.
Clear, aligned spans between facing Ports remain straight even if preferred escape
lengths overlap. Foreign hardware, Terminal text and protected headers still block
that direct path; short receiver tails do not acquire artificial loops.

## Container frame geometry

Ordinary Containers use a top title band. The title width contributes
to the frame's minimum width, not an extra left content lane. Content gutters follow
incident routes and clear the decorative inset of 8 plus border width, with a 6-unit title gap. Boundary interface lanes
retain their separate geometry. Header bounds must fit the frame in both directions.
Ordinary header text is not a routing obstacle or a Port-adjustment penalty. Wires
may overlap headings directly; the renderer does not cut gaps under Container titles.
The conservative `labelBounds` remain layout/hit geometry, not a paint mask. Text is
painted after the wires using the existing font and style. Explicit label backgrounds
and borders still paint normally, including authored opacity. Container fills are not
repainted to hide wires. Outer endpoint access also permits ordinary heading crossings in Right and Down flow.
Actual hardware and reserved signal-name nodes remain obstacles. Boundary and collapsed
interfaces retain their route protection.
Connection-label inline masks keep their separate behavior.

Expanded group minima are physical SVG width/height in 140 x 84 units. The ELK
minimum option is converted to flow-normalized coordinates for Down flow; authored
fields and public dimensions are never swapped. This also fixes the previously
reported Down-flow minimum-orientation defect for Container/Boundary/Collection frames.

Concat receiver names reserve actual per-Port slots. Unlabeled inputs
reserve their pitch/access space rather than copying the largest receiver name across
every input. Hidden Ports use a 16-unit pitch. Names remain visible,
bit-width validation and input order are unchanged, and the bar stays thin.

## Shared cross-Container spacing budget

An Auto region whose direct children are all expanded ordinary
Containers credits existing internal flow-side gutters against its layer spacing.
Credit is the smallest entry gutter plus the smallest exit gutter, conservative for
any sibling order. Down uses top/bottom; Right uses left/right. The external gap is
at least the larger of 8 and the edge-to-edge clearance, without increasing
a smaller requested gap. ELK can require more room for routes.

Titles, inner gutters, child geometry, Port positions and size-minimum options are
not reduced. Requested layer spacing here is content separation, rather than an
additional full distance outside both Containers' padding. Mixed Block/Terminal regions,
Boundary/Collection owners and synthetic wrappers skip the budget. An active Grid
anywhere skips it for that layout pass, including partial-Grid placement. Scoped Auto
layouts use the same eligibility rules. No post-layout group movement or extra pass
is introduced.

## Shared Terminal rails

After Auto/Grid placement, each same-side Terminal rail moves toward the outer content
envelope. There is no fixed 60-unit minimum or preservation of distant
ELK layers. The complete Terminal/source/receiver-name envelope stays outside hardware
and Container frames with at least 12 units, enlarged by incident routes' local
stroke/arrow gutter requirement. Unrelated thick Nets do not enlarge this gap.

Direction, same-side anchor/text-edge alignment and 24-unit tangential separation stay
intact. Associated names and receiver wrappers move together; affected/crossed routes
are repaired. Hardware/Grid cells do not move. Reduce-bends can still adjust anchors
tangentially later. Core module/layer spacing and external rail clearance are separate
calculations. Long reserved names can still require a large envelope.

## Receiver labels

Ordinary rectangular, stacked and Concat owners reserve variable slots for the actual
receiver names. Ports without a repeated name reserve only their access clearance and
any visible Port text. Fixed Port centers and virtual label positioning use the same
slots; arrow/line clearance is retained. Boundary owners and trapezoids keep the
conservative reservation rather than changing their interface or tapered-face geometry.

The slots exist only in a cloned routing model. Labels still participate in ELK as
virtual nodes, and final alignment only accepts an obstacle-free placement with a
valid route. Existing routing remains available if an alignment trial fails. Auto end
labels still use the existing bounded second pass; layout defaults do not change the repeat
policy or silently suppress labels.

Reduce-bends prioritizes fewer bends, then less total displacement from initial
Port/Terminal anchors, then shorter routed length. It does not move an initially
fixed anchor solely to shorten a route with the same bend count. Real bend reduction
can still justify movement within the existing bounds and safety constraints.

Reduce-bends first tries aligning at the current Port position of the less-populated
face when both endpoints can move. This keeps a centered single-Port interface stable
when the multi-Port peer can make the alignment. Sparse faces remain movable if that
choice is blocked or out of range; existing bounds/safety/quality checks still apply.

## Container side-entry routing

After receiver alignment and Port adjustment, routes entering an expanded ordinary
Container from outside compare an additional access lane on the target Port's side.
The lane enters horizontally or vertically through the decorative frame and connects
directly to the receiver; no Port or hardware placement is changed. It stays at least
9 units outside the frame, enlarged by the connection's obstacle clearance. Existing
hardware, foreign labels, protected headings and routing scopes remain obstacles.
Crossing a Boundary or collapsed ancestor is ineligible; synthetic signal-owner wrappers
are not treated as decorative Containers. Outer-feedback routing still runs afterwards.

Candidates must strictly reduce complete-path bends. Among accepted candidates, fewer
bends wins, then shorter length. Complete-path length may grow by at most 50 percent
relative to the current route; a Net includes its shared source attachment, source name,
branch, receiver name and receiver tail in that comparison. Names remain routing nodes
until this pass completes. A blocked, out-of-scope, excessively long or non-improving
candidate leaves the current route unchanged. The rule applies to Auto and Grid, has
no authoring-schema field and does not change the shared Flowchart router.

## Container-local Auto spacing

Group `layout.moduleSpacing` and `layout.layerSpacing` are optional finite positive
numbers, using the same units and spacing budgets as the root settings. Each property
independently inherits from the nearest ancestor with an explicit value, then the root
value, then defaults (20 / 30). Omit a property to inherit; null, zero, negatives,
non-numeric and non-finite values are invalid. Values may be fractional. Layout type
does not inherit: a group without a Grid configuration remains Auto.

These settings govern the group's expanded interior, not its external gap. Its parent
controls placement among siblings, whose positions may change when the group grows.
Collapsed settings remain saved and take effect when the interior is expanded. Group
views retain the same inherited values even after outside ancestors are excluded.
Synthetic signal-owner wrappers keep their existing 8-unit local attachments.

Grid row/column gaps do not inherit from or add local Auto spacing. Local values still
govern Auto neighbors around a partial Grid, ordinary descendants and Auto scopes below
a Grid ancestor. An ancestor Grid that expands a Container controls its direct-member
placements; the Container's saved local values do not override those Grid tracks.
Existing Container gutter credits and routing/label requirements still apply, so these
are spacing requests/budgets, not exact measured distances or maximum sizes. Auto uses
ELK placement followed by eligible adjacent-layer channels described below.

`resolveLayoutSpacing(document, groupId = '')` is exported by the pure Blockchart entry
points. It accepts validated authoring or normalized documents and returns a new
`{ moduleSpacing, layerSpacing }` object; empty scope means root. Unknown/non-string
scope throws `RangeError`. It does not validate draft numeric values, mutate data,
insert defaults on groups or persist inherited settings. Use `createDiagramModel` for
authoritative validation. See `examples/blockchart/local-layout-spacing.json`.

## Adjacent Auto routing channels

Expanded ordinary Auto Containers now share the channel allocator and safe-access
router with Grid. No authoring fields are added. The first phase handles geometrically
adjacent flow bands in the same Container, facing forward Ports (bottom to top for
Down, right to left for Right), and at least two overlapping Net intervals requiring
separate tracks. `constraint:false` branches may participate only if already placed
forward; they do not acquire a new layer constraint. Straight aligned spans, isolated
traffic, feedback, bidirectional, side-facing and skipped-band links keep ordinary
routing. Root-level traffic and cross-Container links are not channel candidates.

Bands merge overlapping flow envelopes rather than guessing ranks from equal top
coordinates. Hardware and its source/receiver-name wrapper are atomic. Ordinary child
Containers are atomic for their parent and handled independently inside. Boundary,
Collection and Grid-controlled subtrees retain their existing behavior in this first
phase; an independent Grid sibling may still coexist with eligible Auto Containers.
Ambiguous/interleaved geometry conservatively reduces channel coverage.

Local/inherited `layerSpacing` first informs ELK placement. The planner uses existing
free space and adds only the deficit against stroke/track/access requirements. It does
not add another full spacing budget. A bounded bottom-up reflow preserves transverse
positions, layer order and later gaps, reuses spare frame space and grows enclosing
frames when necessary. Root ancestors carry whole sibling subtrees and Terminals;
no internal boundary Port is resized. Unchanged/roomy regions do not move. A geometry
change repairs general routes before Terminal/receiver/Port alignment. No extra ELK
call or independent convergence loop is introduced; the existing Auto receiver-name
second pass remains bounded as before.

Final Auto attachment runs after Grid channels and exterior feedback, before helper
restoration. Private plans follow live moved nodes and recompute usable gap width.
Intervals conservatively cover atomic node envelopes, including movable Port/name
space. Same-Net fan-out shares a track; disjoint ranges can reuse tracks. Obstacle,
scope and foreign-ink checks, bounded access candidates and final rollback are shared
with Grid. Fallbacks retain a valid general route; crossings and fallback parallel
ink remain possible, so arbitrary graphs are not guaranteed overlap-free.

Successful branches publish `routingInfo.method: "auto-channel"`, reason
`"auto-channels"`, `channelOwner` (Container ID), `channelAxis`, zero-based
`channelTrack`, `channelTrackCount`, `channelStatus: "routed"` and translated
`waypoints`. Blocked attempts retain the previous method with `channelStatus: "blocked"`.
These diagnostics and actual gaps never enter saved JSON. See
`examples/blockchart/auto-routing-channels.json`; changing direction needs no cell transposition.

## Grid routing channels

Down-flow Grid regions reserve horizontal routing tracks after each source row;
Right-flow regions reserve vertical tracks after the source column. Forward branches
between selected cells in different cross-axis tracks participate, including branches
with `constraint:false`. Same-column Down links (same-row Right links), feedback,
bidirectional links, synthetic local trunks/tails and external Auto neighbors retain
the general router. This first implementation does not change Auto's ELK layers.

Tracks use deterministic interval coloring of Grid column/row spans. One Net shares
the union of its fan-out spans on one track; disjoint Net spans can reuse a track.
Each track reserves its widest stroke and 6 units between ink, plus endpoint-access
margins. `rowGap`/`columnGap` are minimum requested gaps: only gaps whose channel budget
is larger expand. Other gaps, cell order and authored configurations stay unchanged.
Nested, partial and cross-Container Grid movement propagates channel positions through
live working-node geometry. No channel coordinates or second schema enter saved JSON.

After Port adjustment, Container-entry and optional exterior-feedback routing, a final
fixed-geometry pass attaches eligible branches to their assigned tracks. Physical and
synthetic signal endpoints, hardware, labels, protected headers and routing scopes
remain authoritative. It checks perpendicular access legs too; foreign parallel ink
cannot overlap on an accepted candidate. Perpendicular crossings remain legal and are
not new junctions. One Net may share ink. If access is blocked, out of scope or cannot
be separated from already-routed/ordinary foreign wires, retain the prior valid path.
This is bounded routing with a fixed set of tracks and access candidates, not a promise
that arbitrary graphs can be routed without crossings or fallback overlaps.

Successful branches publish `routingInfo.method: "grid-channel"`, reason
`"grid-channels"`, `channelAxis` (`"x"`/`"y"`), zero-based `channelTrack`,
`channelTrackCount`, `channelStatus: "routed"` and two translated `waypoints` describing
the assigned span. Fallbacks keep the previous method and set `channelStatus: "blocked"`.
These are derived diagnostics, not authoring fields. Synthetic plans are removed from
the public layout. See `examples/blockchart/grid-routing-channels.json` for four crowded Nets,
shared fan-out and an unaffected short Audit connection.

## Measurements

`node scripts/measure-layout.js --output output/layout` generates three same-source
scenarios: `reference-wide` (pinned module/layer spacing 180/70), `as-authored`, and
`defaults` (omit only module/layer spacing). It never rewrites the input. Reports
include bounds, routed length, bends, full warnings, source/end-name counts, input/runtime
hashes and Node/ELK versions. Report version 3 has no density field.

Portrait A4 fit uses a 180 x 267 mm usable rectangle (15 mm margins), including the
SVG export's 20-unit outer margins: `min(180 / svgWidth, 267 / svgHeight)`. Smaller
area alone does not guarantee larger printed text. The reference pins spacing,
not historical dimensions; compare reports from the same source.

ELK post-compaction remains disabled. Compound-graph experiments produced invalid
hitboxes, and Grid showed no consistent gain. Safe routing and readable labels take
precedence over reducing bounds.

## Grid Block minimum dimensions

Optional Grid-only `blockMinWidth` and `blockMinHeight` provide common floors for
explicit ordinary Block cells. Omit for Auto; values are positive numeric 140 x 84
logical units, including fractions. Final dimensions still honor content and
individual Block minima. Neither null cells, unselected peers, Concat nor whole
Container cells inherit these values. Effective dimensions are derived before
layout without changing source fields; all applicable Grid floors combine by max.
See [the runtime contract](blockchart-layout.md#grid-block-minimum-dimensions) and
[example](../examples/blockchart/grid-block-minimums.json).
