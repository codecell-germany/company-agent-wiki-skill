# Command Cheatsheet

## Workspace

```bash
npx -y -p @codecell-germany/company-agent-wiki-skill company-agent-wiki-skill install --force
"$HOME/.agents/bin/company-agent-wiki-cli" --help
"$AGENTS_HOME/bin/company-agent-wiki-cli" --help
"$CODEX_HOME/bin/company-agent-wiki-cli" --help
"$HOME/.codex/bin/company-agent-wiki-cli" --help
company-agent-wiki-cli about --json
company-agent-wiki-cli setup workspace --workspace /absolute/path --git-init
company-agent-wiki-cli workspace current --json
company-agent-wiki-cli workspace list --json
company-agent-wiki-cli workspace register --workspace /absolute/path --default --json
company-agent-wiki-cli workspace use --workspace /absolute/path --json
company-agent-wiki-cli onboarding company
company-agent-wiki-cli onboarding company --workspace /absolute/path --answers-file /absolute/path/to/answers.json
company-agent-wiki-cli onboarding company --workspace /absolute/path --answers-file /absolute/path/to/answers.json --execute
company-agent-wiki-cli roots add --workspace /absolute/path --id accounting --path /absolute/path/to/root
company-agent-wiki-cli roots list --workspace /absolute/path --json
```

## Health

```bash
company-agent-wiki-cli doctor --workspace /absolute/path --json
company-agent-wiki-cli index rebuild --workspace /absolute/path --json
company-agent-wiki-cli verify --workspace /absolute/path --json
```

If you are already inside the private workspace, `doctor`, `verify`, `search`, `route`, `read`, `history`, `diff` and `serve` may omit `--workspace`.
If not, the CLI can also use the globally registered default workspace.

## Retrieval

```bash
company-agent-wiki-cli search "KI-Telefonassistent" --workspace /absolute/path --auto-rebuild --json
company-agent-wiki-cli search "AWS Rechnung" --workspace /absolute/path --type process --department buchhaltung --auto-rebuild --json
company-agent-wiki-cli route "vermieter rechnung buchen" --workspace /absolute/path --type process --project finance-ops --auto-rebuild --json
company-agent-wiki-cli route-debug "Google Cloud Statement Beleggrundlage buchen" --workspace /absolute/path --auto-rebuild --json
company-agent-wiki-cli coverage "Kfz-Steuer Bescheid Erstattung" --workspace /absolute/path --auto-rebuild --json
company-agent-wiki-cli read --doc-id process.example --workspace /absolute/path --metadata --headings --auto-rebuild --json
company-agent-wiki-cli read --doc-id process.example --workspace /absolute/path --auto-rebuild
```

## Git Views

```bash
company-agent-wiki-cli history --workspace /absolute/path --doc-id process.example --json
company-agent-wiki-cli diff --workspace /absolute/path --doc-id process.example --json
```

## Git Sync Helpers

If the private workspace provides helper scripts, prefer them over ad-hoc Git commands:

```bash
wiki-save "Update company knowledge"
wiki-sync
```

Expected semantics:

- `wiki-save "..."`: rebuild/index if configured, commit intended workspace changes, pull/rebase, push.
- `wiki-sync`: only fast-forward/push a clean working tree; refuse dirty local changes.
- On conflicts: stop and report. Do not force-push or auto-reset.

## Web View

```bash
company-agent-wiki-cli serve --workspace /absolute/path --port 4187 --auto-rebuild
```
