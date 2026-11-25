# Blockflow Agent Kit

Blockflow combines **Blockchart** (hardware block diagrams), **Flowchart** (process
diagrams) and **Statechart** (flat FSM diagrams). This offline kit contains eight files. Choose the converter and Schema for the
diagram domain; their JSON formats are separate.

| Domain                     | Converter                | Schema                   | Input                                      | Output    |
| -------------------------- | ------------------------ | ------------------------ | ------------------------------------------ | --------- |
| Hardware / signal diagrams | `blockchart-convert.mjs` | `blockchart.schema.json` | Blockchart JSON                            | JSON, SVG |
| Process / control flow     | `flowchart-convert.mjs`  | `flowchart.schema.json`  | Mermaid Flowchart subset or Flowchart JSON | JSON, SVG |
| Flat state machines        | `statechart-convert.mjs` | `statechart.schema.json` | stateDiagram-v2 subset or Statechart JSON  | JSON, SVG |

`blockchart-edit.mjs` provides local Blockchart inspection and transactional editing as a CLI and JavaScript module.

All converters contain their own validator, ELK layout and SVG renderer. Requires
**Node.js 22.12+**; no npm install, project source, browser, server or network is needed.
Move this folder to any location. Each converter can run independently; its Schema and
this guide help agents author input. The converters interpret neither screenshots nor
natural language: an agent translates those sources into Mermaid or domain-specific JSON.

- Blockchart build: `{{BLOCKCHART_KIT_VERSION}}`
- Flowchart build: `{{FLOWCHART_KIT_VERSION}}`
- Statechart build: `{{STATECHART_KIT_VERSION}}`

## Quick start

```sh
node blockchart-convert.mjs hardware.json --check
node blockchart-convert.mjs hardware.json --output hardware.svg
node blockchart-edit.mjs inspect hardware.json --group Processing --recursive

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

In the source checkout, `npm run build:agent-kit` regenerates all converters and Schemas
and this README together. `build:agent-kit:blockchart` remains an alias for this complete
build, so it cannot overwrite the shared guide with an incomplete version. The domain guides below are generated from maintained templates. Each converter embeds the ELK
license attribution; its full license appears at the end of this README.
