---
name: company-agent-wiki-cli
description: Use when an agent must set up, onboard, verify, index, search or browse a private local company knowledge workspace that uses Markdown as truth, SQLite as derived index and Git for history. Covers first-run setup, company-profile questioning, root registration, stale-index checks, read-only web browsing, document history and diff workflows.
---

# Company Agent Wiki CLI

Use this skill when the task is about a private company knowledge workspace built around:

- local Markdown roots
- a rebuildable SQLite index
- Git-backed history
- a read-only local browsing view

## Preconditions

- The public CLI binary is `company-agent-wiki-cli`.
- The actual company knowledge workspace is private and lives outside the public code repository.
- The private workspace may be the current dedicated local folder; it just must not be the public skill/CLI repo.
- The human should provide the workspace path at least once and, if desired, the private Git remote URL. After setup or manual registration, the CLI stores the workspace path in a global per-user registry so later agents can resolve it automatically.
- Runtime discovery matters. Before relying on the CLI, verify which path is actually available.
- In Codex, the most reliable fallback is usually the installed shim under `$CODEX_HOME/bin` or `~/.codex/bin`.
- The preferred one-command installer path is `npx -y -p @codecell-germany/company-agent-wiki-skill company-agent-wiki-skill install --force`. This only works after the npm package is really published.
- `node dist/index.js` only works inside the public implementation repo after `npm run build`, not inside an arbitrary private workspace.
- If the binary is not already installed in PATH, use these fallbacks in this order:

```bash
"$CODEX_HOME/bin/company-agent-wiki-cli" --help
"$HOME/.codex/bin/company-agent-wiki-cli" --help
company-agent-wiki-cli --help
npx -y -p @codecell-germany/company-agent-wiki-skill company-agent-wiki-skill install --force
node dist/index.js --help
```

## First Run

1. In Codex, start with the explicit shim paths:

```bash
"$CODEX_HOME/bin/company-agent-wiki-cli" --help
"$HOME/.codex/bin/company-agent-wiki-cli" --help
```

If that fails, try the PATH binary as a convenience fallback:

```bash
company-agent-wiki-cli --help
```

If the CLI is not installed yet and the package is already published, install it with one command:

```bash
npx -y -p @codecell-germany/company-agent-wiki-skill company-agent-wiki-skill install --force
```

2. If no private workspace exists yet, create one:

```bash
company-agent-wiki-cli setup workspace --workspace /absolute/path/to/private-company-knowledge --git-init
```

This creates starter Markdown documents by default and registers the workspace globally for future agents. Use `--no-starter-docs` only when you explicitly want a nearly empty workspace.

If the workspace already exists, inspect or register it explicitly:

```bash
company-agent-wiki-cli workspace current --json
company-agent-wiki-cli workspace list --json
company-agent-wiki-cli workspace register --workspace /absolute/path/to/private-company-knowledge --default --json
```

3. Run health checks:

```bash
company-agent-wiki-cli doctor --workspace /absolute/path/to/private-company-knowledge --json
```

4. Build the index:

```bash
company-agent-wiki-cli index rebuild --workspace /absolute/path/to/private-company-knowledge --json
```

5. Only then use `search`, `route`, `read`, `history`, `diff` or `serve`.

If a human expects a browser view, you must explicitly start it with:

```bash
company-agent-wiki-cli serve --workspace /absolute/path/to/private-company-knowledge --port 4187
```

The web view is provided by the installed CLI. The private workspace itself is not a frontend repo.

If the authoring loop is noisy, prefer the auto-rebuild variants:

```bash
company-agent-wiki-cli search "KI-Telefonassistent" --workspace /absolute/path --auto-rebuild --json
company-agent-wiki-cli route "Eingangsrechnung AWS" --workspace /absolute/path --auto-rebuild --json
company-agent-wiki-cli read --doc-id canonical.company-profile --workspace /absolute/path --metadata --headings --auto-rebuild --json
company-agent-wiki-cli read --doc-id canonical.company-profile --workspace /absolute/path --auto-rebuild
company-agent-wiki-cli serve --workspace /absolute/path --port 4187 --auto-rebuild
```

## Retrieval-Prozess Für Agenten

Der empfohlene Lesepfad ist jetzt explizit metadata-first:

1. Zuerst mit `search` oder `route` Kandidaten finden.
2. Wenn möglich direkt mit Front-Matter-Filtern eingrenzen, zum Beispiel `--type`, `--project`, `--department`, `--tag`, `--owner` oder `--system`.
3. Danach Kandidaten mit `read --metadata --headings --auto-rebuild` prüfen.
4. Erst wenn Metadaten, Dateiname und Überschriften passen, den Volltext mit `read --auto-rebuild` laden.

Beispiel:

```bash
company-agent-wiki-cli route "Projekt Alpha Budget" --workspace /absolute/path --type project --project alpha --auto-rebuild --json
company-agent-wiki-cli read --workspace /absolute/path --doc-id canonical.projekt-alpha-roadmap --metadata --headings --auto-rebuild --json
company-agent-wiki-cli read --workspace /absolute/path --doc-id canonical.projekt-alpha-roadmap --auto-rebuild
```

## Anlageprozess Für Neues Wissen

Wenn ein Agent neues Wissen anlegt, soll er nicht mit beliebigen Dateinamen oder leerem Front Matter arbeiten.

Pflichtgedanke:

1. sprechender Dateiname
2. klares Front Matter
3. gute Abschnittsstruktur
4. danach Index aktualisieren

Empfohlenes Minimal-Front-Matter:

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

`id` ist jetzt klar empfohlen. Es ist technisch noch nicht in jedem Dokument Pflicht, aber für neues Wissen solltest du eine stabile manuelle ID setzen, damit spätere Referenzen, History und Routing nicht am Dateinamen hängen.

Empfohlener Ablauf:

1. Datei unter `knowledge/canonical/` oder einem anderen registrierten Managed Root anlegen.
2. Dateiname so wählen, dass er den Inhalt grob repräsentiert, etwa `projekt-alpha-roadmap.md`.
3. Front Matter inklusive `id`, `summary` und passenden Routing-Feldern setzen.
4. Wenn der Inhalt auf externer Recherche basiert, Provenienz ergänzen:
   - Quellenstand oder Prüfdokumentation im Dokument
   - Datum der Prüfung
   - Quelle oder URL
   - kurze Einordnung, ob Primärquelle, Sekundärquelle oder Nutzerangabe
5. Inhalt in sinnvolle `#`, `##`, `###`-Abschnitte gliedern.
6. `company-agent-wiki-cli index rebuild --workspace /absolute/path --json` ausführen oder einen `--auto-rebuild`-Pfad nutzen.
7. Mit `read --metadata --headings --auto-rebuild` prüfen, ob das Dokument für spätere Agenten sauber routbar ist.
8. Navigation und Einstiegspunkte aktualisieren, wenn das Dokument strukturell wichtig ist:
   - Startseite
   - thematische README
   - Prozess- oder Projektübersicht

## Bestehendes Wissen Erweitern

Nicht jeder Wissenszuwachs braucht ein neues Dokument.

Wenn bereits eine passende Seite existiert:

1. erst mit `route` oder `search` plus Filtern prüfen, ob das Wissen schon einen guten Zielort hat
2. mit `read --metadata --headings --auto-rebuild` die bestehende Struktur ansehen
3. nur dann erweitern, wenn Thema, Typ und Zielgruppe wirklich passen
4. sonst ein neues Dokument anlegen und die bestehende Navigation verlinken

Faustregel:

- neuer Prozess oder neues Themencluster: neues Dokument
- zusätzliche Ausnahme, Ergänzung oder Quellenstand zu bestehendem Thema: bestehendes Dokument erweitern

## Muster Für Beziehungswissen

Für Partner-, Netzwerk- oder CRM-Wissen ist dieses Muster sinnvoll:

```yaml
---
id: crm.partner.beispiel-partner
title: Beispiel Partner
type: relationship
status: draft
tags:
  - crm
  - partner
  - netzwerk
summary: Rolle, Status und Relevanz des Partners im CodeCell-Netzwerk.
department: vertrieb
owners:
  - nikolas-gottschol
---
```

Im Dokument selbst:

- Rolle: Partner, Netzwerkpartner, potenzieller Kunde, bestätigter Kunde
- Beziehung: Seit wann, über wen, in welchem Kontext
- Relevanz: strategisch, operativ, vertrieblich, technisch
- Aktueller Stand: offen, aktiv, pausiert, abgeschlossen
- Nächste Schritte
- Quellenstand

If the company profile itself is still unclear, run the onboarding questionnaire before deep indexing work:

```bash
company-agent-wiki-cli onboarding company
```

If the agent already has structured answers, preview or apply the generated draft onboarding documents:

```bash
company-agent-wiki-cli onboarding company \
  --workspace /absolute/path/to/private-company-knowledge \
  --answers-file /absolute/path/to/company-onboarding-answers.json
company-agent-wiki-cli onboarding company \
  --workspace /absolute/path/to/private-company-knowledge \
  --answers-file /absolute/path/to/company-onboarding-answers.json \
  --execute
```

`--execute` requires `--answers-file`, and `--force` only works together with `--execute`.

## Operating Rules

- Treat Markdown files as the source of truth.
- Treat SQLite as derived and rebuildable.
- The local SQLite file lives in the workspace, but should stay out of Git by default.
- If the CLI reports `INDEX_STALE`, do not ignore it. Run `index rebuild` or use an explicit `--auto-rebuild` path.
- For agent workflows, prefer `--auto-rebuild` on `search`, `route`, `read` and `serve` unless you explicitly want strict stale-index failures.
- Parallel `search`, `route`, `read`, `history` and `diff` calls against the same workspace are now intended to work.
- Write paths are serialized per workspace. If one agent is rebuilding the index or applying onboarding writes, other write paths wait behind that workspace lock instead of colliding.
- Do not put private company knowledge into the public code repository.
- Use the read-only web view only for browsing, not editing.
- The company onboarding questionnaire is optional. Every answer may be skipped, answered with “nein” or marked as unknown.
- Onboarding writes are explicit. Do not assume preview mode changes files; only `--execute` writes draft onboarding Markdown and rebuilds the derived index.
- If CLI discovery fails, do not pretend the documented command works. First resolve a real executable path.
- If the current folder already contains `.company-agent-wiki/workspace.json`, you may omit `--workspace` and let the CLI detect the workspace root automatically.
- If the current folder is not inside the workspace, the CLI may still resolve the globally registered default workspace.
- The global workspace registry lives per user:
  - macOS: `~/Library/Application Support/company-agent-wiki/workspaces.json`
  - Windows: `%APPDATA%\\company-agent-wiki\\workspaces.json`
  - Linux: `${XDG_CONFIG_HOME:-~/.config}/company-agent-wiki/workspaces.json`

## References

- Overview: [references/overview.md](references/overview.md)
- Agent onboarding: [references/agent-onboarding.md](references/agent-onboarding.md)
- Authoring workflow: [references/authoring-workflow.md](references/authoring-workflow.md)
- Command cheatsheet: [references/command-cheatsheet.md](references/command-cheatsheet.md)
- Workspace setup details: [references/workspace-first-run.md](references/workspace-first-run.md)
- Company onboarding questions: [references/company-onboarding.md](references/company-onboarding.md)
