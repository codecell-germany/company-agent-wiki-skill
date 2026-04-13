# Known Limitations

## Product Scope

- Phase 1 only understands local Markdown roots.
- Connectors for e-mail, notes, CRM, chat or audio are not implemented.
- The web view is read-only.
- The CLI only materializes onboarding-generated draft starter documents from an explicit answers file.
- The onboarding flow is not a built-in interactive prompt loop; the agent still has to conduct the conversation and produce the answers file.

## Index Model

- Root freshness is based on file path, size and mtime snapshots, not on deep content hashing for every query.
- The SQLite index is rebuilt wholesale through `index rebuild`; there is no incremental mutation journal yet.
- Auto-rebuild is opt-in. Without `--auto-rebuild`, stale or missing indexes still block retrieval on purpose.
- Search quality depends on document structure and heading hygiene in the source Markdown.
- Front-matter filters are currently focused on common fields such as `type`, `status`, `tags`, `project`, `department`, `owners` and `systems`; there is not yet a generic arbitrary-field query language.
- The SQLite runtime is more tolerant of transient contention now, but the same workspace should still not be hammered by multiple parallel agent reads if that can be avoided.
- Search JSON now exposes a normalized `score` plus `rawScore`; the normalized value is better for agents, but it is still only a ranking aid, not a calibrated relevance percentage.

## Git Model

- History and diff only work for files inside a Git repository.
- Phase 1 does not auto-commit workspace changes.
- Restore flows are not implemented in the web view.

## Security Model

- The CLI can initialize a private Git remote URL, but it does not validate remote policy or access controls.
- The package does not enforce OS-level filesystem permissions; the workspace owner must place the private workspace in a properly protected location.
