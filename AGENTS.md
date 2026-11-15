# Agent instructions

Read [the collaboration protocol](docs/agent-collaboration.md) and
the root temporary mailboxes [issues.md](issues.md) and
[gui-integration.md](gui-integration.md) before making changes.
These rules apply to the whole repository. Explicit user instructions take precedence.

- **Codex owns schema, engine/runtime, converters and their contracts.** Codex implements
  and verifies this area and publishes runtime contracts. GUI development, test
  maintenance and GUI acceptance are outside this assignment.
- **Claude owns GUI implementation, UI/UX, GUI tests and GUI acceptance.** Claude consumes the engine
  contracts and must not edit schema, engine/runtime or converters to accommodate GUI
  behavior. Request a runtime contract change through `issues.md` instead.
- **`examples/` is read/write for both Codex and Claude.** Both may add or modify
  example documents, styles, demo code and assets under that directory. No approval
  from the other agent is needed; coordinate active filenames to avoid concurrent
  edits. Examples must follow the accepted schema/runtime contract. This permission
  does not extend to engine/schema code or tests outside `examples/`.
- Read access is allowed across both areas. Each agent maintains and runs validation
  for its own area; Claude may run runtime checks when integrating the GUI. GUI defects
  stay with Claude; runtime defects are handed to Codex. Never weaken assertions to hide
  a defect.
- Write current runtime-to-GUI handoffs in root `gui-integration.md`, and current
  runtime questions/defects in root `issues.md`, not only in chat. These are temporary,
  replaceable mailboxes, not a backlog or change history. Remove resolved entries;
  replace superseded requirements instead of appending revisions. Preserve unresolved
  work and the other agent's active reply. Do not create per-feature handoff files or
  restore deleted ones. Keep lasting specifications in the appropriate product/API docs.
  Runtime handoffs define
  behavior, APIs, errors, data ownership and acceptance criteria; they do not prescribe
  controls, dialogs, gestures or screen layout. Claude records those GUI decisions.
- Before editing a shared file, record the current assignment in the relevant mailbox.
  Preserve existing staged and unstaged work. Do not revert another agent's changes.
  Use separate worktrees for concurrent work; serialize changes and builds in a
  shared checkout. Never treat a document status as an exclusive filesystem lock.
- Do not automatically spawn, message or launch another agent. Repository handoffs
  are read by the next agent when the user assigns that agent its task.
- **GitHub upload and publication belong to the user.** Neither Codex nor Claude
  runs `git push`, creates/updates remote pull requests, merges on GitHub, uploads
  release assets or publishes/deploys the project. This applies to CLI, API, browser
  actions and scripts. Finish local work and report changes and validation results;
  the user performs the final upload. Local commits are not authorized by this rule.

See the protocol's ownership table for shared browser/worker adapters, tests, build
configuration and generated artifacts. If ownership is unclear, inspect first and
record a proposed assignment before editing; do not assume ownership from a filename.
