# Architecture

## Scope

Phase 1 delivers a publishable CLI and a shared agent skill for a private, local company knowledge workspace.

The implementation is intentionally limited to:

- file-based Markdown roots
- a derived SQLite index
- Git-aware verification and history views
- a read-only local web view

Phase 1 excludes connectors, ingestion pipelines and GUI editing.

## Core Principles

1. Markdown files are the source of truth.
2. SQLite is a rebuildable, derived index.
3. Git remains the audit and rollback layer for tracked content.
4. Agent access goes through the public CLI contract.
5. The code repository and the private knowledge workspace stay separate.

## Workspace Model

The CLI scaffolds a private workspace with:

- `.company-agent-wiki/workspace.json` as tracked workspace metadata
- `.company-agent-wiki/index.sqlite` as the derived search index
- `.company-agent-wiki/index-manifest.json` as the current snapshot manifest
- `knowledge/canonical/` as the managed Markdown root
- `knowledge/archive/` as the reserved archive root
- starter documents such as `wiki-start-here.md`, `company-profile.md`, `organisation-und-rollen.md`, `systeme-und-tools.md`, `kernprozesse.md`, `projekte-und-roadmap.md` and `glossar.md`

The index and manifest are derived artifacts and should stay ignored in the private workspace Git repository.

## Phase 1 Data Flow

1. `setup workspace` creates the private workspace skeleton plus starter documents unless `--no-starter-docs` is used.
2. `onboarding company` can either emit a source-backed questionnaire or preview/apply draft onboarding documents from an answers file.
3. `roots add` registers additional local Markdown roots.
4. `index rebuild` parses Markdown files, sections and frontmatter into SQLite + FTS5.
5. `verify` compares current root snapshots against the stored manifest and reports `missing` on a brand-new workspace instead of failing hard.
6. `search` and `route` can narrow candidates with front-matter filters such as `type`, `project`, `department`, `tag`, `owner` and `system`.
7. `read --metadata --headings` supports a metadata-first retrieval pass before the full Markdown is loaded.
8. `search`, `route` and `read` either enforce a fresh index or can explicitly auto-rebuild when `--auto-rebuild` is set.
9. Runtime commands may detect the current workspace automatically when the shell is already inside a private workspace.
10. A global per-user workspace registry stores known workspace paths and a default workspace so other agents can resolve the knowledge location automatically on macOS, Windows and Linux.
11. The installer now targets a shared `~/.agents` home as the primary skill/runtime location and adds a Codex compatibility shim under `~/.codex/bin`.
12. `serve` exposes the same read-only data through a local web view and now distinguishes `missing`, `stale` and `ok` states with a rebuild action.

## Onboarding Model

Phase 1 includes a source-backed onboarding blueprint for das deutsche Unternehmensprofil. The agent can now turn an answer file into draft starter Markdown under `knowledge/canonical/`, but the write step is still explicit and guarded by `--execute`.

The onboarding scope standardizes the first agent-led questions around:

- rechtliche Identität
- Geschäftsführung und Eigentum
- Steuern und Umsatzsteuerlogik
- Mitarbeitende und Arbeitgeberstatus
- operative Wissensgrundlage

## Snapshot and Staleness Contract

The manifest stores:

- `build_id`
- `schema_version`
- `indexed_at`
- per-root fingerprints based on file paths, sizes and mtimes
- optional Git snapshot metadata for Git-backed roots

Reads are pinned to the latest successful `build_id`. If current root snapshots no longer match the manifest, the CLI returns `INDEX_STALE` unless the caller explicitly opted into auto-rebuild.

The SQLite runtime also uses a busy timeout and returns a specific `SQLITE_LOCKED` error for transient contention instead of surfacing a generic runtime failure.

Phase 1 now also adds a workspace-local write lock. The lock serializes rebuilds and other write flows per workspace, while parallel readers continue against the current derived index.

## Metadata-First Retrieval

Phase 1 now explicitly supports a two-step retrieval model:

1. candidate routing through search plus indexed metadata
2. metadata and heading inspection before full document reads

This keeps the agent loop lighter and encourages stronger filenames plus front matter without forcing a rigid folder taxonomy.

The preferred front-matter contract now includes both `description` and `summary`, so agents can inspect a short routing description before deciding whether to load full Markdown content.

## Global Workspace Discovery

Phase 1 now persists workspace discovery outside the private workspace itself:

- macOS: `~/Library/Application Support/company-agent-wiki/workspaces.json`
- Windows: `%APPDATA%\\company-agent-wiki\\workspaces.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/company-agent-wiki/workspaces.json`

The registry stores known workspace paths plus a default workspace. `setup workspace` registers the workspace automatically. Runtime commands prefer:

1. explicit `--workspace`
2. current-directory detection
3. global default workspace
4. the single registered workspace, if exactly one exists

## Git Model

Phase 1 uses Git for:

- workspace repository initialization
- document history lookup
- document diff lookup
- optional remote registration during setup
- reviewing explicit onboarding-generated draft Markdown after it has been written

Phase 1 deliberately does not auto-commit content mutations. Even onboarding writes stay outside automatic Git mutation flows, though the CLI now rebuilds the derived index after a successful onboarding apply.

## Why the Workspace Is Separate

This repository is meant to be public. A real company knowledge workspace is private by design and may contain:

- confidential process documentation
- customer-specific notes
- accounting procedures
- sensitive internal structures

Separating code and private data keeps the public package clean and keeps Git, npm and screenshots safe by default.
