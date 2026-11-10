# Blockflow Agent Kit

Blockflow combines **Blockchart** (hardware block diagrams) and **Flowchart** (process
diagrams). This offline kit contains five files. Choose the converter and Schema for the
diagram domain; their JSON formats are separate.

| Domain                     | Converter                | Schema                   | Input                                      | Output    |
| -------------------------- | ------------------------ | ------------------------ | ------------------------------------------ | --------- |
| Hardware / signal diagrams | `blockchart-convert.mjs` | `blockchart.schema.json` | Blockchart JSON                            | JSON, SVG |
| Process / control flow     | `flowchart-convert.mjs`  | `flowchart.schema.json`  | Mermaid Flowchart subset or Flowchart JSON | JSON, SVG |

Both converters contain their own validator, ELK layout and SVG renderer. Requires
**Node.js 22.12+**; no npm install, project source, browser, server or network is needed.
Move this folder to any location. Either converter can run independently; its Schema and
this guide help agents author input. The converters interpret neither screenshots nor
natural language: an agent translates those sources into Mermaid or domain-specific JSON.

- Blockchart build: `{{BLOCKCHART_KIT_VERSION}}`
- Flowchart build: `{{FLOWCHART_KIT_VERSION}}`

## Quick start

```sh
node blockchart-convert.mjs hardware.json --check
node blockchart-convert.mjs hardware.json --output hardware.svg

node flowchart-convert.mjs process.mmd --check
node flowchart-convert.mjs process.mmd --output process.json
node flowchart-convert.mjs process.json --output process.svg
node flowchart-convert.mjs process.mmd --output - --format svg
```

Run `node <converter>.mjs --help` for flags and `--version` for its build ID. The Flowchart
text syntax is a documented subset, not the complete Mermaid language. Both standalone
tools export JSON and SVG. For PNG, the full project offers SVG-to-PNG exports and the
Flowchart project CLI (`npm run flowchart -- process.json --output process.png --scale 2`).
Native Sharp dependencies are intentionally kept outside these single-file converters.

## Maintainers

In the source checkout, `npm run build:agent-kit` regenerates both converters, both Schemas
and this README together. `build:agent-kit:blockchart` remains an alias for this complete
build, so it cannot overwrite the shared guide with an incomplete version. The two
domain guides below are generated from maintained templates. Each bundle embeds the ELK
license attribution; its full license appears at the end of this README.
