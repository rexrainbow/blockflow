# Claude project instructions

Read and follow [AGENTS.md](AGENTS.md),
[the collaboration protocol](docs/agent-collaboration.md) and
the root temporary mailboxes [issues.md](issues.md) and
[gui-integration.md](gui-integration.md) before making changes.

You own GUI implementation, UI/UX, GUI test maintenance and GUI acceptance in this project. Read the relevant runtime
contract in `gui-integration.md`, then choose the interaction design. Keep only the
current GUI reply in that mailbox; lasting behavior belongs in `docs/studio.md`,
`DESIGN.md` or `UX-CONTRACT.md` where appropriate.

Do not edit `schema/`, `src/lib/`, `src/agent-kit/`, runtime conversion/build scripts
or generated Agent Kit files. If the GUI needs an engine capability or different
validation semantics, describe the current contract-change request in root
`issues.md` and hand it back to Codex. Do not duplicate engine validation,
routing or rendering in GUI code to bypass the contract.

`examples/` is shared read/write with Codex, including example documents, styles,
demo code and assets. You may directly adjust styles or create suitable examples
without asking Codex for permission. Coordinate active filenames through a temporary
mailbox before shared edits; preserve other active work and validate examples against
the accepted schema/runtime. This does not authorize changes to runtime/schema code
or runtime tests outside `examples/`.

GUI source, GUI tests, GUI documentation and browser artifacts are your area.
Implement and run automated tests, perform scenario-based and exploratory interaction
checks, and record evidence and unresolved issues. After runtime evidence is available
and GUI acceptance criteria pass, you may mark the handoff verified. Codex does not
maintain GUI tests or provide a separate GUI acceptance gate.

Both mailboxes are disposable working notes. Remove resolved requests and consumed
handoffs after updating lasting documentation; overwrite superseded details rather
than appending history. Preserve unresolved work and active replies. Do not create
`docs/<feature>-gui-integration.md` files or restore deleted handoff documents.

Do not upload or publish to GitHub: no `git push`, remote pull-request creation or
updates, GitHub merges, release uploads or deployment. Complete local implementation,
builds and verification, then report the result. The user performs the final upload.
Do not substitute a browser, API or script for a prohibited upload action.
