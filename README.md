# Company Agent Wiki Skill

> Context is king.

`company-agent-wiki-cli` is a local, agent-first company knowledge runtime:

- Markdown files stay the source of truth
- a local SQLite index accelerates routing and section search
- metadata-first retrieval lets agents inspect filenames, front matter and headings before loading full documents
- Git remains the audit and history layer
- the optional web view is read-only and shows index state, documents, diffs and history

It is also deliberately inspired by Anthropic's Markdown + YAML-frontmatter model for Claude Code subagents: [Anthropic Claude Code Subagents](https://docs.anthropic.com/en/docs/claude-code/sub-agents).  
The difference here is the retrieval layer: the metadata does not just sit in front matter, it is additionally indexed and filterable through a local SQLite search layer.

## Core USP

The main product differentiator is a strict metadata-first retrieval model for agents.

Instead of throwing full Markdown files into context immediately, the intended flow is:

1. find candidate files via indexed search and routing
2. inspect descriptive filenames plus structured front matter
3. inspect the heading tree
4. only then load the full Markdown when the candidate is clearly relevant

That gives agents a local, deterministic and Git-friendly knowledge workflow that stays transparent for humans:

- context is king
- filenames still matter
- Markdown stays readable
- front matter becomes the routing layer
- headings become the low-cost structure preview
- full document reads happen last, not first

Phase 1 is intentionally narrow:

- no connectors
- no GUI editing
- no silent sync magic
- no commits or pushes from this code repository

The private knowledge workspace lives outside this public code repository. It may still be the current dedicated private folder in which you want to build the wiki; the important point is only that it must not be the public skill/CLI repository itself.

## Product Surface

- npm package: `@codecell-germany/company-agent-wiki-skill`
- CLI binary: `company-agent-wiki-cli`
- installer binary: `company-agent-wiki-skill`
- Codex skill name: `company-agent-wiki-cli`

## Requirements

- Node.js `>= 20.10`
- Git available in `PATH`
- a private local folder for the actual knowledge workspace
- optionally a private Git remote URL for that workspace

The SQLite index is local and derived. It is rebuilt by the CLI and must not be treated as the source of truth.
It lives inside the private workspace under `.company-agent-wiki/index.sqlite`, but it is intentionally kept out of Git by default because it is rebuildable, binary and noisy in diffs.

## Install

```bash
npm install
npm run build
```

Inside this implementation repo, the most reliable local install path is:

```bash
node dist/installer.js install --force
```

Other valid operator paths:

```bash
"$CODEX_HOME/bin/company-agent-wiki-cli" --help
"$HOME/.codex/bin/company-agent-wiki-cli" --help
npx -p @codecell-germany/company-agent-wiki-skill company-agent-wiki-cli --help
node dist/index.js --help
```

Important:

- the direct `~/.codex/bin` path is the most reliable fallback in Codex
- `node dist/installer.js install --force` is the most reliable local install path while working from this repo
- the `npx -p @codecell-germany/company-agent-wiki-skill ...` path only works after the package is actually published
- `node dist/index.js` only works inside the public implementation repo after `npm run build`, not inside a private knowledge workspace

To test the local build without a global install:

```bash
node dist/index.js --help
node dist/installer.js install --force
```

## First Run

1. Create or choose a private workspace folder outside this repository.
2. Run setup:

```bash
company-agent-wiki-cli setup workspace \
  --workspace /absolute/path/to/private-company-knowledge \
  --git-init \
  --git-remote git@github.com:your-org/private-company-knowledge.git
```

3. Inspect the local state:

```bash
company-agent-wiki-cli doctor --workspace /absolute/path/to/private-company-knowledge --json
```

4. Rebuild the index:

```bash
company-agent-wiki-cli index rebuild --workspace /absolute/path/to/private-company-knowledge --json
```

5. Verify the indexed snapshot:

```bash
company-agent-wiki-cli verify --workspace /absolute/path/to/private-company-knowledge --json
```

6. Query the workspace:

```bash
company-agent-wiki-cli search "reverse charge aws invoice" --workspace /absolute/path/to/private-company-knowledge --type process --department buchhaltung --auto-rebuild --json
company-agent-wiki-cli route "KI-Telefonassistent" --workspace /absolute/path/to/private-company-knowledge --type project --project alpha --auto-rebuild --json
company-agent-wiki-cli read --doc-id process.example --workspace /absolute/path/to/private-company-knowledge --metadata --headings --auto-rebuild --json
company-agent-wiki-cli read --doc-id process.example --workspace /absolute/path/to/private-company-knowledge --auto-rebuild
company-agent-wiki-cli serve --workspace /absolute/path/to/private-company-knowledge --port 4187 --auto-rebuild
```

The read-only web view is served by the installed CLI process. The private workspace itself contains Markdown, metadata and the local derived index, but no standalone frontend application.

If the current shell is already inside a private workspace, runtime commands such as `doctor`, `verify`, `search`, `route`, `read`, `history`, `diff` and `serve` may omit `--workspace`.

By default `setup workspace` also creates starter Markdown documents such as `wiki-start-here.md`, `company-profile.md`, `organisation-und-rollen.md`, `systeme-und-tools.md`, `kernprozesse.md`, `projekte-und-roadmap.md` and `glossar.md`. Use `--no-starter-docs` only if you intentionally want an almost empty scaffold.

You can also start the optional company-profile onboarding for the agent:

```bash
company-agent-wiki-cli onboarding company
company-agent-wiki-cli onboarding company --json
company-agent-wiki-cli onboarding company \
  --workspace /absolute/path/to/private-company-knowledge \
  --answers-file /absolute/path/to/company-onboarding-answers.json
company-agent-wiki-cli onboarding company \
  --workspace /absolute/path/to/private-company-knowledge \
  --answers-file /absolute/path/to/company-onboarding-answers.json \
  --execute
```

Without `--execute`, the CLI stays in preview mode and only reports which draft starter Markdown files would be written into the managed root.
`--execute` requires `--answers-file`, and `--force` is only valid together with `--execute`.

## Secure Setup Model

This repository is publishable code only. It must never contain:

- real company knowledge
- exported business data
- private OAuth or API credentials
- live SQLite index files from customer workspaces

The actual knowledge workspace is separate and private. The human must provide:

- the private workspace path
- if desired, the private Git remote URL
- access rights to that remote

The agent can handle local scaffolding, root registration and index rebuilds, but it should not invent remotes or inject private data into this repository.

## Phase 1 Commands

- `setup workspace`: scaffold a private workspace and optionally initialize Git
- `doctor`: inspect the local runtime and workspace state
- `verify`: check whether the current roots still match the indexed snapshot
- `roots add`: register another local Markdown root
- `roots list`: show registered roots
- `onboarding company`: emit the default German company-profile questionnaire or materialize draft onboarding Markdown from an answers file
- `index rebuild`: rebuild the derived SQLite index and manifest
- `search`: section-level search over Markdown knowledge, with safer free-text handling
- `route`: grouped search results for agent routing
- `read`: inspect metadata or headings first, then load a full document from the source files
- `history`: show Git history for a tracked document
- `diff`: show Git diff for a tracked document
- `serve`: run a local read-only web view

## Retrieval Workflow

This is the core USP in practice. The intended agent workflow is:

1. Find candidate documents with `search` or `route`.
2. Narrow candidates with front-matter filters such as `--type`, `--project`, `--department`, `--tag`, `--owner` and `--system`.
3. Inspect only metadata and headings with `read --metadata --headings --auto-rebuild`.
4. Load the full Markdown only when the candidate is clearly relevant.

Example:

```bash
company-agent-wiki-cli route "Projekt Alpha Budget" --workspace /absolute/path --type project --project alpha --auto-rebuild --json
company-agent-wiki-cli read --workspace /absolute/path --doc-id canonical.projekt-alpha-roadmap --metadata --headings --auto-rebuild --json
company-agent-wiki-cli read --workspace /absolute/path --doc-id canonical.projekt-alpha-roadmap --auto-rebuild
```

## Authoring Workflow

For new company knowledge, use a descriptive filename plus strong front matter.

Recommended filename examples:

- `projekt-alpha-roadmap.md`
- `buchhaltung-aws-eingangsrechnung.md`
- `vertrieb-lead-qualifizierung.md`

Recommended front matter:

```yaml
---
id: projects.alpha.roadmap
title: Projekt Alpha Roadmap
type: project
status: draft
tags:
  - projekt
  - alpha
summary: Roadmap und Entscheidungen für Projekt Alpha.
project: alpha
department: entwicklung
owners:
  - nikolas-gottschol
systems:
  - linear
---
```

Then:

1. write the Markdown with a clean heading structure
2. rebuild the index
3. validate discoverability with `search --auto-rebuild`, `route --auto-rebuild` and `read --metadata --headings --auto-rebuild`

## Concurrency Note

The SQLite index is intentionally local and rebuildable. For the same workspace, avoid running multiple `search`, `route`, `read`, `history` and `diff` calls in parallel when possible. The CLI now uses a busy timeout and a lock-specific error, but agent-side serialization is still the safer Phase-1 operating mode.

## What Phase 1 Does Not Do

- it does not ingest e-mail, CRM, chat or meeting systems
- it does not write or edit knowledge through the web UI
- it does not push or publish Git commits automatically
- it does not treat the SQLite database as the truth
- it does not run an interactive prompt loop by itself; the agent still owns the conversation and answer-file creation

## Documentation

- Architecture: [knowledge/ARCHITECTURE.md](knowledge/ARCHITECTURE.md)
- Release checklist: [knowledge/RELEASE_CHECKLIST.md](knowledge/RELEASE_CHECKLIST.md)
- Known limitations: [knowledge/KNOWN_LIMITATIONS.md](knowledge/KNOWN_LIMITATIONS.md)
- Skill entrypoint: [skills/company-agent-wiki-cli/SKILL.md](skills/company-agent-wiki-cli/SKILL.md)
