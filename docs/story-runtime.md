# Story runtime contract

The runtime API is `src/lib/story/index.js`; the maintained normalized format is
`schema/story.schema.json`. `src/lib/story/model.js` is DOM/GUI independent and
provides `parseStory`, `validateStory`, constructors, `flatSteps`, `svgIndex`,
`storyProblems`, `presentationData`, `readPresentationSources`, `isStoryFile` and
`diagramFingerprint`. The Node Agent Kit module also provides diagram-aware
`inspectStory`, `checkStory`, `editStory` and `exportStory`. Its maintained CLI guide
is [Story Agent Kit](story-agent-kit-readme.md).

## Format and normalization

A normalized document has `format: "blockflow-story"`, `version: 1`, a title and
ordered chapters. An optional diagram reference contains `name` and optional
`sha256`. Chapters contain a title, optional timing wave and ordered steps.
Steps contain title/body text and ordered hops. They may include `scope: true`,
`camera: "all"`, notes and a wave focus. Hops contain event/level/data/control kind,
optional badge and endpoint-pair wire strings. Notes contain a module/terminal key
and text. Empty chapters and empty step/hop lists are valid drafts.

`parseStory` accepts the previous prototype format without format/version, fills
defaults, normalizes `A.o->B.i` to `A.o -> B.i`, drops `camera: "step"` and false
scope, and returns owned data. The schema describes its normalized output; validate
legacy input after parsing. Unknown structural input fields are dropped during
legacy normalization. Editing rejects newly introduced unknown fields. Wave and
row extension fields are preserved, matching the earlier GUI format.

Errors carry `path` and include a field path in the message. Supplied versions
other than 1 are rejected. Chapter waves require a finite positive period,
nonempty binary bits and named rows with perBit intervals or a finite tick. A
perBit map can use `0`, `1` or wildcard/custom keys, with lists of finite-number
pairs. Optional `showBit` is boolean. Step focus rows are normalized to strings;
optional from/to values must be finite. Existing numeric period/from/to coercion
is preserved. Version, non-finite values, malformed intervals and nonbinary bits
are checked more strictly than the former GUI model. No new timing-range ordering
or clipping constraints are imposed.

## References and fingerprints

References use `Module.port -> Module.port` and terminal endpoints `@terminal:ID`.
The reference set is read from `connection-path` SVG metadata, including every
owner in `data-endpoints`. Label leaders and arrows do not create extra references.
Block modules use body metadata and block-label text; terminals use data-terminal
identity. Group frames are excluded, matching the Story editor's current index.
The [SVG identity contract](blockchart-layout.md#rendered-svg-identity-contract)
defines these attributes. Dictionary lookup treats prototype-like IDs as literal
keys rather than inherited properties.

`storyProblems(story, index)` returns `{ci, si, type, ref}` records in chapter/step
order. It keeps missing references in the Story. The player skips missing elements.
`diagramFingerprint` returns the first 16 lowercase hex characters of SHA-256 over
`JSON.stringify(diagram)`. Matching is advisory. Inspect exposes the current
fingerprint and a nullable fingerprintMatches status without changing saved data.

## Transactions and output

`applyStoryOps(story, operations, index, {allowMissing: false})` applies non-root
JSON Pointer add/replace/remove/move operations to a private normalized copy.
Only the final batch is validated, allowing related chapter/step edits together.
Result is `{document, diff, problems}`. Diff compares the authored input with the
complete result, including normalization. Invalid paths, operations, fields or
final values fail the batch. Missing references fail unless allowMissing is true.
The operation index/path or final field/reference path identifies failures.

The CLI defaults to preview and uses the Blockchart editor's shared atomic JSON
writer only with `--write`. It preserves BOM, indentation and newline style,
checks that the source has not changed and atomically replaces via an adjacent
exclusive temporary file while holding the existing lock protocol. Diagrams are
read-only. Module imports never write files. Export refuses source-file aliases
and atomically replaces its HTML output. The player requires no network or engine.

## Offline page and source extraction

The kit build bundles the existing `src/story/export.js` page assembly unchanged,
with `player.js`, `present.js`, `player.css` and `present.css` as raw strings.
Its SOURCES_ID import resolves to the runtime model. Those presentation assets
remain GUI-owned. Their contents, Story sources, schema and documentation contribute
to the kit version. There is no runtime import of GUI modules or files.

Export passes the renderer SVG directly, without the converter's trailing newline,
to `presentationData({svg, story})` and then `presentationHtml(data, sources)`.
Tests compare its entire HTML with the existing GUI assembly. The page's
`blockflow-sources` JSON script contains the editable diagram and normalized Story.
The assembly escapes `<`, U+2028 and U+2029. `readPresentationSources` locates that
script, parses the sources and validates the complete embedded Blockchart and Story.

Claude can replace the model/checking implementation in `src/story/model.js` with
runtime imports and retain GUI-specific handoff/editor logic. GUI unit and browser
acceptance stay with Claude. Runtime/kit tests use the existing signal-path Story
fixtures and run the generated module outside the checkout under Node filesystem
permissions, covering references, atomic failures, HTML fidelity and round trips.
