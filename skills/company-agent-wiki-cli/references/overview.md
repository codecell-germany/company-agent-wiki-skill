# Overview

`company-agent-wiki-cli` is the public interface for a private, local company knowledge workspace.
The published package now installs into a shared `~/.agents` home first and adds a Codex compatibility shim under `~/.codex/bin`.

## Source of Truth

- Markdown files in registered roots
- tracked workspace metadata in `.company-agent-wiki/workspace.json`
- descriptive filenames plus Front Matter carry the first routing signal

## Derived State

- `.company-agent-wiki/index.sqlite`
- `.company-agent-wiki/index-manifest.json`

## Main Commands

- `setup workspace`
- `workspace current|list|register|use`
- `onboarding company`
- `doctor`
- `verify`
- `roots add`
- `roots list`
- `index rebuild`
- `search`
- `route`
- `route-debug`
- `coverage`
- `read`
- `history`
- `diff`
- `serve`

## Expected Workflow

1. Set up the private workspace.
2. The workspace is registered globally so other agents can discover it automatically.
3. Use the starter documents or run `onboarding company`, then preview or apply the generated onboarding Markdown from an answers file.
4. Register any additional Markdown roots.
5. Rebuild the index.
6. Verify that the snapshot is fresh. On a brand-new workspace `verify` reports `missing` instead of failing hard.
7. Search or route to the right document. For active authoring loops, prefer `--auto-rebuild`, front-matter filters such as `--type`, `--project` or `--department`, and check `nearMisses` or `route-debug` when routing feels too strict.
8. Inspect metadata and headings with `read --metadata --headings --auto-rebuild`.
9. Read the full source document or use the read-only web view.
10. After authoring changes in a Git-synchronized workspace, use the workspace helper such as `wiki-save "Update company knowledge"`; use `wiki-sync` only for clean working trees.

Parallel reads are supported. Writes are serialized per workspace.
