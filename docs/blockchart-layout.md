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

| Phase              | Ownership and permitted changes                                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compile and ELK    | Compile private signal/receiver envelopes, measure and place nodes; convert ELK output to owned absolute geometry. Treat the compiled model as read-only.                                                            |
| `placeNodes`       | Restore Concat anchors and boundary Port order; place Grid cells and repair baseline routes, or repair excluded/Concat edges.                                                                                        |
| `refineAnchors`    | Refine unpinned peripheral groups, plan/reflow Auto channels, align Terminals and receiver nodes, then adjust Ports. Move owned helper geometry together and use bounded route trials for scoring.                   |
| `routeConnections` | Keep nodes and anchors fixed. Apply Container entry and outer feedback, then collect Grid/Auto/inter-Container demands together and commit independent corridor batches atomically.                                  |
| `completeLayout`   | Restore semantic Nets, apply Container exit/receiver-tail and stroke-spacing repairs with labels pinned, then place final labels/arrows and normalize scene coordinates. Finalization may translate the whole scene. |

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
- `routing-trial.js` owns optional candidate evaluation and commit. Callers clone,
  edit and check geometry first; it catches route-search failure, then calls the
  feature's acceptance policy and commits only an accepted result. Acceptance
  errors propagate. Required baseline routing still throws on failure. Trial
  limits, thresholds, edge selection and scoring order remain feature-owned.
  `evaluateRoutedTrial` evaluates without publishing; an optional private `route`
  callback can stage the normal working-routing policy. `commitRoutedTrial` uses
  that evaluator before publishing the accepted working copy.
- `layout-preview.js` isolates the disposable semantic/label preview used to guard
  Terminal adjustments. It never publishes or modifies the live working layout.

There is no new public phase API, persisted plan, schema field or GUI setting.
The routing adapters below separate strategy selection from diagnostic text;
eligibility stays planner-owned; common allocation and atomic acceptance are described below.

### Routing strategies and priority

`fixed.js` owns common endpoint/obstacle preparation, optional foreign-overlap
retry hints, point cleanup and route publication. Its internal call contract is
`routeFixed(result, model, options = {})`, where options are:

- `strategy`: `ordinary` (default), `container-entry`, `grid-channels`,
  `auto-channels`, `shared-channels` or private `channel-access`. Unknown strategies fail before changing routes.
- `selected`: optional routing-edge ID Set; `onlyExcluded`: restrict to
  `constraint: false` edges. These filters do not select a geometric strategy.
- `reason`: optional diagnostic text only. A value such as `grid-channels` does
  not activate channel routing. Strategy defaults preserve existing `routingInfo`.
- `avoidForeignOverlaps`: bounded optional-trial hint for actual foreign
  collinear conflicts, unchanged from the scoped peripheral alignment rules.

`routing-strategies.js` contains independent ordinary and Container-entry adapters,
plus a shared Grid/Auto channel adapter. Each selects eligible edges and searches
against the common prepared geometry. An ineligible or rejected optional route
retains its baseline. `channel-access` only attaches one branch to a supplied
assignment. `shared-channels` collects all eligible planners before allocating;
Grid/Auto standalone entries use that same corridor/batch implementation with
restricted offers. There is no completed-edge reservation list or per-edge
reconciliation pass.
Ordinary routing still reports required-search failures. Container entry keeps its
bounded complete-attachment comparison; it does not inherit channel rules.

`routing-policy.js` owns this fixed sequence, not a configurable priority list:

| Order                | Policy                                  | Protection/fallback                                                                                                                        |
| -------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Placement/refinement | Ordinary repair and bounded trials      | Establish valid routes for moved geometry and scoring. Concat and excluded-edge selection remain explicit.                                 |
| 1                    | Container entry                         | Improve eligible target attachments while keeping geometry and bounded detour checks.                                                      |
| 2                    | Explicit outer feedback                 | Runs only when enabled, preserving its existing direction and eligibility rules.                                                           |
| 3                    | Shared corridor batches                 | Collect Grid/Auto/inter-Container offers, deduplicate physical demands, allocate jointly and atomically accept or retain a whole corridor. |
| Semantic boundary    | Restore signal nodes into semantic Nets | Preserve source/receiver identities and pinned name sections.                                                                              |
| 4                    | Container exit and receiver-tail repair | Respect protected channel/outer routes, fixed frames, pinned trunks/labels and contact budgets.                                            |

Working policies run through `routeWorkingConnections`; semantic-only repair runs
through `routeSemanticConnections` after `finishSignals`. Later policies do not
unconditionally win: each retains its own protection and fallback contract.
No global reroute minimization or user-selectable strategy order is introduced. Disposable label previews deliberately retain their existing narrower
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

## Shared channel corridors and atomic batches

`channel-allocation.js` remains layout-neutral: `allocateTracks` colors Net union
intervals deterministically, reserves the widest stroke and reuses only strictly
disjoint foreign spans. `requiredTrackSpace` adds stroke widths, one six-unit gap
per neighboring track and optional margins. Planner-time Grid/Auto spacing budgets
remain local and keep their live geometry references.

At frozen geometry, `channel-corridors.js` registers Grid, Auto and sibling
Container offers before any channel route is published. Identity consists of
owner Container, packing axis and the semantic member sets of adjacent geometric
bands. Expanded children map to their containing direct-child band; synthetic
signal-owner IDs unwrap to their semantic owner. Mere coordinate proximity is not
identity. An ambiguous/interleaved/expanded slot without provably adjacent bands
keeps its planner-specific structural identity and is not merged speculatively.

Grid's ordinal spans are converted to physical scene intervals from the current
live source/target envelopes. Auto already uses physical envelope intervals;
Container access uses physical Port intervals. Duplicate branch IDs in one
corridor become one demand with the union span, maximum width and all adapter
offers. Same-Net branches retain their union reservation. Different parents,
axes or distinct corridors stay separate. A branch appearing in different
corridors retains each demand; if their full-route adapters cannot safely compose
those segments, the affected batches retain their baselines rather than silently
overwiring a previous route.

A known corridor uses the actual space between its frozen band faces, the maximum
required border margin and endpoint-access bounds. Margin budgets are taken once,
not summed per planner; strokes/tracks are allocated once from unique demands.
Unresolved slots retain their own planned window. Allocation may reuse existing
space, but this phase never resizes frames, expands gaps or redoes ELK. A joint
reservation that does not fit retains its valid baseline. Auto continues to avoid
Grid-controlled subtrees; shared registration does not broaden planner eligibility.

`channel-batch.js` owns route-only drafts, candidate selection and publication:

1. Evaluate all corridor candidates against the same frozen baseline. Try canonical
   track order and its reverse; mixed offers can try direct Container access and
   fixed Grid/Auto access, then select a complete valid candidate by Net overlap,
   crossing, bend and length scores. Collection order never grants ownership.
2. Each adapter gets the common assignment, reservations for foreign peer rails
   and fixed outside routes. It keeps its own endpoint/obstacle and acceptance
   rules. Already aligned clear branches reserve capacity but keep their straight
   path and diagnostics. Protected/outer routes cannot be stolen without their
   own matching planner offer.
3. Validate finite orthogonal routes, unchanged endpoint attachment, foreign
   parallel-ink separation and the used adapters' acceptance policies. A null,
   failed search, invalid route, rejected policy or insufficient space retains
   every branch and diagnostic in that batch. Required baseline failures still
   propagate from the earlier ordinary routing stage.
4. Reconcile independent candidate batches together before publishing. Conflicting
   candidate corridors roll back symmetrically, including their other branches;
   unrelated safe batches may commit. No per-edge half-commit remains.
5. Publish only accepted sections and routing diagnostics onto the original edge
   objects. Module/Group/Port geometry and private plan identities stay intact.

`group-channels.js` collects sibling-Container offers and supplies direct access
and quality checks; it no longer owns cloning, trial-order commits or rollback.
`routing-strategies.js` supplies Grid/Auto fixed access; it no longer maintains a
completed-edge list. The old `reconcileChannelRoutes` per-edge fallback has been
removed. Geometry-edit trials in `routing-trial.js` remain separate because they
have a different mutation contract.

Successful routed edges additionally expose `routingInfo.channelCorridor` (opaque
structural ID) and sorted `channelPlanners` (`grid`, `auto`, `group`). Existing
`method`, `reason`, track, owner and waypoint fields still describe the selected
access adapter. A retained baseline preserves its previous diagnostics exactly;
absence of a new routed marker is not a validation error. Internal batch reports
include commit/block counts and rejected-attempt reasons, but are not saved or
published as diagram fields. No schema, public function signature or GUI control
changes are required.

Regression coverage: `tests/lib/channel-corridors.test.js`,
`tests/lib/channel-batch.test.js` and Grid/Auto/Container routing integration tests.
These check demand/connection/offer order permutations on fixed geometry, duplicate
budgets, stroke/fanout unions, wrapper/expanded ownership, distinct scopes,
null/throw/policy failures, invalid routes, symmetric rollback and independent
batch progress. Permuting the authored graph can change ELK geometry and is not
claimed to produce the same complete diagram.

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

When Grid placement measures a nested ordinary Container, it budgets space for
a branch that exits a child Container and stays inside their common parent.
The source Port side identifies the child's exit face. A turn there needs
`2 × containerClearance(edge)` between frames, normally 24 SVG units. This
leaves room for the wire centerline to clear each frame by 12 units. Branches
using the same face share the largest requirement. Placement credits available
space and applies the shortfall before packing the enclosing frame. For a
Container expanded into its parent's Grid, the corresponding perimeter track
reserves that space. Semantic membership determines the budget even when a
visible Net label adds a private layout node. Pure Auto layout keeps ELK's
existing frame sizing.

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
anchors rather than the pre-Grid compound-node positions. Tangent alignment adjusts
Y for Right flow and X for Down flow. Explicit Grid participants (including children
in an expanded cross-group Grid), Grid ordering, Grid node geometry and source
models retain their geometry. Parent frames retain their dimensions during tangent
alignment; the downstream candidate described below may grow Auto ancestors.
After accepted moves, `frame-compaction.js` remeasures affected ordinary Auto
ancestor frames along the tangent axis. It preserves the existing origin, authored
minimum size, title/padding and child exit margins while reclaiming obsolete extent.
Grid-owning, Boundary/Collection/collapsed and Port-bearing frames are protected,
as are frames expanded by a cross-group Grid and frames below an explicit Grid.

Where the root Grid contains whole participants, the existing Grid placer repacks
only that root using current envelope sizes. Nested Grid geometry and internal
Container arrangements are retained, and root row/column gap and channel budgets
are recalculated. Nested channel plans keep live node references as entire root
subtrees move. Root grids with expanded cross-group participants retain their
existing track placement. Scoped views remeasure eligible frames without applying
the document's root Grid. Repacking and fixed-route repair run on a disposable
copy; a failed trial retains the accepted pre-compaction layout. Full working and
semantic routing continue afterwards against the compacted frames.

Downstream Port adjustment can still tune
Ports using the existing rules.

Eligible Containers have one to four ordinary Block members and at least one
constraining connection to a sibling Grid subtree. They have no Container Ports
or nested real groups/Concat. Boundary/Collection/collapsed Containers and
their descendants are protected. Standalone Auto charts without
Grid peers are unchanged. This does not yet align ungrouped Auto Blocks.

When every member has a Grid peer, candidates move owned signal/receiver wrappers
with their Blocks, preserve member order and configured minimum gaps, and may
grow only the Auto frame's tangent
extent to wrap the new internal spacing. They stay inside the unchanged parent's
content padding (or the original root content extent), clear unrelated frames,
Blocks and Terminal text, and retain sibling spacing. A frame never grows to wrap
external wires. If room is insufficient or geometry is blocked, retain the baseline.

For these fully anchored groups, up to four anchor-derived plans (endpoint
extremes, mean and rigid translation) are ranked by constraining Port-axis
mismatch, worst target mismatch and weak-edge
cost. A plan must improve constraining-axis mismatch by at least one unit. Weak
connections remain a tie-break cost at weight 0.15; they do not pull a local
interface toward a distant cross-Bank feedback endpoint. Incoming and outgoing
constraining links both contribute actual peer Port anchors. A single peer aligns
to that Port; equal-priority fanout can balance between its peers, such as the
midpoint of two receiver anchors.

If only some members have Grid peers, the engine tries one translation of the
entire frame. Each constraining peer contributes the tangent offset between its
actual Port and the member Port. The median offset is clamped to the available
parent content or root extent. Frame dimensions and the relative positions of
all members, Ports and owned labels are preserved. Weak branches and unrelated
Nets supply no preferred coordinate. The same containment, obstacle, sibling
spacing and anchor-improvement checks apply. Both routing trials include the
other wires. A trial that increases total working-route length is discarded, as
is one that introduces the first crossing or the first foreign-Net overlap.
If both trials fail, the group keeps its previous placement.

A small Auto Container displaced below a sibling Grid's flow band can also try
one rigid downstream position. Right flow offers the Grid's right side; Down
flow offers its bottom side. Left flow retains tangent alignment. The offer
preserves internal geometry and uses the same constraining-anchor median for
its tangent coordinate. Constraining Ports with explicit sides transverse to the
main flow retain tangent alignment. It does not override explicitly pinned Containers.

Placement-enabled direct branches also establish dependencies between sibling
Auto Containers. The refinement processes upstream Containers before downstream
ones, preserving authored order wherever dependencies allow. An eligible Auto
Container anchored to a Grid can then act as a Port-anchor peer for its directly
connected downstream Auto Container. This propagates along a chain within the
same parent; standalone Auto diagrams retain their existing behavior. Cyclic
Auto dependencies do not impose ordering or provide additional peer anchors.

Dependency order and target Port coordinates use the normalized per-branch
`constraint` value. A branch with `constraint: false` does not establish a
dependency, including when other destinations of its Net enable Placement.
Disabled branches still participate in route validation and route quality, so
they may reject an unsafe candidate. Changing Placement can also change ELK's
initial geometry; disabling a dependency does not pin the affected Containers.

For downstream Auto-to-Auto offers, route quality is measured on disposable
copies after `finishSignals` and the semantic route policies. Synthetic signal
segments can otherwise make a shorter, clearer Net appear worse when a label
changes the upstream frame's width. The committed candidate keeps its working
signal nodes for subsequent pipeline phases. Restoration failure rejects the
optional offer and retains tangent fallback. A zero-overlap candidate that also
shortens the restored routes is accepted immediately after passing the crossing
guard; otherwise the second overlap-aware alternative can still be tried.

Ordinary Auto ancestor frames may grow along the flow axis to contain this
candidate. Growth is rejected at a Grid-owning ancestor, an unrelated obstacle,
a visible Terminal label or a sibling-frame collision. Existing Grid nodes,
other siblings and their authored cells retain their positions. The enclosing
root Grid participant's frame may widen or deepen where other participants leave
space; the root Grid cells retain their order.

The baseline and the side candidate receive full working-route repair. At most
two routing alternatives are tried at this one side position, sharing identical
searches. A candidate must not increase either foreign-Net overlaps or crossings.
Survivors rank overlaps, crossings, total length and bends lexicographically and
must improve on the baseline. Thus fewer conflicts can justify a longer drawing.
Failure retains the existing tangent-alignment behavior. These measurements apply
to working routes; subsequent semantic cleanup can change final route counts.

For fully anchored groups, only the best two geometrically feasible plans
per group are tried, each with ordinary and optional overlap-aware routing. Each
private trial also runs Container entry, enabled outer feedback and the shared
channel batch policy, with geometry fixed. At a chosen position, alternatives are
ranked by overlap, crossing, bend and length counts. These counts choose a route,
not whether to fall back to the old, distant ELK position: whole-chart transient
route scores must not veto an otherwise safe peer-derived alignment. Proper
crossings are legal and can trade against better placement; no global crossing,
bend or length non-regression is promised by this placement refinement.

Within one candidate position, the trials reuse successful orthogonal path
searches with identical endpoints, headings, ordered obstacles, bounds, clearance
and avoidance segments. Each caller receives its own path points. The cache
expires after that position. Each trial still evaluates its own routing policies
and scores the resulting connections.

There is no shared eight-trial layout budget. Each eligible group has at most
four route evaluations, so earlier interfaces cannot exhaust a later interface's
opportunity to follow its peers. A geometry collision, protected scope, lack of
space or failed route search still retains the valid baseline. Label width along
the flow axis can change horizontal routing and overall scene width without
changing the chosen tangent anchor, provided peer anchors and geometric
feasibility remain unchanged. Text that changes the tangent extent or actual Port
offset can legitimately change the Block origin while its Port follows the peer.

This refinement precedes Auto channel planning, Terminal/receiver alignment and
Port tuning. The normal pipeline still plans Auto channels, refines anchors and applies final
channel/Container routing on the resulting geometry. It is a local best-effort refinement, not a guarantee
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
Outer-feedback and unmatched Grid/Auto reservations stay fixed. Matching offers
for a known shared corridor join the same allocation; an existing group-channel
plan can be jointly reassigned when another Net joins. Parent IDs must match; this first stage does not
find corridors across arbitrary nesting depths. An intervening frame/body blocks
the candidate rather than being traversed.

All eligible Nets are collected by ordered Container pair before allocating its
tracks; declaration order and strong/weak classification do not grant first access.
Aligned fanout branches join the Net's union demand even when they need no bend.
An internal branch to the source's own Container retains its original route.
The corridor prefers at least twelve
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
for bends, and rejected candidates keep that baseline. Auto/Grid eligibility remains planner-owned, while known matching offers use
the shared corridor batch described above. This sibling access adapter does not
infer arbitrary nested, reverse or intra-Container corridors. No extra layer/spacing constraints are inferred from weak Nets.

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

## Stroke-aware approach spacing

After Container-exit and receiver-rail repair, `approach-spacing.js` checks distinct
semantic Nets for near-parallel stroke contact, including a short positive
projection overlap beside a bend. Centerline non-overlap alone is insufficient:
two 1.5-unit strokes one unit apart already overlap in ink. `wireClearance(a,b)`
uses six units of visible track gap plus half of both stroke widths. Same-Net
sharing, proper perpendicular crossings and shared fixed endpoint attachments
are separate cases.

This bounded, route-only pass considers movable interior segments of unreserved
ordinary Block-to-Block paths. It first offers existing parallel coordinates of
the same Net, allowing a fanout branch to reuse its already established fork.
It also tries up to four nearby track offsets in either direction. Nodes, Ports,
label boxes, named sections' endpoints, source departure directions and receiver
attachments stay fixed. Reserved Grid/Auto/Group tracks, outer-feedback paths,
Concat and protected Boundary/Collection/collapsed ancestry are not moved.

Each candidate must clear node/label/Terminal obstacles and preserve scopes,
scene bounds, endpoint escapes and established exterior Container gates. The
exterior-gate check also applies to a previously borrowed corridor outside a
common ordinary Container. An ordinary local scope may borrow only its ordinary
parent's space, as in receiver-rail repair.

Accepted moves reduce the number or deficit of near-parallel contacts, never add
an exact foreign-Net overlap or introduce proximity to another previously clear
Net, and respect a local length budget. A bounded increase in distinct proper
Net contacts can replace removed stroke contacts; clear perpendicular crossings
are preferable to nearly coincident turns. Candidates rank contact improvement,
proper segment contacts, reuse of a same-Net coordinate and added length. Up to
12 accepted repair rounds are allowed. When no safe single move remains, up to
two ranked candidates may be evaluated as disposable batches: one provisional
move followed by the same bounded repairs with nested batches disabled. If moving
a long parallel segment briefly aligns the adjacent returns, the shorter span
can qualify for a trial even when the centerline distance drops to zero. The
second step can then move the return onto its own track. Only
batches that reduce total proximity, introduce no new near-Net pair and increase
no foreign-Net pair's overlap length are committed. Otherwise all paths and
diagnostics remain at the baseline. Reserved channels remain fixed throughout.
Placement=false connections use the same rules; that field affects node ordering,
not wire clearance. Established exterior gates are retained, while an ancestor
gate the original stub never reached cannot freeze that entire stub length.

A blocked candidate leaves its current
valid route intact; this is not a guarantee that every crowded fixed-geometry
chart can satisfy the preferred gap.

Success adds `routingInfo.approachSpacing: "separated"`, retaining the prior
method, channel and receiver diagnostics. No schema field, GUI control or source
JSON mutation is introduced. Tests: `tests/lib/approach-spacing.test.js` cover four
rotations, thin/thick strokes, source fanout reuse, fixed geometry, label
obstacles, protected/reserved paths, common-Container gates and idempotence.

## Physical corridor distribution

After semantic Container exits and approach-spacing repairs, a final route-only
pass redistributes eligible forward rails across physical gaps between facing,
adjacent sibling ordinary Containers. This is independent of endpoint ownership:
external inputs and Placement=false branches participate if their actual interior
rail occupies the gap. An external forward input may already have crossed the
receiving Container's facing wall and turned just inside it. If its final rail
lies within one Container clearance of the wall, the allocator includes it in
the same batch and can move the turn outside before the final Port attachment.
Deeper routes, internal detours and non-final rails inside the frame stay fixed.
Ambiguous spans with an intervening sibling frame retain
the baseline. The pass does not rerun ELK or move nodes, Ports or pinned labels.

The pass shares `allocateTracks`, `requiredTrackSpace`, `corridorAssignments` and
route-only connection drafts with the existing channel machinery. Shared-Net
intervals use one rail; disjoint Nets may reuse tracks. Spare width is divided
between track gaps and the two margins, with the existing six-unit clear ink gap
retained. Up to four alternatives are tested per corridor: interval-colored or
one-track-per-Net spatial ordering, each in both directions. The latter avoids
forcing non-overlapping Nets onto a shared rail when their endpoint topology
requires different relative orders. Crossings, overlaps, bends and length take
priority over uniform distribution; safety rejection retains the original routes.

Only movable interior rails with forward approaches are changed. Pinned source
trunk/receiver-label geometry, outer feedback, return/U-shaped rails, explicit
Grid/Auto reservations, Concat and Boundary/Collection/collapsed ancestry stay
fixed. Achieved exterior Container gates and endpoint escape directions remain
protected. New traversal of body/frame/label obstacles and new near-wire pairs
are rejected. Available width must cover all stroke widths, margins and track gaps.
No nodes or spacing budgets are enlarged to force a distribution.

Every candidate uses the same frozen baseline. Point patches address a specific
branch, section and interior rail, allowing one branch to participate in multiple
corridors without losing edits. Combined patches are validated together before
publication; incompatible patches or a failed combined safety/quality check retain
the whole baseline rather than assigning corridor priority by iteration order.
There is no recursive rerouting or unbounded search.

Derived `routingInfo.distributedCorridors` records contain opaque corridor `id`,
`axis`, `section`, `index`, zero-based `track` and `count`. Coordinates come from
the final section points; records do not retain pre-translation coordinates.
Earlier planner diagnostics describe their original routing provenance. No new
authoring field, schema, GUI control or source JSON mutation is introduced.
Tests: `tests/lib/corridor-distribution.test.js` and the spread allocation cases in
`tests/lib/channel-corridors.test.js`.

## Automatic Net junctions

After final routing repairs, arrows and label placement, the runtime derives solid
junction dots from each Net's orthogonal segment union. Duplicate and overlapping
segments contribute each geometric direction once. A point needs at least three
incident directions and two participating branch IDs; corners and straight shared
strokes are not junctions. A same-Net four-way crossing is a junction; crossings
between different Nets never join them. Dot count follows geometry, not fanout count.

Dots are suppressed at Port/Terminal anchors and where their ink could touch a
hardware body, an inline connection label, a visible Group title or another Net's
stroke. Concat collision checks use its physical bar, not its whole label envelope.
This conservative rendering pass does not change routes or node positions to make
room. Marker radius is the larger of 2.5 units and the largest touching stroke width;
color and opacity inherit the Net. Dots render in the connection layer beneath
Blocks and labels, and their disk extents participate in scene bounds/translation.

The optional derived layout field `junctions` contains records with `netId`, `x`,
`y`, `radius`, sorted `connectionIds` and `style: { strokeColor, opacity }`. It is
omitted when empty. This is runtime output, never an authoring/schema field; do not
save it into diagram JSON. SVG exports use circles with
`data-role="connection-junction"`, `data-net` and space-separated `data-connections`.
The renderer consumes the final DTO without recomputing junctions.

The runtime DOM adapter validates finite in-scene geometry, paint/opacity and
existing same-Net branch ownership. Dots belong to participating connections,
not a new selectable entity: existing connection hit regions include the disk
(with a minimum hit radius of six units), and branch bounds include its ink.
Tests: `tests/lib/net-junctions.test.js`.

## Orthogonal search reuse

Within each orthogonal route search, physical grid-point validity and undirected
link visibility/parallel-stroke penalties are cached independently of the arrival
heading. Headings still retain separate shortest-path states and turn costs;
neighbor order, heap tie handling and endpoint scoring are unchanged. A fresh
search uses fresh caches, so changed Ports, obstacles, bounds or neighboring wires
cannot reuse stale geometry. This also benefits candidate routing during peripheral
alignment; it does not remove candidates or change placement/routing policy.

The search stores costs and predecessor states in typed arrays indexed by grid
point and heading. Each row and column filters the relevant obstacles and
parallel segments in input order. Equal-cost detours keep the existing binary
heap tie order. Route scoring prepares segment lists and stroke bounds once per
evaluation and skips pairs with disjoint bounds. Approach-spacing trials share
the fixed peers' segments while evaluating one wire. A newly accepted edit is
visible to the next wire's evaluation.

## Routing policy for geometry edits

- **B4 — Equal-cost paths.** The orthogonal router keeps Dijkstra's search and
  its existing choice among equal-cost paths. Two paths with the same cost can
  draw different wires. An A* replacement must reproduce that choice or have an
  explicitly accepted change to the tie-breaking contract.
- **B5 — Peripheral alignment.** At each candidate position that reaches routing,
  run both the ordinary trial and the `avoidForeignOverlaps` trial. Compare valid
  results by overlaps, then crossings, bends and total length. Even when the first
  trial has zero overlaps, the second can win on the remaining criteria. Any
  future local rerouting must include other Nets whose wires encounter a moved
  obstacle or share an affected track.
- **B6 — Reuse across edits.** Geometry edits still trigger a full layout.
  Incremental layout across edits is a separate experiment. Before enabling it,
  invalidate all affected geometry, including ancestor frames, labels, obstacles
  and shared routing corridors. After each edit in a sequence, compare the entire
  layout DTO (including geometry and routes) and the SVG against a fresh full
  layout of the same document and view. Paint-only edits use the existing
  [paint-only runtime contract](editor-runtime.md#paint-only-blockchart-edits).

## Rendered SVG identity contract

`renderSvg(layout, { idPrefix })` adds selection metadata to the existing drawing.
The Worker, Studio SVG export and Agent Kit converter use this same renderer.
For the same layout and `idPrefix`, `renderSvg()` returns identical SVG text.
Worker replies use that text directly. The Agent Kit converter appends its existing
single trailing newline, so `convertDiagram(...).text === renderSvg(layout) + '\n'`.
Consumers can
style the actual SVG elements without reconstructing geometry.

| Element                   | Identity attributes                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| Branch section path       | `data-role="connection-path"`, `data-connection`, `data-net`, `data-from`, `data-to`                     |
| End/start arrow polygon   | Existing `connection-arrow` / `connection-start-arrow` role plus the same branch/Net/endpoint attributes |
| Block body                | `data-module` on its `block` rect or `block-body` shape wrapper                                          |
| Block title               | `data-role="block-label"` and `data-module` on the text                                                  |
| Block Port text           | `data-role="port-label"`, `data-module`, `data-port`                                                     |
| Group title               | `data-role="group-label"`, `data-group`                                                                  |
| Group Port marker/text    | Existing `group-port` marker or `port-label` text with `data-group`, `data-port`                         |
| Text background           | Existing `label-background` role plus the associated object identity                                     |
| Net label, leader, anchor | Existing roles plus branch/Net/endpoint attributes; label text uses `connection-label-text`              |

Ordinary Block Ports are represented by their existing labels and body attachment
coordinates; the renderer adds no marker geometry. Appearance shapes and multiline
`tspan` children inherit identity through their containing element. Collapsed Groups
retain their existing `data-group` identity. Terminals retain `data-terminal`.

`data-from` and `data-to` use the semantic endpoint form `Module.port`, including
Group Ports. Terminals use `@terminal:ID`. Branch IDs such as
`connection_3_branch_0` are layout identities and can change when authoring arrays
are reordered. Endpoint pairs supply order-independent branch lookup. `data-net`
is the layout Net ID, preserving an authored Net ID where supplied. Generated Net
IDs are scoped to that layout. Attributes are XML-escaped; DOM `getAttribute()`
returns the decoded strings. Minimal handcrafted layouts without semantic endpoints
omit endpoint attributes.

Each Connection section produces one path. The renderer deduplicates identical
path geometry within the same Net, preserving the existing paint/mask behavior.
Thus path counts can exceed branch counts. Inline label masks hide ink without
splitting paths; separate label leaders also contribute paths.

A shared path or shared start arrow has `data-connection` identifying its first
rendered branch and `data-connections` listing every owner separated by spaces.
`data-endpoints` contains a JSON array of `{ "from": "Module.port", "to": "Module.port" }`
objects in the same order as that owner list. Shared Net labels expose the same
owner metadata. Consumers highlighting one branch must include shared elements
whose owner list contains that branch. `data-from`/`data-to` describe the first
owner; use `data-endpoints` to find all shared endpoint pairs. Junctions retain their
existing `data-net` and `data-connections` contract.

All body, text, path and arrow coordinates, masks, styles, paint order and path
sharing behavior remain those of the supplied layout. Metadata is derived at
render time and is never persisted into authoring JSON.
