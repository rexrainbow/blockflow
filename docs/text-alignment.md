# Text alignment across diagram domains

`textAlign` accepts `left`, `center` or `right` in text-bearing styles. It aligns
lines **inside the existing measured text block**, not the block inside its owner.
The longest line defines the width. Alignment does not change text measurement,
padding, backgrounds, hit bounds, node dimensions, label placement or wire geometry.
Single-line labels keep their existing placement under every alignment setting.
Omission preserves the renderer's existing role-specific alignment (including
port labels and group titles); it does not force all text to center.

Set global defaults and override locally through the existing style hierarchy.
Remove the field to inherit. `null`, `inherit`, SVG's `start`/`end` and values other
than the three enum strings are invalid. This is visual left/right alignment,
not bidirectional language shaping or a wrapping/max-width option.

| Domain     | Global defaults                                                                                                                    | Local overrides                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Blockchart | `diagram.style.text.textAlign`; type defaults under module/group label or port-label sections, connection.label, terminal, caption | Existing block/group label and port-label styles; port, terminal and connection label styles |
| Flowchart  | `diagram.style.node/note/edge/group.textAlign`                                                                                     | Corresponding `style.textAlign`                                                              |
| Statechart | `diagram.style.state/transition.textAlign`                                                                                         | State or transition `style.textAlign`                                                        |

For example, a Blockchart block uses `style.label.textAlign`, not a root block
`style.textAlign`; a Flowchart node uses `style.textAlign` directly. The existing
schemas retain their distinct style structures. No Mermaid style directive for
alignment is introduced; use JSON.

Statechart additionally permits `descriptionAlign` on state styles only. It
controls the description/body independently of the state name. A local
`descriptionAlign` overrides the global state's `descriptionAlign`. If neither is
set, the body inherits the **resolved** state `textAlign`; if that is also omitted,
the existing centered rendering is retained. Each section uses its own longest
line. A centered name with a left-aligned action/output list can therefore use
`textAlign: "center", descriptionAlign: "left"`. Pseudostates have no text to align.

`graphDocument()` lowers Statechart styles into Flowchart styles and intentionally
omits the state-only `descriptionAlign`. Statechart layout state styles retain an
explicit inherited/overridden `descriptionAlign`; rendering falls back to their
resolved `textAlign`. Do not save computed layout styles as authoring defaults.

The shared `alignedTextPosition` helper converts the existing block anchor to a
left boundary, then selects the SVG start/middle/end anchor without mutating the
position. Rendering uses this after layout. All three schemas, runtime validators
and standalone converters support the fields. Examples live under
`examples/text-alignment/`; tests in `tests/lib/text-alignment.test.js` cover bounds,
inheritance, immutable geometry, schema rejection and SVG/PNG rendering.
