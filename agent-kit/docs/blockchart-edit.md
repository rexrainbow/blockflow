[Agent Kit home](../README.md)

Run examples from the Agent Kit root.

# Blockchart editing

Build: `blockchart-agent-kit-23be7e737990fd0d41d1`

See [Blockchart authoring](blockchart.md) for the diagram format and rendering.

```sh
node blockchart-edit.mjs inspect diagram.json --module TimerA
node blockchart-edit.mjs inspect diagram.json --group Bank0 --recursive
node blockchart-edit.mjs apply diagram.json --ops changes.json
node blockchart-edit.mjs apply diagram.json --ops changes.json --diff-format semantic
node blockchart-edit.mjs apply diagram.json --ops changes.json --diff-format semantic --write
```

```js
import { inspectDiagram, applyDiagramOps } from './blockchart-edit.mjs';
const view = inspectDiagram(document, { groupId: 'Bank0', recursive: true });
const { document: edited, diff } = applyDiagramOps(document, [
  { op: 'removeBranch', from: 'TimerA.out', to: 'Sampler.in' },
]);
```

Both synchronous functions also export from `rtl-diagram/blockchart` in the source
checkout. They return independently owned JSON. Inspection returns the selected
ID, its ancestor ID path (outermost first), raw modules and groups with their authored
ports and members, and an array of matching branches. A group query includes its
direct members; child groups appear by ID in the parent's members list. Set
`recursive: true` to include their contents. Use `{ moduleId: 'TimerA' }` for one module.
Collapsed groups can be inspected. Each branch reports its authored `from`, `to`,
endpoint group paths (including the owning group for a boundary port), `crossGroup`, and `relation` (`internal`, `incoming`, or
`outgoing` relative to the selected IDs, following the authored direction).
`net` contains the shared Net fields and `branch` contains the destination overrides.

The operations file contains one JSON array, executed in order. Endpoint arguments
are a port string such as `"TimerA.out"` or a terminal such as `{"terminal":"ClockIn"}`.

| Operation         | Arguments and effect                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addModule`       | `module` is a complete authored module with a new ID.                                                                                                                                                                                 |
| `updateModule`    | `id` and `patch`. Provided fields replace their old values, nested style objects merge and a provided ports array replaces the entire ports list. The ID is fixed.                                                                    |
| `renameModule`    | `id` and `newId`. Renames the module and all endpoint, group membership and root/group Grid references, preserving order and metadata. Later operations use `newId`.                                                                  |
| `removeModule`    | `id`. Removes membership and incident branches and clears the module's Grid cells to `null`.                                                                                                                                          |
| `setGroupMembers` | `id` and an ordered `members` array of existing IDs. A move can update both groups in the same batch.                                                                                                                                 |
| `setGridCells`    | Group `id` and a rectangular `cells` matrix. Replaces the group's cells, selects Grid layout and preserves its other layout settings. Use `null` for empty slots.                                                                     |
| `updateNet`       | `patch` may contain `label` and `style`. Select the whole Net by its authored `id`, by a unique `from`, or by `from` and one existing `to`. The destination disambiguates Nets sharing a boundary port.                               |
| `updateBranch`    | `from`, `to` and a `patch` with `feedback`, `constraint` or `style`. Writes overrides at the existing destination index. Both update operations merge nested style fields.                                                            |
| `addBranch`       | `from`, `to`, optional `branch` with destination style, feedback or constraint. Appends to the matching source face's Net or creates a Net. Optional `net` fields (e.g. ID, label, direction or shared style) apply only on creation. |
| `removeBranch`    | `from` and `to`. Removes that destination and deletes a Net only when its last destination is removed.                                                                                                                                |

Save this two-destination example as `diagram.json` (also provided as
`examples/blockchart/agent-edit-fanout.json` in the checkout).

```json
{
  "version": 1,
  "diagram": { "name": "Inspect and edit a clock branch" },
  "modules": [
    { "id": "TimerA", "ports": [{ "id": "out", "direction": "output" }] },
    { "id": "Sampler", "ports": [{ "id": "in", "direction": "input" }] },
    { "id": "Monitor", "ports": [{ "id": "in", "direction": "input" }] }
  ],
  "groups": [{ "id": "Bank0", "members": ["TimerA", "Sampler"] }],
  "connections": [
    {
      "id": "Clock",
      "from": "TimerA.out",
      "label": "Clock",
      "feedback": true,
      "constraint": true,
      "style": { "strokeColor": "#315585" },
      "to": [
        "Sampler.in",
        { "endpoint": "Monitor.in", "constraint": false, "feedback": false, "style": { "strokeWidth": 3 } }
      ]
    }
  ]
}
```

Save the operation array as `changes.json`.

```json
[{ "op": "removeBranch", "from": "TimerA.out", "to": "Sampler.in" }]
```

Previewing the edit prints one splice at `/connections/0/to`. The remaining
`Monitor.in` branch keeps its 3-unit stroke, `feedback: false` and
`constraint: false`. The Clock Net keeps its own label, stroke color and flags.

The following alternative batch uses the original example. It moves Monitor
into Bank0, places both receivers in the second Grid column, renames the Net
and overrides only its Sampler branch. When moving between two groups with
Grids, include `setGroupMembers` and `setGridCells` for both affected groups
in the same array. A `null` at the old position preserves the vacant slot.
Grid membership rules apply to the final batch result.

```json
[
  { "op": "setGroupMembers", "id": "Bank0", "members": ["TimerA", "Sampler", "Monitor"] },
  {
    "op": "setGridCells",
    "id": "Bank0",
    "cells": [
      ["TimerA", "Sampler"],
      [null, "Monitor"]
    ]
  },
  { "op": "updateNet", "id": "Clock", "patch": { "label": "Sample clock" } },
  {
    "op": "updateBranch",
    "from": "TimerA.out",
    "to": "Sampler.in",
    "patch": { "constraint": false, "style": { "strokeWidth": 2 } }
  }
]
```

Both preview and write validate the entire final diagram once the batch completes.
stdout contains the JSON diff. The default format, `pointer`, uses JSON Pointers. Field edits include
`before` and/or `after`; array splices include `index`, `removed`, and `added`.
An empty diff is `[]`. Use `--ops -` to read the operation array from stdin.
Failures return a nonzero exit code and a diagnostic on stderr. Only a successful
`--write` with changes replaces the original, using a temporary file in its directory.
Concurrent editor CLI writes to the same resolved filename are checked at replacement.
After a forced process termination, a leftover `.blockflow-edit.lock` next to the
diagram can be removed once that writer has stopped.

## Renaming a module

Use `{ "op": "renameModule", "id": "TriggerSample", "newId": "TriggerBitStart" }`
in the same operations array accepted by `applyDiagramOps()` and CLI `apply`.
The label, ports, style, module position, Grid slots, Net metadata and branch
metadata are preserved. Both compact and wrapped fan-out destinations are updated.
Missing modules, malformed new IDs and IDs already used by a module or group
fail the batch with the operation index and relevant ID. A later failed operation
also leaves the original file intact.

Semantic output represents a rename as
`{ kind: 'module', change: 'rename', id, newId, references }`.
Each reference contains `path`, `before` and `after`, with JSON Pointer paths into
the original snapshot. Rename chains are combined into the final ID change.
Reference rewrites caused by renaming are included in that record. Additional
label, branch, membership or Grid edits are reported separately against the renamed
baseline. A rename back to the original ID produces no rename record. Removed
modules are reported as removals. The default pointer format reports the ordinary
field changes. Preview and `--write` return identical diffs for the same input.

## Reviewing changes by diagram object

Use `applyDiagramOps(document, operations, { diffFormat: 'semantic' })` or
`--diff-format semantic` to compare the original diagram with the validated
batch result. Preview and write return the same array of records for the same
input. An empty array means the batch produced no changes.

- A module or group is matched by authored ID, and a port by ID within its owner.
  An added or removed object carries its raw `after` or `before` value. An
  updated object groups its changed `fields` using paths relative to that object.
- Membership changes list the IDs added and removed. Grid edits report one
  `gridCell` per changed coordinate. For example,
  `{"kind":"gridCell","groupId":"Bank0Functions","row":0,"column":0,"before":"TimerA","after":"TimerBitPeriod"}`.
  Coordinates are zero-based. A null group ID denotes the root Grid. A missing
  side of a change denotes a slot outside the old or new matrix; `null` is an empty slot.
- Nets use their authored ID when present, otherwise their source endpoint.
  When boundary inout Nets share a source, a destination common to both snapshots
  identifies the Net. The source face resolves cases without a unique surviving
  branch. A whole Net addition or removal includes
  its destinations. Within a retained Net, each changed branch is matched by
  `from` and `to`. A shared label change and one branch's style change produce
  one Net record and one branch record. A change solely between compact and
  wrapped target syntax is reported as `representation`.
- An `order` record lists the common selectors in their old and new relative
  order. Inserting or removing other objects produces only their own changes.
