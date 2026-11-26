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
`sha256`. Chapters contain a title, optional embedded `waveform` and ordered steps.
Steps contain title/body text and ordered hops. They may include `scope: true`,
`camera: "all"`, notes and `waveform` focus. Hops contain event/level/data/control kind,
optional badge and endpoint-pair wire strings. Notes contain a module/terminal key
and text. Empty chapters and empty step/hop lists are valid drafts.

`parseStory` accepts the previous prototype format without format/version, fills
defaults, normalizes `A.o->B.i` to `A.o -> B.i`, drops `camera: "step"` and false
scope, and returns owned data. Unknown structural input fields are dropped during
normalization. Editing rejects newly introduced unknown fields. Errors carry
`path` and include a field path in the message. Supplied versions other than 1 fail.

### Embedded chapter waveform and step focus

`chapter.waveform` is one normalized `blockflow-waveform` document, validated and
copied by `parseWaveform`; errors are prefixed with `chapters[ci].waveform`.
Its [model, editing and SVG contract](waveform-runtime.md) apply unchanged, including
locked links, named edges, markers and optional signal `port: "Module.port"`.
The Story schema references the waveform schema's `$id`, `urn:blockflow:waveform:1`;
register `waveform.schema.json` before compiling `story.schema.json` in a JSON Schema
validator. Both files are shipped in the Agent Kit.

`step.waveform` is an optional object with optional `from`, `to`, `signals`, `links`
and `markers`. Times must be safe integer ticks; the effective defaults are 0 and
chapter waveform length. Lists contain strings. Links normalize spacing around
`->`, for example `timer_tick -> start_edge`. Signals/markers use their IDs, never
indices. Focus is authoring data, not a copy of the chapter waveform. An empty focus
uses the whole waveform and names no emphasis targets. The GUI/player owns emphasis,
dimming and cursor animation, using the runtime identities and geometry below.

Out-of-range/reversed/empty windows and missing references remain stored and become
problems rather than parse errors. Fractional/non-integer times and malformed
embedded waveform structures are parse errors. Embedded waveform soft problems
retain their existing `waveformProblems` contract; Story diagnostics do not duplicate
them or repair waveform data.

The retired `chapter.wave` and `step.wave` fields are dropped without inspection,
validation or conversion, including malformed values. They never reach player data
or saved normalized sources. `parseWave` remains a deprecated standalone utility
for existing imports; Story parsing/editing no longer calls it.

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
Waveform focus adds types `signal`, `link`, `marker`, `window` and `waveform`:

- Missing signal/marker IDs and link pairs use that ID/pair as `ref`.
- Invalid effective windows use `type: "window", ref: "from -> to"`.
- Focus without a chapter waveform produces only `type: "waveform", ref: "waveform"`.
  It does not emit an extra error for every focus item.
  Existing wire/module diagnostics precede waveform diagnostics within each step.

`wiresForPort(index, port)` returns owned `{from,to}` pairs from the SVG index,
matching the exact endpoint at either end and including every fan-out branch.
Absent or unconnected ports yield `[]` and do not produce a Story problem: the SVG
index proves connectivity, not existence of every unconnected diagram port.
`waveformIndex(waveform)` returns ordered `signals: [{id,label,port?}]`, named actual
transition `edges: [{id,signal,t}]`, `links: [{ref,from,to,...}]` and authored markers.
An optional name on an initial value is not an actual transition and is excluded.
`diagramFingerprint` returns the first 16 lowercase hex characters of SHA-256 over
`JSON.stringify(diagram)`. Matching is advisory. Inspect exposes the current
fingerprint and a nullable fingerprintMatches status without changing saved data.

## Transactions and output

`applyStoryOps(story, operations, index, {allowMissing: false})` applies non-root
JSON Pointer add/replace/remove/move operations to a private normalized copy.
Only the final batch is validated, allowing related chapter/step edits together.
Result is `{document, diff, problems}`. Diff compares the authored input with the
complete result, including normalization. Invalid paths, operations, fields or
final values fail the batch. Reference/window problems fail unless allowMissing is true.
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

Export passes the Blockchart SVG directly, without the converter's trailing newline,
to `presentationData({svg, story})` and then `presentationHtml(data, sources)`.
Tests compare its entire HTML with the GUI assembly. `presentationData` normalizes
and owns the Story, retaining chapter waveform documents and focus. It adds top-level
`problems` from `storyProblems` and, on each waveform chapter, `waveformView`:

```js
{
  svg, // renderWaveformSvg output, unchanged
  left, pixelsPerTick, from, to, right, width, height, top,
  lanes: { tick: 92, start: 148 }, // signal ID -> lane centre y
  portWires: { start: [{ from: 'Controller.start', to: 'FIFO.start' }, /* ... */] }
}
```

The waveform uses the full capture and renderer defaults (24 pixels/tick, nominal 56-pixel lane pitch),
with `idPrefix: "blockflow-story-waveform-ci"` where ci is the chapter index. Multiple
chapter SVGs therefore have distinct definition IDs. Cursor x is
`left + (t - from) * pixelsPerTick`; viewBox scaling is the player's responsibility.
Local link gutters may grow lane spacing; the returned lane y/height values already
include that growth and rail measurement rows. SVG metadata `data-signal`, `data-edge-id`, `data-link` and `data-marker` is preserved.
Player code should skip missing focus entries and invalid windows using `problems`;
export retains those drafts. Renderer display limits still apply and may reject an
oversized capture. No GUI engine or layout is needed in the exported page.

The `blockflow-sources` JSON script contains the editable diagram and normalized
Story, including embedded waveforms; generated waveformView/SVG/geometry is player
data only, never a Story source field. Assembly escapes `<`, U+2028 and U+2029.
`readPresentationSources` validates the complete embedded Blockchart and Story.
The kit version includes waveform runtime source and schema; waveform.schema.json
is distributed beside story.schema.json. `inspectStory` adds a `waveforms` array of
`{ci,signals,edges,links,markers}`; chapters with no waveform have empty lists.

The GUI consumes runtime imports via `src/story/model.js` and retains its own
handoff/editor logic. GUI unit and browser
acceptance stay with Claude. Runtime/kit tests use the existing signal-path Story
fixtures and run the generated module outside the checkout under Node filesystem
permissions, covering references, atomic failures, HTML fidelity and round trips.
