# Synchronous waveform runtime

Phase 1 implements integer-time waveforms in `schema/waveform.schema.json` and
`src/lib/waveform/index.js`. The runtime owns normalization, validation, stored-state
checks, editing, SVG geometry and VCD import. Claude owns the editor page and GUI
acceptance. Story chapter embedding is covered by [Story runtime](story-runtime.md).
The standalone [Waveform Agent Kit](waveform-agent-kit-readme.md) provides
waveform-edit.mjs for editing/rendering/VCD. WaveDrom remains a later phase.

## API

```js
import {
  parseWaveform,
  validateWaveform,
  waveformProblems,
  snapWaveformTime,
  applyWaveformOps,
  layoutWaveform,
  renderWaveformSvg,
  importVcd,
  listVcdSignals,
} from '../src/lib/waveform/index.js';

const document = parseWaveform(input);
const problems = waveformProblems(document);
const result = applyWaveformOps(document, [{ op: 'moveEdge', edgeId: 'trigger_start', to: 1 }]);
const svg = renderWaveformSvg(result.document);
```

All calls are synchronous, DOM independent and perform no filesystem/network work.
Input objects are retained intact. Normalized results and edit results own their
data. Errors contain `path` and a field/operation path in the message.
`validateWaveform` checks structure and returns `{ok:true}`. `waveformProblems`
checks structurally valid stored state. Parsing/rendering never follows a link or
moves an edge as a side effect.

## Document

A document contains format `blockflow-waveform`, version 1, title (default
`Waveform`), nonempty timescale text, positive length and ordered signals. All
times are nonnegative safe integer ticks; phase 1 rejects fractional times.
The time interval displayed is `[0,length]`, with value segments half-open.
A change exactly at length is permitted. Timescale is descriptive, such as `clk`
or `1ns`. It does not silently convert timestamps.

Optional `grid: {ticksPerBit,offset}` defines a uniform bit grid. ticksPerBit is a
positive integer and offset defaults to 0. It is a drawing/snapping guide, not a
constraint that every transition must land on a bit boundary. `snapWaveformTime`
rounds finite interaction coordinates to the nearest integer tick or existing bit
boundary (`level: 'tick' | 'bit'`). Ties go later, results are bounded by the capture,
and bit snapping requires a bit boundary in the capture. It does not scan lanes.

Signals contain `id`, optional label (defaults to id), positive width, optional
scope text, optional Blockchart `port: 'Module.port'`, changes and optional
`style: {color: '#RRGGBB'}`. Scope is a display path, not a clock domain. Port is
syntax-checked here. Story integration uses `wiresForPort` to resolve rendered
connectivity; absent/unconnected ports have no associated wires. See
[Story runtime](story-runtime.md#references-and-fingerprints).
Signal, edge and marker IDs use `[A-Za-z_][\w.-]*`, with separate namespaces.
Signal IDs and marker IDs are unique in their lists; edge IDs are document-wide.
Text must be XML representable. Bus text is limited to 4096 characters; widths to
4096 bits.

Changes use `[t,value,edgeId?]`. Each lane requires an initial value at 0, followed
by strictly increasing times and actual value changes. Equality is exact JSON
scalar equality. Bit values are numeric 0/1 or lowercase x/z. Bus values are
nonnegative safe integers or nonempty display text. Numeric decimal/0x/0b text
must fit the bus. Explicit `b[01xz]+` vectors must fit its width. General text and
whole-bus x/z labels are supported. Wider exact values can use vector/numeric text.
Only real transitions after time 0 can be link endpoints. Initial values may carry
names but cannot be linked or moved away from 0.

Phase-1 tuples remain readable when later phases widen time types or introduce
optional per-change min/max metadata. Phase 1 accepts only two/three-item tuples
and has no uncertainty or clock-domain interpretation today.

## Links, markers and checks

Links contain `from`/`to` edge IDs and optional label, nonnegative expected delay
and boolean locked. References use names, never stored indices or timestamps.
Dangling links are retained and produce `MISSING_EDGE` problems at links[i].from/to.
A reference resolving to an initial/non-transition value is structurally invalid.
Duplicate links may describe the same pair and share its SVG selection identity.

`DELAY_MISMATCH` reports actual target-minus-source time differing from delay.
`BEYOND_LENGTH` reports changes and markers outside length. Every problem contains
`{path,code,message}`. A cursor marker is `{id,t,label?}`; a span is
`{id,from,to,label?}` with from < to. Markers do not create edge identities.

## Transactional operations

`applyWaveformOps(document, operations, {allowProblems:false})` returns
`{document,diff,problems}`. Diff uses the existing JSON Pointer format. The original
is unchanged on success or failure. Operations must produce structurally valid
state individually; stored-state problems are checked after the complete batch.
Missing links can therefore be repaired by a later operation. Unknown operation
fields fail. `allowProblems:true` permits draft missing/delay/length problems; it
never bypasses structural errors or named-edge protections.

| Operation      | Fields and behavior                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| moveEdge       | `edgeId,to`, or `signalId,t,to` for an unnamed transition. It never sorts across neighbours.                                                                                                                 |
| shiftRange     | `from,to,delta`, optional distinct `signalIds`. Moves changes in [from,to). Initial values remain at 0; an attempt to shift one fails.                                                                       |
| insertTicks    | `at,count` with positive count. Extends length, holds existing values, shifts later transitions/annotations and the first-bit offset. Inserting at 0 retains initial values at 0.                            |
| deleteTicks    | `from,to` within length. Removes that duration, rebases later changes, holds the state at to at the cut boundary, coalesces unnamed repeats and shortens length. A full-duration cut is refused.             |
| setValue       | `signalId,from,to,value`. Sets [from,to), splits boundaries and coalesces values.                                                                                                                            |
| encodeBits     | `signalId,bits,zeroHigh,oneHigh`. Replaces a bit lane using grid period/offset, with low idle outside the packet. High durations range from 0 through ticksPerBit, supporting NRZ as well as DShot 6/3 of 8. |
| nameEdge       | Select by `signalId,t` or an existing `edgeId`, and supply `name`. References can be updated in the same batch with setLinks.                                                                                |
| followLocked   | Optional `edgeId` chooses the starting source; otherwise follows all locked components.                                                                                                                      |
| setSignal      | `signal` adds a lane or replaces the lane of the same id at its existing position.                                                                                                                           |
| setLinks       | `links` replaces the complete link list.                                                                                                                                                                     |
| setMarkers     | `markers` replaces the complete annotation list.                                                                                                                                                             |
| updateDocument | `patch` can set title, timescale, length and grid.                                                                                                                                                           |

moveEdge/shiftRange follow outgoing locked links by default; `followLocked:false`
disables that behavior for that operation. With expected delay, target time is
source time plus delay. Without delay, the previous source-target offset is
preserved. Plans are committed together; conflicting converging paths, impossible
cycles, negative times and crossings of neighbours reject the operation. Consistent
cycles terminate. Reading a file never performs this editing behavior.

shiftRange moves annotations by default when all lanes are selected, and leaves
them in place when signalIds is supplied. `includeMarkers` overrides that choice.
Time insertion/deletion moves marker endpoints and offset but preserves the bit
period and declared expected link delays. It can therefore produce a delay problem;
repair links/follow them explicitly in the batch or allow a draft problem. Deleting
referenced edges is refused; remove their links first if deletion is intended.
Spans entirely erased by a cut are removed, while point markers inside it clamp
to its start. setValue/encodeBits refuse to erase named transitions. Explicit lane
replacement remains available, with final reference checking.

## SVG and geometry

`layoutWaveform` returns an owned document and display geometry including lane y,
visible segments and edges. `renderWaveformSvg` uses this geometry. Options are
`from`, `to` (default entire capture), pixelsPerTick (24), laneHeight (56, minimum
40), labelWidth (160, minimum 40), tickStep (1) and idPrefix (default
`blockflow-waveform`, identifier syntax), and linkRoute (auto). Pixel dimensions can be fractional;
model times remain integer. Choose different idPrefix values for multiple inline
SVGs sharing a page. Labels are on the left, with clipping; bus segment text is
clipped to the segment. x/z have distinct labelled drawing.

### Local causal links and rail fallback

`linkRoute: 'auto' | 'local' | 'rail'` is a **renderer option only**. Authoring
schema/data stay unchanged; do not save route/linkRoute on a waveform or link.
The default auto mode routes locally when at most two lanes lie between endpoints
(index distance <=3) and the chosen gutter has fewer than eight allocated tracks.
Otherwise it uses a right-hand rail, with reason distance or tracks. Explicit rail
forces that topology; local overrides the auto thresholds, up to 32 tracks per gutter
(an explicit render.links error beyond that). Visible links allocate in author order;
duplicate pairs get separate tracks but keep the same selection identity.
Missing or out-of-view endpoints consume no tracks and are skipped in SVG, retained
in authoring data.

A local link travels vertically at the source tick, horizontally through the gutter
next to the target, then vertically into the target edge. Only vertical segments
cross intermediate lanes. The gutter is on the source-facing side of the target;
a same-lane loop uses the next gutter, or the preceding gutter for the last lane.
A single-lane loop gets a gutter below that lane. Tracks are 36 pixels apart, with
16 pixels of total padding and 24 pixels reserved for the waveform bands. Gutters
grow as needed; laneHeight is the nominal minimum pitch, not a uniform final pitch.
Each `lanes[i].y` is authoritative. Incoming arrows point down or up as appropriate.

A delayed link adds thin tick-extension/dimension strokes between actual endpoint
x coordinates. Its label combines optional authored text and expected delay/unit,
e.g. start HI / 1 clk (a middle dot separates them in SVG). SI scales use a multiplier,
e.g. 2 x 1ns. The value is the authored expected delay, even for a draft mismatch;
rendering does not change endpoints. Zero-distance measurements remain explicit.
Without delay, only the optional authored label is shown. Text too wide for the
interval moves beside the run; labels avoid route strokes and earlier labels.
SVG width grows as necessary. A rail link with delay has a dedicated measurement
row below the lanes (36 pixels/row), since no free local track is guaranteed;
marker label rows follow these measurements. The rail path retains the exterior
orthogonal topology and does not traverse that measurement row.

`layoutWaveform` adds `gutters:[{index,top,bottom,trackCount}]` and `linkRoutes`:
`{index,link,route,reason?,gutter?,track?,from,to,points,label?,dimension?}`.
Endpoint geometry contains signalIndex/signalId/t/x/y; points are ordered x/y pairs;
labels contain text/x/y/width; dimension contains x1/x2/y/delay. Only rendered links
appear. Gutter index is the lane above it (single-lane footer: 0). Geometry is owned
and deterministic for the same input/options. Existing explicit display limits apply.

The outer link group keeps data-link/data-from-edge/data-to-edge and adds data-route.
All route strokes, incoming arrow, label and dimension strokes remain inside it;
roles are link-path, link-arrow, link-label and delay-dimension (with data-delay).
Consumers select the whole link group by its existing identity. Story waveformView
uses these final lane y values and SVG dimensions without recomputing layout.

### Marker labels and SVG identity

Visible marker labels are sorted by displayed start (author order breaks ties),
then assigned the first row with at least 8 pixels of horizontal clearance. This
also handles nearby ticks and spans clipped to the same window boundary. Rows
are 20 pixels apart; SVG height grows to fit without extending the signal plot.
`layoutWaveform` exposes `plotBottom` and `markerLabels` entries containing
`id`, `x`, `y`, `width` and `row`. Label text exposes `data-role="marker-label"`
inside the existing `data-marker` group. Off-window/unlabelled markers reserve
no label rows. This is display geometry only; authoring order/data do not change.

| SVG identity                               | Meaning                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| data-signal                                | Lane/segment/edge signal ID. Lane groups optionally expose data-port.                 |
| data-role=value-segment, data-from/data-to | The visible half-open tick interval of a value segment.                               |
| data-edge                                  | Transient signal:t selector for each visible transition.                              |
| data-edge-id                               | Stable edge name, present only when authored.                                         |
| data-link                                  | Stable `from -> to` edge-name pair on the group containing its path, arrow and label. |
| data-from-edge/data-to-edge                | The two edge IDs of that link.                                                        |
| data-marker                                | Marker or span ID on its drawing group.                                               |
| data-role=tick-grid / bit-grid             | Tick/bit grid lines, with data-t and optional data-bit.                               |

SVG is escaped and deterministic for identical input/options. Grid output is
limited to 10000 lines, lanes/links to 512 each, annotations to 2048, visible
segments plus edges to 50000, forced-local tracks to 32 per gutter, and dimensions
to 10 million pixels. Exceeding a limit
reports a field-path error. Use a narrower time window or coarser tickStep for
large captures; a smaller window also bounds bit-grid output.

## VCD import

`importVcd(text, options)` reads the wire/reg subset: timescale, scope/upscope,
var declarations including identifier aliases and optional ranges, enddefinitions,
dump blocks, nondecreasing integer timestamps, scalar 0/1/x/z and binary vectors.
Real/strength/other declaration types are rejected clearly. Short vectors are
zero-extended, or x/z-extended when their leading state is unknown/high impedance.
Bus vectors remain exact padded b-text; scalars become bit values. Same-timestamp
writes keep the last value; redundant changes coalesce. Undumped initial state is
x. Generated IDs are sanitized full hierarchy names with deterministic collision
suffixes; label/scope retain the original reference and hierarchy. Import creates
no edge IDs or causal links.

Options `signals` chooses exact scoped VCD references, with or without the declared
range suffix (for example top.data or top.data[3:0]). Unknown selections fail.
`from/to` select a source-tick window; output rebases to 0 with the held value at
its beginning. The default end is the final timestamp, or 1 for a time-0-only dump.
Changes exactly at the end are retained. `timescale` optionally converts SI
1/10/100 s/ms/us/ns/ps/fs units using exact arithmetic. Fractional converted ticks
are refused. `title` sets the resulting title.

Defaults bound UTF-8 input to 16 MiB, selected signals to 256 and processed/stored
changes to 200000. maxBytes/maxSignals/maxChanges can be supplied explicitly.
Declarations default to a limit of 100000 (`maxDeclarations` can override it);
an independent cap bounds tokens to 2 million. Aliases
count toward selected lanes and stored changes. Unselected vectors do not allocate
initial-value buffers. Unknown identifier codes, width mismatches, decreasing time,
unsupported values and unterminated directives/dumps fail with paths. Data with
no timescale uses tick and can be imported without physical conversion.

### Inspect VCD before importing

`listVcdSignals(text, { maxBytes, maxDeclarations, maxChanges })` uses the same
parser and field-path errors as import, validating the full capture without
allocating initial values or change buffers. Options have the same defaults as
import. `maxChanges` bounds processed value tokens; selected/stored lane limits
do not apply to inspection. Malformed values/dumps after the header still fail.

```js
import { listVcdSignals, importVcd } from '../src/lib/waveform/index.js';
const capture = listVcdSignals(text);
// capture.signals: [{ name: 'top.data[3:0]', reference: 'top.data',
//                     width: 4, type: 'reg', scope: 'top' }, ...]
// capture.timescale: '1ns'
// capture.firstTimestamp: 0; capture.lastTimestamp: 16
const waveform = importVcd(text, { signals: [capture.signals[0].name] });
```

`name` includes the declared range suffix; `reference` omits that suffix.
Both are scoped names accepted by `importVcd` selection. `scope` is the dotted
scope path, empty at the root. Aliases are separate entries in declaration order.
The result contains no imported waveform or `changes`. Timestamps are source ticks:
the first explicit timestamp or implicit time-0 value event, and the last timestamp.
Both are 0 for a capture with no timestamps/value events. A time-0-only import
still defaults to duration 1, as documented above; inspection reports the actual 0.
Missing timescale returns `tick`; inspection does not perform time conversion.

## Fixtures and integration

`tests/fixtures/waveform/dshot.json` includes a bit clock, trigger, HI timer,
1/0/1 DShot data, receiver sampling, locked links, a bus and annotations.
`small.vcd` covers scope, vector, scalar and x/z input. Runtime tests cover schema
agreement, ownership, editing rollback, locked chains/cycles, integer snapping,
SVG identities/XML, local gutter growth/rail thresholds and bounded VCD/window/conversion behavior.
`local-routing.json` adds shared gutters, an upward link and a far rail fallback. The renderer needs
no GUI geometry, and the GUI can consume the same API and metadata directly.
