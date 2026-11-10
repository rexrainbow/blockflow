# Blockchart layout pipeline

Start with `src/lib/blockchart/layout/index.js`. It owns the execution order and the
optional second pass; individual stages own geometry and routing decisions.
`layoutDiagram` accepts the normalized result of `createDiagramModel`, not authoring JSON.
The public APIs, schema and layout output are unchanged by this organization.

## Stage contracts

| Stage / owner                 | Input and output                                                  | Allowed changes and obligations                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scope.js`, `visibility.js`   | Normalized model → scoped, projected model                        | Select visible hardware and resolve collapsed interfaces. Run once before either layout pass. Keep authored endpoint identity for restoration.                                 |
| `signals/selection.js`        | Visible model and optional completed first layout → branch ID set | Always selects before the first pass. Auto selects from first-pass routed lengths; freeze that set for the second pass. No third pass.                                         |
| `signals/compile.js`          | Visible model plus receiver IDs → routing model                   | Clone before inserting source/receiver nodes, wrappers and local edges. Reserve label space and target Port slots. Treat the returned model as read-only in subsequent stages. |
| `elk-graph.js`                | Routing model → fresh compound ELK graph                          | Measure nodes, construct Ports, set ELK options and apply group nesting. No shared model mutation.                                                                             |
| ELK, then `elk-result.js`     | ELK graph → owned working layout                                  | Convert group-local coordinates to absolute coordinates. Copy mutable geometry and metadata; preserve helper objects until routing finishes.                                   |
| `groups.js` Port-order repair | Working layout                                                    | Repair boundary Port ordering and attached routes before Grid placement.                                                                                                       |
| `grid-layout.js`              | Working layout and routing model                                  | Move node envelopes and descendants, resize group frames and reposition group Ports. It does not reroute Connections; the caller must run `routeFixed` afterwards.             |
| `fixed.js`                    | Working layout and routing model                                  | Repair all, excluded or selected routes against fixed node/Port geometry. Never move nodes. Use routing-model endpoints to locate physical or synthetic anchors.               |
| `terminal-alignment.js`       | Working layout                                                    | Align same-side Terminal anchors, move associated labels/envelopes, separate overlaps and reroute affected Connections.                                                        |
| `receiver-layout.js`          | Working layout                                                    | Align receiver nodes inside their reserved owner envelope. Repair attached routes; retain the previous valid placement if local alignment is blocked.                          |
| `port-adjustment.js`          | Working layout                                                    | Bounded tangent-only Port/Terminal movement with related labels. Reroute trials and accept geometry-quality improvements. Dimensions and side alignment stay fixed.            |
| `outer-feedback.js`           | Working layout                                                    | Optionally replace eligible exterior feedback routes. Synthetic nodes still participate as obstacles.                                                                          |
| `signals/restore.js`          | Working layout plus routing model → semantic working layout       | Join source trunks, label spans and receiver tails. Restore semantic endpoints and group membership; remove synthetic nodes, groups and edges. Pin Inline label geometry.      |
| `finalize.js`                 | Semantic working layout → public layout                           | Add arrows, publish/check labels, calculate bounds, translate to the origin and add the caption. No node placement or route search.                                            |

`signals.js` is a small internal facade for the three signal stages. It retains their
existing imports without combining their implementations.

## Coordinates and ownership

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
