# Blockchart layout pipeline

Start with `src/lib/blockchart/layout/index.js` for the public boundary, model
effective Grid minima, projection, optional second pass and error wrapping. `pipeline.js` owns the ordered
stages within one pass; individual features own their geometry and routing policies.
`layoutDiagram` accepts the normalized result of `createDiagramModel`, not authoring JSON.
The public APIs, schema and layout output are unchanged by this organization.

Grid additionally plans routing channels during placement and routes them immediately
before signal restoration. `channel-allocation.js` owns interval coloring and
required track-space measurement. Grid owns its local spacing budgets and access
checks; `fixed.js` supplies endpoint/obstacle geometry. Private
plans contain live working-node references, follow nested/partial Grid translations
and never enter the public layout or saved model. See
[Grid channel contracts](layout-defaults.md#grid-routing-channels) for eligibility,
fallbacks and derived routing diagnostics. Requested Grid gaps are minima.

## Phase boundaries

`pipeline.js` uses explicit functions rather than a configurable pass registry.
The order is part of the runtime contract; grouping phases does not remove the
intermediate route repairs needed by later placement/Port scoring.

| Phase              | Ownership and permitted changes                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compile and ELK    | Compile private signal/receiver envelopes, measure and place nodes; convert ELK output to owned absolute geometry. Treat the compiled model as read-only.                                          |
| `placeNodes`       | Restore Concat anchors and boundary Port order; place Grid cells and repair baseline routes, or repair excluded/Concat edges.                                                                      |
| `refineAnchors`    | Refine unpinned peripheral groups, plan/reflow Auto channels, align Terminals and receiver nodes, then adjust Ports. Move owned helper geometry together and use bounded route trials for scoring. |
| `routeConnections` | Keep nodes and anchors fixed. Apply Container entry, outer feedback, Grid/Auto channels and inter-Container channels in the established order. Preserve channel reconciliation/fallback rules.     |
| `completeLayout`   | Restore semantic Nets, apply Container exit/receiver-tail repairs with labels pinned, then place final labels/arrows and normalize scene coordinates. Finalization may translate the whole scene.  |

Synthetic signal nodes remain available through the first four phases. Container
exit repair deliberately follows semantic restoration; moving it earlier would
change which trunk, branch and receiver-tail pieces must stay pinned. The optional
receiver-label second pass repeats the same pipeline with a frozen selection.

### Shared primitives and bounded trials

- `routing-geometry.js` owns exact-equivalent rectangle, segment, bounds and
  forward-path cleanup operations with a common tolerance. Interior intersection
  excludes frame-edge touching. Forward cleanup retains reversals; the general
  fixed router retains its existing separate point cleanup behavior. Terminal
  rail clearance also retains its intentionally different edge-touching rule.
- `route-quality.js` owns path metrics and explicitly different contact measures:
  `netRouteQuality` counts unique proper interior intersections and overlapping
  Net pairs; `countSegmentContacts` counts segment-pair crossings/overlaps and
  T contacts with a shared-endpoint exemption; `countStrokeContacts` counts
  stroke-envelope proximity with same-Net/common-endpoint exemptions. These are
  different policies, not interchangeable definitions of a single crossing count.
  Port-specific obstacle/anchor-shift scoring remains with Port adjustment.
- `routing-trial.js` owns optional candidate routing and commit. Callers clone,
  edit and check geometry first; it catches route-search failure, then calls the
  feature's acceptance policy and commits only an accepted result. Acceptance
  errors propagate. Required baseline routing still throws on failure. Trial
  limits, thresholds, edge selection and scoring order remain feature-owned.
- `layout-preview.js` isolates the disposable semantic/label preview used to guard
  Terminal adjustments. It never publishes or modifies the live working layout.

There is no new public phase API, persisted plan, schema field or GUI setting.
The routing adapters below separate strategy selection from diagnostic text;
route counts, eligibility, budgets and fallback rules remain unchanged.

### Routing strategies and priority

`fixed.js` owns common endpoint/obstacle preparation, optional foreign-overlap
retry hints, point cleanup and route publication. Its internal call contract is
`routeFixed(result, model, options = {})`, where options are:

- `strategy`: `ordinary` (default), `container-entry`, `grid-channels` or
  `auto-channels`. Unknown strategies fail before changing routes.
- `selected`: optional routing-edge ID Set; `onlyExcluded`: restrict to
  `constraint: false` edges. These filters do not select a geometric strategy.
- `reason`: optional diagnostic text only. A value such as `grid-channels` does
  not activate channel routing. Strategy defaults preserve existing `routingInfo`.
- `avoidForeignOverlaps`: bounded optional-trial hint for actual foreign
  collinear conflicts, unchanged from the scoped peripheral alignment rules.

`routing-strategies.js` contains independent ordinary and Container-entry adapters,
plus a shared Grid/Auto channel adapter. Each selects eligible edges and searches
against the common prepared geometry. An ineligible or rejected optional route
retains its baseline. Channel state is batch-local: track assignments, completed
edge order, pre-commit route snapshots and final reconciliation stay together.
Ordinary routing still reports required-search failures. Container entry keeps its
bounded complete-attachment comparison; it does not inherit channel rules.

`routing-policy.js` owns this fixed sequence, not a configurable priority list:

| Order                | Policy                                  | Protection/fallback                                                                                                                |
| -------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Placement/refinement | Ordinary repair and bounded trials      | Establish valid routes for moved geometry and scoring. Concat and excluded-edge selection remain explicit.                         |
| 1                    | Container entry                         | Improve eligible target attachments while keeping geometry and bounded detour checks.                                              |
| 2                    | Explicit outer feedback                 | Runs only when enabled, preserving its existing direction and eligibility rules.                                                   |
| 3                    | Grid channels                           | Route assigned tracks; retain blocked baselines and reconcile foreign parallel ink.                                                |
| 4                    | Auto channels                           | Apply eligible Auto reservations after Grid/feedback, with the same reconciliation and rollback.                                   |
| 5                    | Inter-Container channels                | Turn only in the free corridor between sibling frames; preserve reserved routes and reject unsafe batches without moving geometry. |
| Semantic boundary    | Restore signal nodes into semantic Nets | Preserve source/receiver identities and pinned name sections.                                                                      |
| 6                    | Container exit and receiver-tail repair | Respect protected channel/outer routes, fixed frames, pinned trunks/labels and contact budgets.                                    |

Working policies run through `routeWorkingConnections`; semantic-only repair runs
through `routeSemanticConnections` after `finishSignals`. Later policies do not
unconditionally win: each retains its own protection and fallback contract.
No global reroute minimization, user-selectable strategy order or pass merging is
introduced. Disposable label previews deliberately retain their existing narrower
preview sequence instead of publishing or rerunning the full routing policy.

## Grid Block minimum dimensions

Root `layout` and `groups[].layout` accept optional `blockMinWidth` and
`blockMinHeight` only with `type: "grid"`. Each must be a finite positive number;
fractions are valid. Omission means Auto (no additional floor from that Grid).
`null`, strings such as `"auto"`, zero and negatives are invalid. Width uses the
existing 140-unit logical Block unit; height uses 84. These describe physical SVG
width/height and never swap when flow changes to Down.

`grid-minimums.js` derives private effective module dimensions before scope,
visibility, source/receiver label compilation and every geometry measurement.
For each explicit ordinary-module cell, combine its authored width/height and all
applicable Grid bounds by max. Natural text, Ports and appearance geometry can
still grow beyond these floors. A minimum is not an equal-size or maximum-size
rule. Multiple Grid references combine their floors by max even if one Grid owns
the final placement; this also keeps dimensions consistent when opening scoped
views or previously collapsed contents.

Only explicit ordinary Block IDs qualify. Unselected Auto peers, null cells,
Concat modules and whole Container cells do not receive the bound. A Container
cell does not recursively apply its Grid's floor to descendants. Explicit
cross-Container expanded cells do qualify, and nested Grids can apply their own
bounds. Each axis is independent. Effective values stay in a private model copy;
source documents, normalized inputs, authored Block overrides and omitted fields
are never backfilled or mutated. Layout geometry and Ports are rebuilt using the
existing dimension logic, rather than stretching frames after placement.

The shared `layoutDiagram(model, { rootGroupId })`, Worker, Node and Agent Kit paths
use this contract. No public function signature changes. Invalid values retain
path-bearing validation errors, such as `layout.blockMinWidth` or
`groups[0].layout.blockMinHeight`. Switching to Auto layout requires removing these
Grid-only fields, as well as existing Grid-only cells. See
[the example](../examples/blockchart/grid-block-minimums.json).

## Grid Block horizontal alignment

Root `layout` and `groups[].layout` accept `blockAlign: "left" | "center" | "right"`
only with `type: "grid"`. Omission preserves existing centered placement exactly.
The setting describes physical horizontal cell alignment in both Right and Down
flow; vertical placement stays centered. It does not change `textAlign`, Block
sizes, cell membership or unselected Auto peers' own placement rules.

Each Grid owns its alignment independently. Explicit module cells (including
Concat) align their outer geometry; a whole Container cell moves with its
contents and retains their relative positions. Expanded cross-Container cells
align individually before their enclosing frames are rebuilt. Alignment follows
the Grid that owns placement, rather than combining ancestor settings.

The Grid pass applies alignment before fixed routing and channel allocation.
Private source/receiver label wrappers translate with their owner: Left and Right
align the semantic Block/Container body, reserving label-envelope overhang in
the column budget to keep neighboring cells apart. Center retains the existing
envelope-centered behavior. These overhangs can require a wider column; alignment
does not guarantee shorter routes or a smaller diagram.

Inputs and normalized models remain unchanged. Invalid values, including `null`,
`"auto"` and any alignment under Auto layout, produce path-bearing validation
errors (`layout.blockAlign` or `groups[0].layout.blockAlign`). Switching to Auto
requires removing this Grid-only property. Worker, scoped view, Node and Agent Kit
paths share this contract and existing API signatures.

## Grid-owned placement relationships

`grid-placement.js` derives a private Set of connections between distinct explicit
atomic cells of the same Grid. Initial `buildElkGraph` omits these edges from ELK
placement, and `readElkResult` seeds temporary endpoint sections for them. Required
Grid placement and fixed-route repair then produce their actual paths. A missing
required non-deferred ELK route still fails; this is not a general missing-route
fallback. No Set or synthetic constraint field is persisted in the model.

Grid is authoritative for the positions of these cells. An internal connection's
Placement/constraint flag remains authored and retained, but cannot add another
ELK rank inside the fixed Grid and leave unrelated outer siblings displaced after
Grid restores its dimensions. This includes explicit expanded cross-Container
cells and scoped views. Constraining edges remain available to channel planning
and every subsequent routing/quality pass.

Only atomic module cells and their owned signal wrappers qualify. Within-cell
source-name trunks and receiver tails remain in ELK. Unselected Auto neighbors,
connections crossing separate Grids, and movable Auto descendants inside a whole
compound cell retain their placement relationships. Nested Grids apply this rule
to their own explicit cells independently. Collapsed Grid scopes are not expanded
by this rule. There is no schema, GUI or public API change.

## Shared channel allocation core

`channel-allocation.js` has no layout-driver dependencies. Grid, Auto and
inter-Container planners all import the same internal primitives:

- `allocateTracks(branches)` preserves deterministic Net union intervals, maximum
  stroke width per Net/track, sorted branch IDs and reuse of strictly disjoint
  foreign spans. Touching spans remain separate. Input demand objects are not
  mutated; returned track/Net record shapes are unchanged.
- `requiredTrackSpace(tracks, margin = 0)` measures stroke widths plus one
  `TRACK_GAP` per adjacent track pair and twice the caller-supplied margin.
  Empty/single-track eligibility remains the caller's decision. Addition order
  preserves the existing floating-point layout results.
- `TRACK_GAP` is the existing fixed six-unit separation, shared by required-space
  measurement and both coordinate-packing loops; it is not a new authoring option.

This is extraction only. Drivers retain demand collection, units, corridor bounds,
margin rules, reflow/spacing budgets, live node references, coordinate accumulation,
trial order, reservations, diagnostics and rollback. Grid still supplies ordinal
cross-slot intervals, Auto uses atomic envelope intervals and inter-Container
routing uses actual Port intervals. Each call uses its own consistent interval
space; demands from those different spaces are not mixed in this stage.

The Auto single-track no-reflow rule, Grid minimum-gap budgeting and Group's
no-spacing-expansion rule stay unchanged. Physical corridor identification, demand
deduplication and allocation across different planners remain separate future work.
No public API/schema/GUI change or persisted allocation record is introduced.

## Stage contracts

`auto-channels.js` runs after initial Grid/excluded/Concat route repair and before
Terminal alignment. It captures conservative sibling flow bands, then makes one
bottom-up local reflow for eligible adjacent Auto traffic. Geometry changes trigger
general fixed-route repair. The final Auto channel pass follows Grid channels and
outer-feedback routing, immediately before signal restoration. Its private plans use
live atomic node references, and its scoped routing/rollback reuse `grid-channels.js`.
See [Auto eligibility and diagnostics](layout-defaults.md#adjacent-auto-routing-channels).

| Stage / owner                    | Input and output                                                  | Allowed changes and obligations                                                                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scope.js`, `visibility.js`      | Normalized model → scoped, projected model                        | Select visible hardware and resolve collapsed interfaces. Run once before either layout pass. Keep authored endpoint identity for restoration.                                                                               |
| `signals/selection.js`           | Visible model and optional completed first layout → branch ID set | Always selects before the first pass. Auto selects from first-pass routed lengths; freeze that set for the second pass. No third pass.                                                                                       |
| `signals/compile.js`             | Visible model plus receiver IDs → routing model                   | Clone before inserting source/receiver nodes, wrappers and local edges. Reserve label space and target Port slots. Treat the returned model as read-only in subsequent stages.                                               |
| `elk-graph.js`                   | Routing model → fresh compound ELK graph                          | Measure nodes, construct Ports, set ELK options and apply group nesting. Budget eligible Container gaps using the shared defaults through `container-spacing.js`. No shared model mutation.                                  |
| ELK, then `elk-result.js`        | ELK graph → owned working layout                                  | Convert group-local coordinates to absolute coordinates. Copy mutable geometry and metadata; preserve helper objects until routing finishes.                                                                                 |
| `concat-anchors.js`              | Working layout and routing model                                  | Restore physical Concat Ports after ELK projects them onto text-envelope sides. Return affected routing-edge IDs; keep dimensions/text geometry and repair those routes after Grid placement.                                |
| `groups.js` Port-order repair    | Working layout                                                    | Repair boundary Port ordering and attached routes before Grid placement.                                                                                                                                                     |
| `grid-layout.js`                 | Working layout and routing model                                  | Move node envelopes and descendants, resize group frames and reposition group Ports. It does not reroute Connections; the caller must run `routeFixed` afterwards.                                                           |
| `fixed.js`                       | Working layout and routing model                                  | Repair all, excluded or selected routes against fixed node/Port geometry. Never move nodes. Use routing-model endpoints to locate physical or synthetic anchors. Include endpoint-stub directions in path cost.              |
| `peripheral-alignment.js`        | Working layout after Grid placement/fixed-route repair            | Align small unpinned Auto leaf Containers to actual Grid-peer Port anchors along the tangent axis. Preserve Grid geometry, owned labels and parent bounds; check full routes before committing.                              |
| `terminal-alignment.js`          | Working layout                                                    | Align same-side Terminal anchors, move associated labels/envelopes, separate overlaps and reroute affected Connections. Terminal rails move toward content using local route clearance.                                      |
| `receiver-layout.js`             | Working layout                                                    | Align receiver nodes inside their reserved owner envelope. Repair attached routes; retain the previous valid placement if local alignment is blocked.                                                                        |
| `port-adjustment.js`             | Working layout                                                    | Bounded tangent-only Port/Terminal movement with related labels. Reroute trials and accept geometry-quality improvements. Dimensions and side alignment stay fixed.                                                          |
| `fixed.js`, `container-entry.js` | Working layout after Port adjustment                              | Compare bounded target-side Container entry lanes. Strictly reduce complete-path bends with at most 50% added length, including source/receiver names and their attachments. Preserve nodes, scopes and Boundary protection. |
| `outer-feedback.js`              | Working layout                                                    | Optionally replace eligible exterior feedback routes. Synthetic nodes still participate as obstacles.                                                                                                                        |
| `signals/restore.js`             | Working layout plus routing model → semantic working layout       | Join source trunks, label spans and receiver tails. Restore semantic endpoints and group membership; remove synthetic nodes, groups and edges. Pin Inline label geometry.                                                    |
| `container-exit.js`              | Semantic working layout after signal restoration                  | Prefer a straight departure beyond exclusive source Container bounds before turning. Preserve pinned labels/trunks, common ancestor scope and protected routes; bounded unsafe candidates retain their baseline.             |
| `finalize.js`                    | Semantic working layout → public layout                           | Add arrows, publish/check labels, calculate bounds, translate to the origin and add the caption. No node placement or route search.                                                                                          |

`signals.js` is a small internal facade for the three signal stages. It retains their
existing imports without combining their implementations.

Expanded group minimum-size options use ELK flow-normalized coordinates internally;
Down-flow options swap axes at the adapter boundary so public width/height remain
physical. Ordinary Container headers reserve top space and frame width, never a
left lane equal to title width. Concat receiver slots use actual names using the shared defaults.

Ordinary Container titles are excluded from route obstacles and Port-adjustment
penalties. render/svg.js paints wires continuously through heading areas, then paints
the styled text without a Container title mask. Conservative label bounds remain
layout/hit geometry. Boundary and collapsed interfaces retain their routing protection.

## Grid authoring and runtime plans

`../layout-spacing.js` resolves each Auto spacing property through semantic group
ancestry. Group configs retain explicit overrides only. `groups.js` applies resolved
spacing to ELK parents, while synthetic source/receiver wrappers keep 8-unit attachment
spacing. `grid-layout.js` uses the same resolver for partial-Grid Auto neighbors and
Auto sibling repair; Grid gap/channel budgets stay independent. `scope.js` captures
effective spacing on its private root config before discarding outside ancestors.
The fixed router retains its existing search-margin policy; local spacing changes
placement rather than line/obstacle clearance. See
[local spacing contracts](layout-defaults.md#container-local-auto-spacing).
Expanded ELK scopes explicitly use the root's fixed random seed, including synthetic
wrappers, so per-group option resolution does not leave seed selection implicit.

There is one public authoring schema. Grid configuration contains `type`, `cells`,
`rowGap` and `columnGap`, plus optional local `moduleSpacing`/`layerSpacing` overrides;
`expandGroups` is rejected, including in Auto mode.
`createGridPlan(cells, members, groups, path, fail)` in `../grid.js` validates cells
and returns a separate `{ expandedContainers, regions }` runtime value. Neither
authoring JSON nor normalized layout configuration receives these derived fields.

`parseGrid` uses the same plan builder for semantic validation. During placement,
`grid-layout.js` builds plans from the semantic model before signal wrappers substitute
cell IDs, then uses the plans with the routing model. Plans are local to each layout
pass and are recomputed after membership or cells change. No persisted cache or second
JSON Schema is required.

`reconcileGrids(document)` now validates all configured scopes without mutation. It
does not infer fields into the document or clear invalid references. Deletion and
membership commands must explicitly update affected cells; unknown IDs, duplicate IDs,
parent/child double placement and partial expanded Containers are validation errors.
Errors identify the offending cell (or malformed row/matrix), and partial Containers
also list their missing members.

Current Studio handoffs use the temporary root [GUI mailbox](../gui-integration.md).
Lasting GUI behavior is documented in [Studio Grid arrangement](studio.md#grid-arrangement).

## Coordinates and ownership

The shared orthogonal search accepts optional internal start/end travel vectors.
Blockchart fixed routing passes the source outward vector and the reversed target
outward vector. The search includes stub joins in its bend cost and forbids immediate
reversals. No schema field is introduced. Callers omitting vectors retain the original
axis-state search (including Flowchart waypoint routing).

- Concat layout envelopes include external text and may extend past the thin bar.
  Physical Port anchors are restored from appearance geometry after ELK. Grid reroutes
  all edges; Auto reroutes affected native edges after any excluded-edge repair. Source
  trunks and receiver tails are resolved through routing-model endpoints, not only
  semantic Net endpoints. No repair flags or coordinates enter authoring JSON.
- Working node, Port, Terminal, route and text coordinates are absolute. Appearance
  bodies and their paths/shapes remain local to the owning node.
- `translate.js` is the common translation primitive. `translateNode` moves one node,
  its Port metadata and its Terminal anchor; it does **not** recurse through group members.
  Grid placement explicitly handles recursive movement.
- `translateConnection` moves route points, routing waypoints, arrows and label instances.
  It restores `labelPosition`/`labelBounds` aliases after moving each instance once.
  Shared rendered labels still have independently owned coordinate objects per branch.
- During routing, a working Connection's `source`/`target` can already carry semantic
  endpoint identities. Resolve actual routing anchors from the matching Connection in the
  routing model. Collection projection may retain `routingSource`/`routingTarget` in public
  output; synthetic label endpoints must never escape restoration.
- Positions calculated during layout belong only to that layout result. Never write
  synthetic objects, measured dimensions or adjusted coordinates into authoring JSON.

## Finding the right change

| Change                                          | Start here                                    | Relevant tests                                               |
| ----------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| ELK placement options or initial dimensions     | `elk-graph.js`, `../geometry.js`, `groups.js` | `layout`, `block-sizes`, `group-sizes`, `down-flow`          |
| Grid tracks, partial Grid or expanded groups    | `grid-layout.js`                              | `grid-layout`, `cross-group-grid`                            |
| Obstacle avoidance with fixed positions         | `fixed.js`, `../../shared/orthogonal.js`      | `grid-layout`, `boundary-ports`, `down-flow`                 |
| Source/receiver signal footprints               | `signals/compile.js`, `receiver-layout.js`    | `nets`, `receiver-labels`, `connection-label-positions`      |
| Auto repetition or restored Net identity        | `signals/selection.js`, `signals/restore.js`  | `nets`, `receiver-labels`, `collection-groups`, `group-view` |
| Terminal rails or movable anchors               | `terminal-alignment.js`, `port-adjustment.js` | `terminal-alignment`, `terminals`, `port-adjustment`         |
| Origin, caption, arrow or exported label bounds | `finalize.js`, `translate.js`                 | `renderer`, `label-frames`, `multiline-text`, `down-flow`    |

Test names in the table refer to `tests/lib/<name>.test.js`. Run relevant tests while
editing, then the complete suite once the change is ready. `npm test` enumerates only
`tests/**/*.test.js` through `scripts/run-tests.js` and forwards Node test-runner arguments;
ignored diagnostic scripts under `output/` are not tests:

```powershell
node --test tests/lib/receiver-labels.test.js tests/lib/terminal-alignment.test.js tests/lib/port-adjustment.test.js
npm.cmd test -- --test-concurrency=2
npm.cmd run check
npm.cmd run format:check
npm.cmd run check:design
```

For a behavior-preserving refactor, compare complete layout objects and rendered SVGs
against outputs captured before editing. Include Grid, boundary/Collection views,
labels, Terminals, feedback and both flow directions; geometry-only assertions cannot
detect every change in identities, masks or SVG styling.

Blockchart layout is shared by Preview, DOM, Node export, offline and the standalone Agent
Kit. Rebuild `build:agent-kit`, `build`, `build:offline` and `build:dom-example` after runtime
changes; the Agent Kit freshness tests require matching generated artifacts. Choose browser
checks for the affected interactions. Flowchart has a separate pipeline under
`src/lib/flowchart`; this layout folder does not depend on it.

## Container exit preference

After signal restoration and all channel/feedback repairs, `container-exit.js`
examines semantic branches whose source is inside ordinary direct Containers that
do not contain the destination. A clear straight departure follows the source
Port side through every exclusive ancestor boundary, with an exterior gap of at
least 9 units (increased for thick strokes), before turning. A candidate also
approaches exclusive target Containers from an outside gate on the target Port
side. The nearest common ancestor remains the routing boundary; it is not exited.
Source/target exclusive Container bodies are obstacles between the gates, so the
candidate cannot leave a source Container and then cut back through its interior.

Group/module rectangles, Ports and reserved source/receiver labels remain fixed.
This stage never resizes a group to enclose its external wires. Only scene bounds
may expand during finalization. Internal fanout branches keep their original paths;
external branches can share the existing straight source-label trunk. If a reserved
source-label attachment already bends inside the source Container, that branch
retains its baseline rather than moving the label or inventing another label.
Boundary/collapsed protection, routed Grid/Auto tracks and explicit outer-feedback
channels take precedence. Clear straight routes and routes already beyond the
source boundary are unchanged.

Departure/arrival rays and the exterior search avoid Blocks, foreign Containers,
reserved Net labels and foreign Terminal text. Existing ordinary Container-title
rendering is unchanged; no title avoidance is added. A candidate stays within its
common ancestor, adds at most four bends, has length at most twice the complete
baseline plus 32 units, and cannot increase the foreign-wire contact/overlap count.
The budget includes preserved hardware/label attachments. These are best-effort
preferences: blocked rays, tight sibling gaps, insufficient ancestor space,
protected routing and excessive detours keep the valid original geometry. No
additional ELK placement or authoring fields are introduced.

Before committing an exterior route, `receiver-access.js` can simplify its last
few vertices: an already-clear external rail may turn directly toward the Port at
the Port's height instead of making a tiny sideways/backtracking step to the
preferred arrival gate. The target's 9-unit gate is a preference; this local repair
can use a smaller exterior offset down to the stroke-aware obstacle clearance,
while retaining endpoint/arrow access distance. It must reduce bends without
increasing length or foreign contacts, clear Blocks/labels/Terminal text and source
Container bodies, stay in the common ancestor and preserve the complete straight
source departure through its original exit gate. Pinned label/trunk sections are
unchanged. Necessary obstacle detours and protected channels remain intact.

Computed `routingInfo.containerExit` records `status: "routed" | "blocked"` and
exclusive source group IDs. Blocked results add a diagnostic `reason`:
`protected-boundary`, `reserved-channel`, `reserved-source-label`,
`reserved-receiver-label`, `missing-receiver`, `obstructed-access`,
`no-exterior-route` or `detour-or-crossing-budget`.
Successful replacements use `method: "fixed-orthogonal"`, `reason: "container-exit"`.
These diagnostics are layout data only; they do not enter saved JSON or create a
new authoring Port or group-boundary node. This pass currently handles departures
from Block/group Ports, not Terminal sources.

## Post-Grid peripheral alignment

After Grid placement and its fixed-route repair, `peripheral-alignment.js` refines
small ordinary Auto leaf Containers beside Grid siblings. It uses actual Port
anchors rather than the pre-Grid compound-node positions. Right flow adjusts Y;
Down flow adjusts X. Explicit Grid participants (including children in an expanded
cross-group Grid), Grid ordering, Grid node geometry, source models and parent
frames are unchanged by this phase. Downstream Port adjustment can still tune
Ports using the existing rules.

Initial eligibility is conservative: one to four ordinary Block members, no
Container Ports or nested real groups/Concat, and every member must have a
constraining connection to a sibling Grid subtree. Boundary/Collection/collapsed
Containers and their descendants are protected. Standalone Auto charts without
Grid peers are unchanged. This does not yet align ungrouped Auto Blocks.

Candidates move owned signal/receiver wrappers with their Blocks, preserve member
order and configured minimum gaps, and may grow only the Auto frame's tangent
extent to wrap the new internal spacing. They stay inside the unchanged parent's
content padding (or the original root content extent), clear unrelated frames,
Blocks and Terminal text, and retain sibling spacing. A frame never grows to wrap
external wires. If room is insufficient or geometry is blocked, retain the baseline.

Up to four anchor-derived plans (endpoint extremes, mean and rigid translation)
are ranked by constraining Port-axis mismatch, worst target mismatch and weak-edge
cost. Only the best two feasible plans per group are tried. Each first uses ordinary
fixed routing; if rejected, a disposable retry penalizes actual foreign-Net
collinear conflicts from the rejected ordinary trial using the existing search. Same-Net fanout remains legal.
Both searches count toward the unchanged budget of eight full routing trials
across the layout; no guard is relaxed to accept the retry. Non-constraining edges remain part of the
cost at reduced weight (0.15), so cross-Bank returns do not dominate local alignment.
A trial must improve constraining-axis mismatch by at least one unit. Checked
routes cannot increase proper foreign-Net crossings or overlapping Net pairs,
add more than two total bends, or exceed 1.3 times the previous routed length plus
32 units. Unsafe or failed route searches do not replace a valid baseline.

This refinement precedes Auto channel planning, Terminal/receiver alignment and
Port tuning. Existing channel routing and Container exit/entry rules still run
on the resulting geometry. It is a local best-effort refinement, not a guarantee
of straight connections or globally minimum wire length. No schema or GUI option
is added; no private trial plans are persisted in authoring or public layout data.

## Inter-Container routing channels

`group-channels.js` runs after reserved Grid/Auto tracks and before signal
restoration. It handles geometrically forward, facing-Port branches between two
sibling ordinary Containers: Right uses vertical tracks between frames; Down uses
horizontal tracks. Endpoints must be ordinary Blocks (not Concat, Terminal or
Container Ports). Node positions, dimensions, Port anchors, Grid ordering and
Container spacing remain fixed. This is routing-only, with no schema/GUI option.

Eligibility follows actual geometry, not the authored `feedback` hint: a branch
marked feedback can still qualify if its frames and Port directions face forward.
`constraint: false` branches participate alongside constraining branches without
changing their effect on layer placement. Bidirectional, reverse or side-facing
attachments and Boundary/Collection/collapsed ancestry remain protected. Existing
Grid/Auto/outer-feedback reservations stay fixed; this strategy's own tracks can
be jointly reassigned when another Net joins the same corridor. Parent IDs must match; this first stage does not
find corridors across arbitrary nesting depths. An intervening frame/body blocks
the candidate rather than being traversed.

All eligible Nets are collected by ordered Container pair before allocating its
tracks; declaration order and strong/weak classification do not grant first access.
Aligned fanout branches join the Net's union demand even when they need no bend.
An internal branch to the source's own Container retains its original route.
The corridor retains at least nine
units of exterior clearance on both sides (or larger stroke-aware clearance), and
respects endpoint access distances. Reuse `allocateTracks` with source-to-target
cross-axis intervals: one Net shares a union interval, disjoint foreign intervals
may reuse a track, overlapping intervals require separate tracks. Newly allocated
tracks have six units between stroke edges. Track order and its reverse are the
only two deterministic candidates; there is no unbounded search or automatic gap
expansion. Insufficient corridor space retains the baseline.

A clear aligned branch stays a straight line with its existing diagnostics. Other
candidates have three straight runs and two bends: depart along the source Port
side, change transverse coordinate outside both frames, and arrive straight through
the target frame. Thus a Net can share an exterior trunk/junction while its aligned
receiver continues horizontally/vertically without a detour. Existing compliant,
separated corridor batches are left alone; newly competing demands trigger joint
reallocation rather than treating this strategy's old tracks as fixed obstacles.
Pinned source-label trunks and receiver tails must already share these access
lines; otherwise retain their baseline. Labels/helpers are never moved.

A Container pair commits atomically only after all branches clear inflated foreign
bodies/frames, Terminal text and common-parent bounds. Total length and bends,
proper foreign-Net crossings, overlapping Net pairs, affected segment contacts
and stroke-envelope contacts cannot increase. Thus an equal-length/equal-bend
candidate can improve turn location without relaxing collision protection. Failed
or blocked pairs retain routes and metadata unchanged. Later Container-exit repair
respects the reserved-channel status. No private track plans enter saved JSON or
public layout data.

Successful computed routing diagnostics use `method: "group-channel"`,
`reason: "inter-container"`, `channelAxis`, zero-based `channelTrack`,
`channelTrackCount`, `channelStatus: "routed"`, optional `channelOwner` (common
parent), `sourceGroup` and `targetGroup`. These describe the computed route; they
are not authoring fields. No diagnostic is added to an ineligible/failed batch.

This is the first shared-allocation stage of channel-first routing: ordinary routing
still supplies a valid baseline, free inter-Container corridors get first preference
for bends, and rejected candidates keep that baseline. Auto/Grid allocation remains
separate and reserved; arbitrary nested, reverse and intra-Container corridors are
not unified here. No extra layer/spacing constraints are inferred from weak Nets.

## Receiver approach rail separation

After semantic Net restoration and Container-exit repair, `receiver-rails.js`
repairs collinear approach rails of distinct Nets entering the same ordinary
Block face, and moves independent approach rails away from a nearby Container
frame when a safe outward track is available. The pass changes only the last section's final two bends: Ports,
Block/Group rectangles, source/receiver labels, earlier sections and their source
trunks remain fixed. Horizontal and vertical faces use the same rule. Grid Block
alignment is already settled and is not modified.

Long through rails are considered first. A bounded set of outward tracks uses
shared track/stroke spacing, preferring a free corridor outside the nearest ordinary
Container. A candidate must reduce foreign-Net overlap length (or improve frame clearance
without increasing overlap) without increasing segment contacts, crossing node/label obstacles, leaving its routing scope,
reversing a departure or exceeding a local length budget. One unambiguous crossing
may replace a shared rail; this pass does not promise to eliminate every crossing.
Same-Net shared rails remain fixed because they require joint movement. Reserved Grid/Auto/group channels and
outer-feedback routes remain fixed, but can cause an ordinary conflicting rail to
move. Clear routes are untouched, and a blocked trial keeps the previous path.

The pass does not enlarge frames or add schema/configuration fields. A successful
repair adds `routingInfo.receiverRail: "separated"` while retaining the earlier
strategy diagnostics. It runs in the shared runtime for full/scoped views and
all render/converter paths. Regression cases: `tests/lib/receiver-rails.test.js`.

## Preferred routing border clearance

`routing-spacing.js` separates the existing hard obstacle minimum from preferred
visual whitespace. Ordinary fixed routing first tries `preferredClearance(edge)`:
at least 8 SVG units from Block outlines, increased for thick wires. Its source
attachment keeps the endpoint-local escape to avoid shifting Ports or introducing
artificial departure loops. Private signal-label trunks/tails keep their compact
1-unit obstacle reservation. If preferred inflation prevents a valid route, retry
with the existing safe obstacle minimum; available paths must not become errors
merely because the preferred whitespace does not fit.

Container entry/exit and inter-Container channel placement use
`containerClearance(edge)`, at least 12 units from an exterior frame. Exit repair
retries its existing 9-unit gate on failed preferred-clearance trials. Optional
channel/receiver improvements retain a valid prior path when no safe wider corridor
exists. Receiver rail repair also considers near-frame rails without a collinear
conflict, using the same spacing policy. Existing protected boundaries, shared-Net
rails, source exit gates and reserved tracks remain protected. A local ordinary
Container scope can borrow a free corridor inside its ordinary parent for receiver
rail repair; it cannot cross a Boundary or escape the containing parent. This
keeps scoped views from pinning a rail against an otherwise avoidable frame.

These are runtime routing defaults, not Block size, Grid gap or Container padding
settings. No new schema field or GUI control is required. Endpoint contact with
its own Port and straight traversal through a Container frame are intentional;
the preferred distance concerns parallel bypass/turning segments. Auto/ELK and
already reserved channels retain their existing constraints; preferred clearance
is not an unconditional global minimum. Verification includes free/narrow corridor
cases in `tests/lib/border-clearance.test.js` and four rotated receiver-frame cases
in `tests/lib/receiver-rails.test.js`.
