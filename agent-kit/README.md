# Blockflow Agent Kit

Blockflow combines **Blockchart** (hardware block diagrams), **Flowchart** (process
diagrams) and **Statechart** (flat FSM diagrams). This offline kit includes standalone
tools, schemas and linked guides. Choose the converter and Schema for the diagram
domain; their JSON formats are separate.

| Domain                     | Converter                | Schema                   | Input                                      | Output    |
| -------------------------- | ------------------------ | ------------------------ | ------------------------------------------ | --------- |
| Hardware / signal diagrams | `blockchart-convert.mjs` | `blockchart.schema.json` | Blockchart JSON                            | JSON, SVG |
| Process / control flow     | `flowchart-convert.mjs`  | `flowchart.schema.json`  | Mermaid Flowchart subset or Flowchart JSON | JSON, SVG |
| Flat state machines        | `statechart-convert.mjs` | `statechart.schema.json` | stateDiagram-v2 subset or Statechart JSON  | JSON, SVG |

`waveform-edit.mjs` inspects, checks, edits and renders timing waveforms, and imports VCD captures.

`story-edit.mjs` inspects, checks, transactionally edits, exports and extracts Blockchart Stories.

`blockchart-edit.mjs` provides local Blockchart inspection and transactional editing as a CLI and JavaScript module.

All converters contain their own validator, ELK layout and SVG renderer. Requires
**Node.js 22.12+**; no npm install, project source, browser, server or network is needed.
Move this folder to any location. Each converter can run independently; its Schema and
this guide help agents author input. The converters interpret neither screenshots nor
natural language: an agent translates those sources into Mermaid or domain-specific JSON.

- Blockchart build: `blockchart-agent-kit-23be7e737990fd0d41d1`
- Flowchart build: `flowchart-agent-kit-b7a38f31e9271ee2e379`
- Statechart build: `statechart-agent-kit-d932343d6d614decb575`
- Story build: `story-agent-kit-23be7e737990fd0d41d1`
- Waveform build: `waveform-agent-kit-23be7e737990fd0d41d1`

## Guides

Run commands and import examples from the Agent Kit root, containing this README.
The guides and license use relative links and remain available when the whole folder
is moved or read offline.

| Task                                               | Guide                                         |
| -------------------------------------------------- | --------------------------------------------- |
| Author and render hardware diagrams                | [Blockchart](docs/blockchart.md)              |
| Inspect and edit modules, Grids, Nets and branches | [Blockchart editing](docs/blockchart-edit.md) |
| Convert Mermaid process diagrams                   | [Flowchart](docs/flowchart.md)                |
| Author flat state machines                         | [Statechart](docs/statechart.md)              |
| Inspect, edit and export stepped presentations     | [Story](docs/story.md)                        |
| Edit timing waveforms and import VCD captures      | [Waveform](docs/waveform.md)                  |
| Read the bundled third-party license               | [elkjs EPL-2.0](licenses/elkjs-EPL-2.0.md)    |

## Quick start

```sh
node blockchart-convert.mjs hardware.json --check
node blockchart-convert.mjs hardware.json --output hardware.svg
node blockchart-edit.mjs inspect hardware.json --group Processing --recursive
node story-edit.mjs inspect hardware.json draft.story.json
node waveform-edit.mjs inspect timing.json
node waveform-edit.mjs export timing.json -o timing.svg

node flowchart-convert.mjs process.mmd --check
node flowchart-convert.mjs process.mmd --output process.json
node flowchart-convert.mjs process.json --output process.svg
node flowchart-convert.mjs process.mmd --output - --format svg
```

Run `node <converter>.mjs --help` for flags and `--version` for its build ID. The Flowchart
text syntax is a documented subset, not the complete Mermaid language. All standalone
converters export JSON and SVG. For PNG, the full project offers SVG-to-PNG exports and the
Flowchart project CLI (`npm run flowchart -- process.json --output process.png --scale 2`).
Native Sharp dependencies are intentionally kept outside these single-file converters.

## Maintainers

In the source checkout, `npm run build:agent-kit` regenerates all tools, schemas,
README, guides and license together from maintained templates.
`build:agent-kit:blockchart` remains an alias for this complete build. Each converter
and the Story module embeds elkjs attribution. The full license is available in
[licenses/elkjs-EPL-2.0.md](licenses/elkjs-EPL-2.0.md).
