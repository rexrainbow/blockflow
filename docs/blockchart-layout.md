# Blockchart layout pipeline

Start with `src/lib/blockchart/layout/index.js`. It owns the execution order and the
optional second pass; individual stages own geometry and routing decisions.
`layoutDiagram` accepts the normalized result of `createDiagramModel`, not authoring JSON.
The public APIs, schema and layout output are unchanged by this organization.

Grid additionally plans routing channels during placement and routes them immediately
before signal restoration. `grid-channels.js` owns interval coloring, local spacing
budgets and access checks; `fixed.js` supplies endpoint/obstacle geometry. Private
plans contain live working-node references, follow nested/partial Grid translations
and never enter the public layout or saved model. See
[Grid channel contracts](layout-defaults.md#grid-routing-channels) for eligibility,
fallbacks and derived routing diagnostics. Requested Grid gaps are minima.

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
| `terminal-alignment.js`          | Working layout                                                    | Align same-side Terminal anchors, move associated labels/envelopes, separate overlaps and reroute affected Connections. Terminal rails move toward content using local route clearance.                                      |
| `receiver-layout.js`             | Working layout                                                    | Align receiver nodes inside their reserved owner envelope. Repair attached routes; retain the previous valid placement if local alignment is blocked.                                                                        |
| `port-adjustment.js`             | Working layout                                                    | Bounded tangent-only Port/Terminal movement with related labels. Reroute trials and accept geometry-quality improvements. Dimensions and side alignment stay fixed.                                                          |
| `fixed.js`, `container-entry.js` | Working layout after Port adjustment                              | Compare bounded target-side Container entry lanes. Strictly reduce complete-path bends with at most 50% added length, including source/receiver names and their attachments. Preserve nodes, scopes and Boundary protection. |
| `outer-feedback.js`              | Working layout                                                    | Optionally replace eligible exterior feedback routes. Synthetic nodes still participate as obstacles.                                                                                                                        |
| `signals/restore.js`             | Working layout plus routing model → semantic working layout       | Join source trunks, label spans and receiver tails. Restore semantic endpoints and group membership; remove synthetic nodes, groups and edges. Pin Inline label geometry.                                                    |
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
