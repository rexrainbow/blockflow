# Agent collaboration protocol

Codex owns schema, engine/runtime, converters and their validation. Claude owns GUI
implementation, UI/UX, GUI tests and GUI acceptance. The user assigns each agent work;
no automatic agent messaging or orchestration is required.

This file contains lasting collaboration rules. The two root communication files are
**temporary, replaceable working notes**, not versioned feature records, a backlog,
a changelog or a history of decisions.

## Ownership

| Area                                                                                                                                | Implementation owner                | Boundary                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema/`, `src/lib/`                                                                                                               | Codex                               | Authoring schema, validation, models, layout, routing, rendering, exports and shared runtime utilities                                                                                                       |
| `src/agent-kit/`, `agent-kit/`, conversion/validation scripts, `scripts/build-agent-kit.js`                                         | Codex                               | Converters and generated standalone kit; regenerate artifacts from sources                                                                                                                                   |
| `src/studio/`, remaining `src/editor/components/` and `src/editor/styles/`, `index.html`                                            | Claude                              | Presentation, interaction, GUI transactions/drafts, selection, application preferences and accessibility                                                                                                     |
| `src/editor/state/`, `src/editor/services/`, `src/editor/workers/`                                                                  | Codex by default; shared interface  | Shared commands/history and layout-worker adapters; Claude may consume them, but requests changes in the handoff                                                                                             |
| `tests/lib/`, `tests/schema/`, `tests/flowchart/`, `tests/editor/`, converter/Agent Kit tests, runtime fixtures outside `examples/` | Codex                               | Runtime behavior and test fixtures; example files belong to the shared examples area below                                                                                                                   |
| `tests/studio/`, GUI-specific tests, `e2e/` (including `dom.spec.js`), screenshots and browser reports                              | Claude                              | GUI test implementation/maintenance, automated checks, exploratory interaction checks and acceptance evidence                                                                                                |
| `docs/studio.md`, `DESIGN.md`, `UX-CONTRACT.md`                                                                                     | Claude                              | GUI behavior and design decisions, within the accepted runtime contract                                                                                                                                      |
| Runtime guides and schema/converter documentation                                                                                   | Codex                               | Domain contract and API documentation                                                                                                                                                                        |
| `examples/` (all contents, including the DOM viewer demo)                                                                           | Codex and Claude, shared read/write | Either agent may add/edit example data, styles, demo code, assets and supporting scripts without permission from the other; follow the accepted schema/runtime and coordinate active filenames               |
| `vite.config.js`, `vite.offline.config.js`, `vite.dom.config.js`, `playwright*.config.js`                                           | Claude                              | GUI/DOM-viewer builds and browser-test configuration; keep runtime aliases working and report changes                                                                                                        |
| `README.md`, `package.json`, lockfile, general checks, shared fixtures and temporary mailboxes                                      | Coordinate per task                 | Shared files, including `examples/` above, need the current editor, filenames and scope named in a mailbox before editing; single-owner files do not. A task-specific user assignment overrides this default |
| `AGENTS.md`, `CLAUDE.md`, this protocol                                                                                             | User                                | Agents propose changes; the user approves them before they are edited                                                                                                                                        |
| `dist*` browser artifacts                                                                                                           | Claude                              | Build from the agreed source revision, serialize writes, and report generated changes; do not hand-edit bundles                                                                                              |

Directory names do not change these rules: `src/lib/*/browser.js` and DOM view/export
code remain runtime-owned. Shared write access to `examples/` permits either agent
to adjust example styling, content and demos; it does not transfer ownership of the
runtime APIs they call or tests outside that directory. Do not bypass the accepted
contract in demo code or alter a sample just to hide a runtime defect.
A GUI-local command may compose validated runtime APIs
and update authoring data atomically, but may not replace engine validation, introduce
undocumented JSON fields, compute alternative diagram layout/routing or alter exported
SVG semantics. Shared invariants belong in the runtime. A test failure is routed to
the production-code owner rather than becoming permission to edit that code.

## Temporary communication files

| File at repository root                     | Purpose                                                                | Current writer/action                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [issues.md](../issues.md)                   | Unresolved runtime defects, capability requests and contract questions | Claude describes the problem; Codex records only the current answer or action        |
| [gui-integration.md](../gui-integration.md) | Current runtime-to-GUI contract handoff and GUI response               | Codex describes the available contract; Claude records integration/acceptance status |

Both agents read both files before work. Paths are relative to the repository root;
do not create duplicate copies under `docs/`. An empty mailbox means no work is
currently recorded; it is not evidence that earlier work was verified. If a mailbox
is absent, create only the short empty form when a task needs it, without recovering
old content from Git or chat.

Keep these files short:

- Keep only unresolved work, the next owner/action and information needed to proceed.
- Update the existing request/reply in place. Replace superseded requirements instead
  of appending revisions, dated updates or another copy of the same request.
- Preserve unresolved items and the other agent's active response. Read the latest
  content before writing; serialize edits to these shared files.
- Once the receiver has acted and the relevant checks pass, update lasting docs/tests
  as needed, then remove the resolved entry. Do not add completed lists, archives,
  history tables or per-feature documents.
- Never recreate deleted handoff documents. There is no requirement to use
  `docs/<feature>-gui-integration.md`; all temporary exchanges use these two files.
- Link to the current schema, API guide, tests and product docs instead of copying
  large specifications or test logs. Detailed logs/screenshots may stay in `output/`;
  retain only the current evidence needed for an unresolved handoff.

## Runtime contract handoff

The accepted current request defines intended cross-layer behavior. Schema and
runtime tests establish executable constraints; product/API documentation preserves
lasting behavior after a mailbox entry is removed. An unaccepted proposal in a
mailbox is not permission to change the contract. User decisions take precedence.

Codex writes only what Claude needs for the current integration:

- Available behavior, changed fields/defaults and compatibility policy.
- API/import paths, inputs/outputs, error paths and mutation/persistence rules.
- A minimal example, important invalid cases and runtime check results.
- Observable outcomes that Claude must verify through the GUI.

Codex does not prescribe pages, buttons, dialogs, gestures or screen layout. Claude
chooses those and updates `docs/studio.md`, `DESIGN.md` or `UX-CONTRACT.md` where
appropriate. Missing runtime capability becomes a current request in `issues.md`,
not a GUI workaround or a direct engine edit by Claude.

## Current handoff flow

1. Codex completes runtime work, updates lasting schema/examples/docs/Agent Kit and
   writes a concise current handoff in `gui-integration.md` with Claude as next owner.
2. Claude implements and tests the GUI. Replace the current status/reply in place;
   unresolved runtime questions go in `issues.md` with a minimal reproduction.
3. Codex resolves runtime questions and records the current answer. Claude reruns the
   relevant GUI checks. Each agent validates its own implementation area.
4. Claude completes GUI acceptance, updates lasting GUI docs and removes the consumed
   handoff. Remove resolved runtime requests as well. If work is blocked, retain only
   the blocker, useful current evidence and next action; never imply completion.

Suggested current statuses are runtime ready, GUI in progress, changes requested or
GUI acceptance pending. Verified is a completion condition used to clear an entry,
not a historical row to retain. The user can explicitly waive a check or reassign a
responsibility; apply that current instruction without accumulating decision history.

## GUI verification — Claude

Claude owns GUI test implementation and maintenance, automated browser checks,
scenario-based acceptance, visual inspection and exploratory interaction testing.
Check schema/runtime integration, data preservation, Undo/Redo, focus/keyboard behavior,
error recovery, save/reload/export, responsiveness and accessibility as relevant.
Record exact commands, results and the tested snapshot; automated test success alone
is not evidence that visual quality or interaction behavior has been inspected.

A defect report includes reproduction steps, expected and actual behavior, the affected
contract/acceptance criterion and evidence. Claude fixes GUI defects and hands suspected
runtime defects to Codex, including minimal authoring JSON or API reproduction where
possible. Codex reproduces and verifies runtime issues at the runtime/API level rather
than maintaining GUI tests or acting as a GUI acceptance reviewer. Claude reruns the
relevant GUI checks after a runtime fix. Tests follow the accepted contract.

## Concurrent work and reproducibility

Use separate branches/worktrees when both agents run concurrently. Agree on the
contract revision before GUI integration. This protocol does not authorize local
commits or merges.

GitHub upload and publication are exclusively the user's responsibility. Neither
Codex nor Claude may push commits/tags, create or update remote pull requests, merge
on GitHub, upload release assets, publish/deploy the project or trigger a remote
workflow to perform those actions. This applies equally to Git/CLI, APIs, browser
interaction and scripts. Local builds, tests and handoff documents may be completed
within the assigned scope; finish by reporting changed files and validation evidence.
The user performs the final upload. A feature being marked verified never authorizes
an upload or publication step.

In a shared dirty checkout, serialize editing/building/testing; never stage, reset or
overwrite another task's files. Before testing, record `git rev-parse HEAD`, relevant
dirty paths and, when needed, source hashes. A HEAD hash alone does not identify an
uncommitted test subject. Artifacts and test results must match the same source snapshot.

Current statuses and assignments in the mailboxes are coordination conventions, not enforceable
filesystem permissions. Stronger isolation requires separate worktrees or access
controls. Do not run two builds that write the same output directory concurrently.

## Short mailbox formats

Use only the fields needed for the active request. Do not create a feature record or
keep filled templates after completion.

For `issues.md`:

```markdown
# Current runtime questions and issues

## Current request

Topic / next owner / next action:
Expected vs actual behavior, or missing capability:
Minimal JSON/API reproduction and current evidence:
Current answer / unresolved question:
```

For `gui-integration.md`:

```markdown
# Current GUI handoff

## Current work

Topic / status / next owner / next action:
Contract/API reference and concise behavior changes:
Runtime evidence and relevant source snapshot:
GUI acceptance outcomes:
Current Claude response / unresolved blocker:
```

When no work remains, leave the heading, a short temporary-mailbox reminder and
"No open request" or "No active handoff". Lasting ownership and GitHub rules remain
in this protocol and the agent entry instructions, never solely in a mailbox.
