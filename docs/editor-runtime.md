# Editor support APIs

Editor support is separate from rendering/layout runtime (`src/lib/`) and GUI
presentation (`src/studio/`, editor components and styles). The canonical modules are:

| Module                                                     | Responsibility                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| `src/editor/blockchart/commands.js`                        | Blockchart authoring commands and stable editor identities |
| `src/editor/blockchart/services/layout.js`                 | Blockchart layout-service adapter                          |
| `src/editor/blockchart/services/worker-factory.js`         | Module Worker creation                                     |
| `src/editor/blockchart/services/worker-factory.offline.js` | Inline Worker creation for offline bundles                 |
| `src/editor/blockchart/workers/layout.js`                  | Blockchart Worker message listener                         |
| `src/editor/blockchart/layout-job.js`                      | Testable Blockchart request/reply implementation           |
| `src/editor/shared/history.js`                             | Document snapshot history                                  |
| `src/editor/shared/services/layout.js`                     | Injected, diagram-independent Worker scheduling            |

Domain tests live in `tests/editor/blockchart/`; shared tests live in
`tests/editor/shared/`. These modules do not import Studio, GUI components or styles.
Flowchart's corresponding modules live under `src/editor/flowchart/`, with tests
in `tests/editor/flowchart/`. Each domain supplies its own commands, job and Worker
adapter without domain switches in the shared scheduler.

## History

`new History(document, limit = 100)` clones the initial document. `update(change)`
clones the current snapshot, applies the callback and commits its result. A callback
failure leaves history unchanged. `commit(next)` clones the supplied document and
returns whether it differs from the current snapshot, using JSON serialization for
the comparison. A changed commit clears redo history and retains at most `limit`
previous snapshots. `undo()` and `redo()` return whether a snapshot was restored.

`present`, `past` and `future` retain their existing interface. History is intended
for JSON authoring documents; it neither validates a domain schema nor records
selection, preferences or computed layout. Commands/callers own domain validation.

## Shared layout scheduling

```js
import { LayoutService } from '../src/editor/shared/services/layout.js';

const service = new LayoutService(onResult, {
  createWorker: () => new Worker(workerUrl, { type: 'module' }),
  createRequest: (document, options, revision) => ({ document, ...options, revision }),
  debounceMs: 180,
  workerError: 'Layout worker stopped.',
});
service.request(document, options);
// When the owning editor session ends:
service.dispose();
```

The callback and factory are required functions. `createRequest` defaults to
`{ ...options, document, revision }`; it must return a Worker-cloneable request with
the supplied revision. The optional debounce must be finite and non-negative.
The injected Worker must provide `postMessage`, `terminate`, `onmessage` and
`onerror`. Replies must contain the request revision.

- Each `request()` advances the revision and replaces pending work. Requests are
  debounced for 180 ms by default. The document is passed to the adapter when the
  timer runs; callers must request again after authoring changes.
- An idle Worker is reused. Superseding a busy job terminates its Worker. Replies
  from replaced Workers or other revisions are ignored.
- `invalidate()` cancels pending work and invalidates results without scheduling
  another job. It retains an idle Worker.
- Valid replies are forwarded unchanged. A Worker error terminates the Worker and
  yields `{ revision, error: workerError }`; a later request can create a fresh one.
  Factory, request-adapter and `postMessage` exceptions also release the Worker and
  yield `{ revision, error }` with the exception message.
- `dispose()` cancels work and closes even an idle Worker. It is idempotent;
  subsequent `request()` calls throw. Create a new service for a new editor session.

The scheduler has no schema, model, DOM or domain Worker-factory dependency.

## Blockchart adapter and Worker protocol

`src/editor/blockchart/services/layout.js` exports `LayoutService` with the existing
`new LayoutService(onResult)` API. It supplies the Blockchart factory, the 180 ms
default and the existing Worker error message. Calls use
`request(document, { rootGroupId = null })`.

The request is `{ document, revision, rootGroupId }`. `runLayoutJob(data)` from
`src/editor/blockchart/layout-job.js` ignores missing documents or non-integer
revisions by returning `null`. Otherwise it validates the authoring document,
computes its layout/view and returns:

- Success: `{ revision, layout, svg }`. Connections retain `editorKey` and
  `editorLabel` for GUI hit targets, including fan-out connections.
- Failure: `{ revision, error, path }`, retaining validation paths where available.

It does not mutate the authoring document. It accepts Blockchart documents, not
Flowchart documents. `rootGroupId` selects the existing scoped view. The Worker
installs an event listener and posts non-null replies; using `addEventListener`
allows ELK's own initialization to coexist with the listener.

The normal factory creates the domain module Worker with `new URL` relative to the
factory module. The offline factory imports that same entry with `?worker&inline`.
Offline build resolution must select the appropriate **domain's** factory. A generic
basename alias for `./worker-factory.js` must not redirect future Flowchart imports
to Blockchart's Worker.

## Flowchart commands

`src/editor/flowchart/commands.js` provides immutable authoring operations. Every
editing command validates the input, clones it, validates the result and returns
the new document. A failure throws `FlowchartValidationError` with `path` and leaves
the original untouched. Unknown properties are rejected by runtime validation.
`validateDocument(doc)` returns the normalized model without changing authoring JSON;
save the command result, not that normalized model.

| API                                         | Behavior                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `emptyDocument()`                           | Valid starter with a `Start` node, no edges, and diagram name `Untitled flowchart`; the schema requires at least one node      |
| `addNode(doc, props = {}, groupId = null)`  | Fresh `NodeN` ID, process type and ID label by default; accepts node authoring properties, with generated ID taking precedence |
| `renameNode(doc, id, nextId)`               | Updates edge endpoints, membership and explicit note attachments; preserves labels                                             |
| `renameGroup(doc, id, nextId)`              | Updates parent membership; preserves labels                                                                                    |
| `removeNode(doc, id)`                       | Removes the node, its attached notes (explicit or inferred), incident edges and membership; rejects removal of the last node   |
| `addEdge(doc, from, to, props = {})`        | Fresh explicit `edge_N` ID; generated ID and endpoint arguments take precedence over props                                     |
| `removeEdge(doc, edgeId)`                   | Removes the edge; materializes inferred note attachments so deleting an association does not orphan its note                   |
| `reconnectEdge(doc, edgeId, end, nodeId)`   | Changes `from` or `to`, validating endpoint/type/group constraints                                                             |
| `addGroup(doc, memberIds, parentId = null)` | Fresh `GroupN` ID and label; reparents selected nodes/groups, including notes attached to selected owners                      |
| `ungroup(doc, groupId)`                     | Dissolves the group, promoting members to its parent (or root)                                                                 |
| `placeNode(doc, nodeId, groupId = null)`    | Moves a node and its attached note together; `null` means root                                                                 |
| `attachNote(doc, noteId, ownerId, side?)`   | Sets an explicit non-note owner, moves the note to that owner's group and optionally sets its side                             |

`placeGroup(doc, groupId, parentId = null)` moves an existing group beneath another
group or to the root. Its ID, properties, subtree, note attachments and edges stay
unchanged. The target must be an existing group, never the group itself or any of
its descendants. Empty old parents are pruned recursively. Placement under the
current parent returns an equivalent cloned document without reordering members.
Failures expose `FlowchartValidationError.path` and leave the input untouched.

Groups remain nonempty under the existing schema. Operations that empty a group
remove it recursively, including an emptied parent. Grouping a note without its
owner or moving it away from its owner's group is rejected. Add a note using
`addNode(doc, { type: 'note', label, attachTo: ownerId }, ownerGroupId)`; the owner
must be a non-note with no existing attached note. `attachNote` reattaches an existing
note; it does not turn a process into a note or replace another attached note.

Edge IDs occupy their existing separate namespace. Existing implicit edge IDs are
`edge_${index + 1}`. Edge edits and node deletion materialize those IDs **before**
changing the edge array, so surviving edges retain identity. Fresh IDs avoid all
current edge/node/group IDs. Explicit IDs are valid for Mermaid-imported documents;
these commands return JSON, with no JSON-to-Mermaid serializer. Other commands leave
omitted edge IDs omitted. Simple property edits must also validate the resulting
authoring document before committing to History.

## Flowchart Worker protocol

`src/editor/flowchart/services/layout.js` exports
`new LayoutService(onResult)` and uses `request(document)`, the shared 180 ms debounce,
invalidation and disposal semantics. It sends `{ document, revision }` to its own
module/inline Worker. `runLayoutJob` has the same ignored-envelope/error contract
as Blockchart and returns `{ revision, layout, svg }` on success. `svg` equals the
`text` from `convertFlowchart(document, { format: 'svg' })`, including its final
newline. The authoring document is unchanged.

Layout nodes/groups retain their authoring `id`. Each layout edge has `editorKey`
equal to its runtime `id`: its explicit authoring ID or `edge_${index + 1}`. Metadata
is added only to the returned layout and is never persisted into authoring JSON.

Document routing can use mutually exclusive root keys: own `modules` means
Blockchart; own `nodes` means Flowchart; own `states` means Statechart. This is
dispatch only, not validation. Documents must have exactly one of these keys;
pass the document to its domain validator to validate its complete structure.
Statechart commands and Worker contracts are documented in
[Statechart runtime](statechart.md), under `src/editor/statechart/`.

## Canonical imports

The former `src/editor/state/`, `services/` and `workers/` bridges have been removed
after Studio migrated. Import canonical domain/shared modules. GUI integration and
acceptance belong to Claude; runtime contract changes belong in the root temporary
mailboxes under the collaboration protocol. This split does not change authoring
schemas or persistence keys.
