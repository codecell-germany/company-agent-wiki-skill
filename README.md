# company-agent-wiki-skill

---

# English

## Purpose

> Context is king.

`company-agent-wiki-skill` is an agent-first local company knowledge toolkit.
It ships as a real CLI plus a Codex-style skill payload, so an agent can set up a private company wiki, verify the index state, search knowledge, inspect metadata and headings first, and only then load full Markdown when needed.

The product surface is the public CLI:

- `company-agent-wiki-cli`
- `company-agent-wiki-skill`

The skill explains how an agent should use that CLI safely.
It is not a substitute implementation.

## Current scope

- private local knowledge workspaces with Markdown as the source of truth
- a rebuildable local SQLite index for routing and section search
- metadata-first retrieval over filename, front matter and headings
- Git-backed history and diff workflows
- global per-user workspace discovery for later agents
- company-profile onboarding blueprints
- a read-only local web view

## Product model

The core design is simple:

- Markdown stays human-readable and remains the source of truth
- SQLite is derived and rebuildable
- Git stays the audit and history layer
- the CLI is the real product surface for agents

The retrieval model is deliberately inspired by Anthropic's Agent Skills model with YAML front matter, progressive disclosure and filesystem-based loading:
[Anthropic Agent Skills Overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)

The difference is the retrieval layer.
Here, front matter is not only stored in Markdown files, but also indexed and filterable through a local SQLite search layer.

## Installation

### 1. Install into Codex with one command

The preferred install path is:

```bash
npx -y -p @codecell-germany/company-agent-wiki-skill company-agent-wiki-skill install --force
```

That installs:

- the skill payload into `~/.codex/skills/company-agent-wiki-cli`
- the runtime into `~/.codex/tools/company-agent-wiki-cli`
- the CLI shim into `~/.codex/bin/company-agent-wiki-cli`

### 2. Verify the CLI

```bash
company-agent-wiki-cli --help
"$CODEX_HOME/bin/company-agent-wiki-cli" --help
"$HOME/.codex/bin/company-agent-wiki-cli" --help
```

In Codex, the direct shim path is often the most reliable fallback.

### 3. Optional local repo workflow

If you are working inside this public implementation repo itself:

```bash
npm install
npm run build
node dist/installer.js install --force
```

## Requirements

- Node.js `>= 20.10`
- Git available in `PATH`
- a private local folder for the actual knowledge workspace
- optionally a private Git remote URL for that workspace

The private knowledge workspace must not be this public code repository.
It may still be the current dedicated private folder in which you want to build the wiki.

The SQLite index lives inside the private workspace under `.company-agent-wiki/index.sqlite`.
It is intentionally kept out of Git by default because it is rebuildable, binary and noisy in diffs.

The workspace path can also be stored globally for other agents:

- macOS: `~/Library/Application Support/company-agent-wiki/workspaces.json`
- Windows: `%APPDATA%\company-agent-wiki\workspaces.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/company-agent-wiki/workspaces.json`

## Quick start

Create or choose a private workspace and run:

```bash
company-agent-wiki-cli setup workspace \
  --workspace /absolute/path/to/private-company-knowledge \
  --git-init \
  --git-remote git@github.com:your-org/private-company-knowledge.git
```

Then:

```bash
company-agent-wiki-cli doctor --workspace /absolute/path/to/private-company-knowledge --json
company-agent-wiki-cli index rebuild --workspace /absolute/path/to/private-company-knowledge --json
company-agent-wiki-cli verify --workspace /absolute/path/to/private-company-knowledge --json
```

After that, start retrieval:

```bash
company-agent-wiki-cli search "reverse charge aws invoice" --workspace /absolute/path/to/private-company-knowledge --type process --department buchhaltung --auto-rebuild --json
company-agent-wiki-cli route "KI-Telefonassistent" --workspace /absolute/path/to/private-company-knowledge --type project --project alpha --auto-rebuild --json
company-agent-wiki-cli read --doc-id process.example --workspace /absolute/path/to/private-company-knowledge --metadata --headings --auto-rebuild --json
company-agent-wiki-cli read --doc-id process.example --workspace /absolute/path/to/private-company-knowledge --auto-rebuild
company-agent-wiki-cli serve --workspace /absolute/path/to/private-company-knowledge --port 4187 --auto-rebuild
```

By default `setup workspace` also creates starter Markdown files such as:

- `wiki-start-here.md`
- `company-profile.md`
- `organisation-und-rollen.md`
- `systeme-und-tools.md`
- `kernprozesse.md`
- `projekte-und-roadmap.md`
- `glossar.md`

## Deterministic first-run order for agents

If a fresh agent receives this skill, the correct order is:

1. Verify the CLI path:
   - `company-agent-wiki-cli --help`
   - `"$CODEX_HOME/bin/company-agent-wiki-cli" --help`
   - `"$HOME/.codex/bin/company-agent-wiki-cli" --help`
2. If no workspace exists yet, create one with `setup workspace`.
3. If a workspace already exists, inspect or register it:
   - `workspace current --json`
   - `workspace list --json`
   - `workspace register --workspace /absolute/path --default --json`
4. Run `doctor --json`.
5. Run `index rebuild --json`.
6. Run `verify --json`.
7. Only then use `search`, `route`, `read`, `history`, `diff` or `serve`.

If the current shell is already inside a private workspace, runtime commands may omit `--workspace`.
If not, the CLI can fall back to the globally registered default workspace.

## Retrieval workflow

This is the core agent workflow:

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

## Authoring workflow

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

Recommended authoring order:

1. Create the Markdown file inside `knowledge/canonical/` or another registered managed root.
2. Use a filename that roughly describes the real content.
3. Set front matter including `id`, `summary` and the routing fields that matter.
4. If the content depends on external sources, document provenance, date and source type.
5. Structure the file with clear `#`, `##` and `###` headings.
6. Rebuild the index or use an `--auto-rebuild` retrieval path.
7. Validate discoverability with `search`, `route` and `read --metadata --headings --auto-rebuild`.
8. If the document is structurally important, update the start page or thematic overview pages as well.

## Company onboarding

You can also start the optional company-profile onboarding:

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

Without `--execute`, the CLI stays in preview mode.
With `--execute`, it writes draft starter Markdown into the managed root and rebuilds the index.

## Concurrency

The SQLite index is intentionally local and rebuildable.
Parallel reads such as `search`, `route`, `read`, `history` and `diff` are a supported Phase-1 goal and should work across multiple agents.

Write paths such as `index rebuild` and onboarding apply are serialized per workspace through a local write lock, so concurrent writes queue behind the active writer instead of colliding.

## What Phase 1 does not do

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
