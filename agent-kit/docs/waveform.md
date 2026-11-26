[Agent Kit home](../README.md)

Run examples from the Agent Kit root.

# Waveform Agent Kit

Build `waveform-agent-kit-23be7e737990fd0d41d1` supplies `waveform-edit.mjs` and `waveform.schema.json`.
Requires Node.js 22.12+; the module and CLI run offline after copying the Kit,
without npm install, a browser or the project checkout. The waveform format is
separate from Blockchart, Story and VCD. Story chapter waveform documents use this
same format; this tool edits standalone waveform JSON files.

## Start with a waveform

Save this as `timing.json`:

```json
{
  "format": "blockflow-waveform",
  "version": 1,
  "title": "Timing example",
  "timescale": "clk",
  "length": 24,
  "grid": { "ticksPerBit": 8, "offset": 0 },
  "signals": [
    {
      "id": "tx",
      "label": "TX",
      "width": 1,
      "changes": [
        [0, 0],
        [1, 1, "tx_rise"],
        [4, 0]
      ]
    }
  ],
  "markers": [{ "id": "packet", "from": 0, "to": 24, "label": "Packet" }]
}
```

```sh
node waveform-edit.mjs inspect timing.json
node waveform-edit.mjs check timing.json
node waveform-edit.mjs export timing.json -o timing.svg
node waveform-edit.mjs export timing.json --from 0 --to 8 -o window.svg
node waveform-edit.mjs export timing.json --format json -o normalized.json
```

Time is nonnegative safe integer ticks; length is positive. Each signal has an ID,
width 1..4096 and ordered changes beginning at 0. Each change is `[tick,value,edgeId?]`.
Bit values are 0, 1, "x", "z". Buses accept bounded numbers and display/vector text.
Optional scope is display text; optional port is `Module.port` association text.
Signal labels default to IDs. Optional style is `{color:"#RRGGBB"}`. Tick 0 is an
initial state, not a movable/linkable edge. Actual changes must change value and
have strictly increasing times. Signal/marker IDs are unique in their lists;
edge names are unique across signals. Schema describes shape; runtime validation
also checks ordering, values, uniqueness and references.

Links are `{from:"edgeId",to:"edgeId",label?,delay?,locked?}`. `delay` is an integer
expected difference; locked edits follow targets. Markers are points `{id,t,label?}`
or spans `{id,from,to,label?}`. Dangling links, unexpected delay and changes/markers
past length remain readable as problems (`MISSING_EDGE`, `DELAY_MISMATCH`,
`BEYOND_LENGTH`, each with path/code/message). Structural errors are always refused.

`inspect` prints `{document,edges,problems}` with the owned normalized document
(including all signals, links and markers) and named actual transitions
`{id,signalId,t}`. `check` prints problems, exits 0 when empty and 1 when problems
or structural errors exist. Errors go to stderr; successful data goes to stdout.

## Preview and apply operations

Save `changes.json`:

```json
[
  { "op": "moveEdge", "edgeId": "tx_rise", "to": 2 },
  { "op": "updateDocument", "patch": { "title": "Adjusted timing" } }
]
```

```sh
node waveform-edit.mjs apply timing.json --ops changes.json
node waveform-edit.mjs apply timing.json --ops changes.json --write
node waveform-edit.mjs apply timing.json --ops changes.json --allow-problems --write
```

`edit` is an alias for `apply`. Both preview and write print the same
`{diff,problems}` JSON. Diff uses JSON Pointer entries. `--ops -` reads the JSON
operation array from stdin. Only `--write` replaces the source; writes use the
existing exclusive-lock/adjacent-temporary-file protocol with a source-content
check and atomic rename, preserving indentation, line endings and BOM. Any failed
operation leaves the source unchanged. Imports of the JavaScript module never
write files. Do not run preview then reuse the same move operation after writing:
operations target the document state at execution time.

| Operation      | Fields                                                   |
| -------------- | -------------------------------------------------------- |
| moveEdge       | `edgeId,to` or `signalId,t,to`                           |
| shiftRange     | `from,to,delta,signalIds?,includeMarkers?,followLocked?` |
| insertTicks    | `at,count`                                               |
| deleteTicks    | `from,to`                                                |
| setValue       | `signalId,from,to,value`                                 |
| encodeBits     | `signalId,bits,zeroHigh,oneHigh`                         |
| nameEdge       | `edgeId,name` or `signalId,t,name`                       |
| followLocked   | optional `edgeId`                                        |
| setSignal      | `signal` adds a lane or replaces the same ID in place    |
| setLinks       | `links` replaces the complete link list                  |
| setMarkers     | `markers` replaces the complete marker list              |
| updateDocument | `patch` with title/timescale/length/grid                 |

Ranges are half-open. Every operation must produce structurally valid state;
soft problems are checked after the complete batch. By default problems reject
apply; `--allow-problems` permits drafts, never structural errors. Named transition
loss, neighbour crossings and inconsistent locked plans are refused. moveEdge and
shiftRange follow locked links by default (`followLocked:false` opts out).
Specified delay controls target time; otherwise the previous offset is preserved.
Time insertion/deletion also warps annotations and grid offset. setValue splits
and restores range boundaries; setValue/encodeBits refuse to erase named edges.
For complex lane replacement/removal, prepare a validated replacement JSON or use
the module; unsupported operations are not silently accepted.

DShot encoding uses a bit grid. For a bit lane without protected names, with
24 ticks and 8 ticks/bit, encode 101 with:

```json
[{ "op": "encodeBits", "signalId": "tx", "bits": [1, 0, 1], "zeroHigh": 3, "oneHigh": 6 }]
```

High durations may be 0..ticksPerBit, so NRZ is supported too. The lane is replaced
with low idle outside the packet. This encoding example needs a fresh lane with
`changes:[[0,0]]`; the earlier example's tx_rise name protects its transition.

## SVG and JSON export

SVG uses the shared deterministic renderer, including bus/x/z text, causal links,
markers with collision-separated labels and tick/bit grids. Selection metadata
includes data-signal, data-edge-id, data-link and data-marker. Rendering flags:
`--from`, `--to`, `--tick-step`, `--pixels-per-tick`, `--lane-height`, `--label-width`
and `--id-prefix`, plus `--link-route auto|local|rail`. Window defaults to the whole capture. Pixel scales can be
fractional; times/tick-step stay integer. Prefix defaults to blockflow-waveform;
choose unique prefixes for multiple SVGs in one page. Rendering flags require SVG.

`--format json` writes normalized authoring data. `-o -` writes only SVG/JSON to
stdout. Export requires `-o`; output can overwrite an existing output file atomically,
but cannot alias the input source. Renderer display limits include 10000 grid lines,
512 lanes/links, 2048 markers, 50000 visible segments/edges and 10 million pixels.
Auto routes causal links through local target gutters, growing lane spacing to fit
36-pixel tracks. It falls back to an exterior rail beyond two intermediate lanes
or eight allocated tracks in a gutter. --link-route rail forces exterior routing;
local forces gutters up to 32 tracks/gutter, then reports a render limit. This is
rendering configuration only, not an authoring field. Delayed links show measured
endpoint tick positions and expected delay/unit; rail measurements use footer rows.
Short-interval labels shift beside the run to avoid strokes. All link drawing stays
inside the existing data-link group. Use the returned final lane y/height geometry
when positioning overlays; lane-height is a nominal minimum pitch.
Use a smaller window/coarser tick step when needed. Export retains draft problems;
use check when strict diagnostics are required. There is no PNG/browser dependency.

## Inspect and import VCD

```sh
node waveform-edit.mjs vcd-list capture.vcd
node waveform-edit.mjs import-vcd capture.vcd --signals top.clk,top.data --from 2 --to 8 -o imported.json
node waveform-edit.mjs import-vcd capture.vcd --timescale 1ps -o imported-ps.json
```

vcd-list prints `{signals:[{name,reference,width,type,scope}],timescale,firstTimestamp,lastTimestamp}`.
`name` includes a declared range suffix; `reference` omits it. Both scoped names
work with `--signals` (comma separated). Aliases retain declaration order.
Inspection validates the full capture without allocating initial/change buffers.
Source timestamp bounds include an implicit time-0 value event; both are 0 for
empty/time-0-only data. A time-0-only import defaults to length 1.

import-vcd writes normalized JSON to stdout unless `-o` is supplied. It never
replaces its VCD source. Supported declarations are wire/reg, including scopes,
aliases, scalar and binary x/z values. Values at the same timestamp keep the last
write. Unknown initial values are x. `--from/--to` are source ticks, rebase to 0
and retain the held initial state. `--timescale` converts 1/10/100 s/ms/us/ns/ps/fs
exactly; fractional resulting ticks are refused. Missing timescale uses tick.
`--title` overrides the imported title.

Both VCD commands accept `--max-bytes` (16 MiB), `--max-declarations` (100000),
`--max-changes` (200000). Import also accepts `--max-signals` (256 selected lanes).
An independent cap bounds tokens to 2 million. Bad declarations, values, scopes,
widths, timestamps and limits produce the same field-path errors as runtime APIs.

## JavaScript module

```js
import {
  inspectWaveform,
  parseWaveform,
  validateWaveform,
  waveformProblems,
  snapWaveformTime,
  applyWaveformOps,
  layoutWaveform,
  renderWaveformSvg,
  listVcdSignals,
  importVcd,
} from './waveform-edit.mjs';

const before = parseWaveform(raw);
const result = applyWaveformOps(before, operations, { allowProblems: false });
const svg = renderWaveformSvg(result.document);
const report = inspectWaveform(result.document);
```

The same runtime functions power the GUI and this CLI. APIs are synchronous and
pure with owned outputs; apply returns `{document,diff,problems}` and never mutates
the input. File writes belong to the CLI. inspectWaveform is a module convenience
wrapper. Snapping uses `snapWaveformTime(document,time,'tick'|'bit')`; layout returns
lane/segment/edge geometry and marker label geometry for SVG interaction.
