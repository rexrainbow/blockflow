# Story Agent Kit

Build `{{KIT_VERSION}}` supplies `story-edit.mjs` and `story.schema.json` for stepped
Blockchart presentations. Node.js 22.12+ suffices. The single module includes the
Blockchart layout/renderer and the existing Story player, CSS and page assembly.

```sh
node story-edit.mjs inspect diagram.json
node story-edit.mjs inspect diagram.json draft.story.json
node story-edit.mjs check diagram.json draft.story.json
node story-edit.mjs edit diagram.json draft.story.json --ops changes.json
node story-edit.mjs edit diagram.json draft.story.json --ops changes.json --write
node story-edit.mjs export diagram.json draft.story.json -o presentation.html
node story-edit.mjs extract presentation.html
```

Create a draft as `{ "format": "blockflow-story", "version": 1, "title": "Demo", "chapters": [] }`.
`inspect` returns the SVG's referable `wires` and `modules`, including terminals
named `@terminal:ID`. With a Story it includes normalized chapters/steps, missing
references and advisory `fingerprintMatches`. `check` prints missing references as
`{ci, si, type, ref}` records and exits 1 when any exist. A fingerprint mismatch
alone does not fail reference checks.

`edit` accepts a JSON array of RFC 6902 `add`, `replace`, `remove` and `move`
operations. Paths are non-root JSON Pointers. Array indices are zero-based; `-`
appends. `add` inserts array items and can set object properties. `replace` and
`remove` require an existing target. `move` uses `from` and inserts after removing
the source. All operations apply to a private copy and the complete result is
normalized/validated once the batch finishes. Unknown structural fields and invalid paths fail the batch. Chapter wave and
wave-row extension properties are retained for compatibility. Chapter, step, hop, note and wave content use these same operations.

```json
[
  { "op": "add", "path": "/chapters/-", "value": { "title": "Transmit", "steps": [] } },
  {
    "op": "add",
    "path": "/chapters/0/steps/-",
    "value": { "title": "Start", "body": "Start both stages", "hops": [] }
  },
  {
    "op": "add",
    "path": "/chapters/0/steps/0/hops/-",
    "value": { "kind": "control", "wires": ["Controller.start -> FIFO.start"] }
  }
]
```

Preview and write both print `{diff, problems}`. Only `--write` replaces the Story,
using an exclusive lock, adjacent temporary file, source-content check and atomic
rename. Failure leaves the original file intact. Existing indentation, newline
style and BOM are retained. The diagram is read-only. `--ops -` reads stdin.
Missing wire/module references refuse editing by default; `--allow-missing` keeps
them and returns diagnostics. A legacy draft's default filling and cleanup appear
in the diff. Export accepts missing references, matching the GUI player's behavior
of skipping them. Export refuses overwriting either source file and writes a
complete offline HTML page with its editable diagram/Story sources. `extract`
prints both sources as JSON and validates the embedded Blockchart.

```js
import {
  emptyStory,
  parseStory,
  validateStory,
  svgIndex,
  storyProblems,
  applyStoryOps,
  inspectStory,
  checkStory,
  editStory,
  exportStory,
  readPresentationSources,
  diagramFingerprint,
} from './story-edit.mjs';

const result = await editStory(diagram, draft, operations);
const page = await exportStory(diagram, result.document);
```

`applyStoryOps(story, operations, index, {allowMissing: false})` is the pure
transaction API; `index` comes from `svgIndex(svg)` or `inspectStory`. It returns
`{document, diff, problems}` without mutating its inputs. File writes belong to the
CLI. `parseStory` preserves prototype/default normalization and wire spacing, with
field-path errors. `story.schema.json` describes normalized output, so validate
legacy input after `parseStory`. Version must be 1 when supplied. Wave periods
must be finite/positive, bits binary, tick values finite, and perBit intervals pairs
of finite numbers; wildcard perBit keys such as `*` are supported. Step wave ranges
must be finite. These checks catch malformed values previously accepted by the GUI.

Fingerprinting is the first 16 hex digits of SHA-256 over `JSON.stringify(diagram)`.
It is advisory and does not silently rewrite a Story's saved diagram reference.
The HTML uses the GUI's player and assembly unchanged. Embedded source JSON escapes
`<`, U+2028 and U+2029 and can be reopened by the Story editor. No browser, network,
project checkout or installed modules are needed when running the generated kit.
