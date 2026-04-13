# Release Checklist

## Naming Decision

- Empfohlener GitHub-Repo-Name: `company-agent-wiki-skill`
- npm-Paket: `@codecell-germany/company-agent-wiki-skill`
- CLI-Binary: `company-agent-wiki-cli`
- Installer-Binary: `company-agent-wiki-skill`
- Skill-Name: `company-agent-wiki-cli`

Empfohlene GitHub-Beschreibung:

`Context is king. Agent-first local company knowledge runtime with Markdown as truth, metadata-first retrieval, a SQLite index and Git-aware history.`

## Before GitHub Publish

- Prüfen, dass das lokale Git-Repo einen sauberen Ausgangszustand hat:
  - wenn noch kein erster Commit existiert, zuerst den initialen Commit vorbereiten
  - wenn noch kein Remote existiert, das öffentliche GitHub-Repo zuerst anlegen
- Prüfen, dass keine privaten Daten im Repo liegen:
  - keine echten Workspace-Inhalte
  - keine Tokens, `.env`-Dateien oder Exportdateien
  - keine Inhalte aus `Plans/`, `.context/` oder `output/`
- Prüfen, dass `.gitignore` mindestens diese Bereiche abdeckt:
  - `Plans/`
  - `.context/`
  - `output/`
  - `.env`
  - `.env.*`
  - `*.tgz`
- Prüfen, dass `package.json -> files` nur öffentliche Artefakte freigibt.
- README, Skill, Referenzen und Knowledge-Doku gemeinsam synchronisieren:
  - `README.md`
  - `skills/company-agent-wiki-cli/SKILL.md`
  - `skills/company-agent-wiki-cli/references/agent-onboarding.md`
  - `skills/company-agent-wiki-cli/references/overview.md`
  - `skills/company-agent-wiki-cli/references/command-cheatsheet.md`
  - `skills/company-agent-wiki-cli/references/workspace-first-run.md`
  - `skills/company-agent-wiki-cli/references/authoring-workflow.md`
  - `knowledge/ARCHITECTURE.md`
  - `knowledge/KNOWN_LIMITATIONS.md`

## Local Verification

```bash
npm install
npm run build
npm run test:unit
node dist/index.js --help
node dist/installer.js install --force
npm pack
```

## Tarball Smoke Tests

CLI aus lokalem Tarball:

```bash
TMP="$(mktemp -d)"
cd "$TMP"
npx -y -p /absolute/path/to/codecell-germany-company-agent-wiki-skill-0.1.0.tgz company-agent-wiki-cli --help
```

Installer aus lokalem Tarball:

```bash
TMP="$(mktemp -d)"
cd "$TMP"
npx -y -p /absolute/path/to/codecell-germany-company-agent-wiki-skill-0.1.0.tgz company-agent-wiki-skill install --agents-home "$TMP/agents" --codex-home "$TMP/codex" --force
"$TMP/agents/bin/company-agent-wiki-cli" --help
"$TMP/codex/bin/company-agent-wiki-cli" --help
```

## GitHub Publish Order

1. Öffentliches GitHub-Repo `codecell-germany/company-agent-wiki-skill` anlegen.
2. GitHub-Beschreibung setzen.
3. Lokale Dateien prüfen und nur gewünschte Dateien stagen.
4. Ersten Commit oder Release-Commit erstellen.
5. Remote verbinden.
6. Push ausführen.

Wichtige Regel:

- niemals blind `git add .`

## npm Publish

Vor dem Publish:

```bash
npm whoami
npm pack
```

Veröffentlichung:

```bash
npm publish --access public --registry=https://registry.npmjs.org/
```

Wenn npm-2FA blockiert, den finalen Publish-Schritt lokal im echten Terminal ausführen.

## npm Verification After Publish

```bash
npm view @codecell-germany/company-agent-wiki-skill version --registry=https://registry.npmjs.org/
npm view @codecell-germany/company-agent-wiki-skill dist-tags --json --registry=https://registry.npmjs.org/
```

Registry-Install mit exakter Version:

```bash
TMP="$(mktemp -d)"
CACHE="$(mktemp -d)"
cd "$TMP"
npm_config_cache="$CACHE" npx -y @codecell-germany/company-agent-wiki-skill@0.1.0 company-agent-wiki-cli --help
npm_config_cache="$CACHE" npx -y @codecell-germany/company-agent-wiki-skill@0.1.0 company-agent-wiki-skill install --agents-home "$TMP/agents" --codex-home "$TMP/codex" --force
"$TMP/agents/bin/company-agent-wiki-cli" --help
"$TMP/codex/bin/company-agent-wiki-cli" --help
```

Falls `npm view` direkt nach dem Publish kurzfristig noch `404` liefert, zusätzlich die Registry-Tarball-URL prüfen und daraus den Install-Smoke fahren:

```bash
curl -I https://registry.npmjs.org/@codecell-germany/company-agent-wiki-skill/-/company-agent-wiki-skill-0.1.0.tgz
TMP="$(mktemp -d)"
cd "$TMP"
npx -y -p https://registry.npmjs.org/@codecell-germany/company-agent-wiki-skill/-/company-agent-wiki-skill-0.1.0.tgz company-agent-wiki-cli --help
```

Praktisches Learning aus diesem Release:

- `npm dist-tag ls` und die direkte Tarball-URL können bereits korrekt funktionieren, während `npm view` bzw. die Packument-Auflösung noch kurz hinterherhinkt.
- Für die Veröffentlichungsfreigabe reicht deshalb im Zweifel:
  - erfolgreicher `npm publish`
  - `npm access get status <package>` = `public`
  - `npm dist-tag ls <package>` zeigt `latest`
  - Tarball-URL liefert `200`
  - CLI-/Installer-Smoke direkt von der Tarball-URL funktioniert

## skills.sh Verification

Nach GitHub-Publish:

```bash
npx -y skills add codecell-germany/company-agent-wiki-skill -l
```

Danach einen echten Install testen:

```bash
npx -y skills add codecell-germany/company-agent-wiki-skill -g --skill company-agent-wiki-cli -a '*' -y
```

## Final Done Check

- CLI läuft über `company-agent-wiki-cli`
- Installer läuft über `company-agent-wiki-skill`
- Shared agent install unter `~/.agents` funktioniert
- Codex-Kompatibilitätsinstall unter `~/.codex` funktioniert
- README, Skill, Referenzen und Knowledge sind synchron
- `npm pack` enthält nur gewollte Dateien
- lokaler Tarball-Smoketest ist grün
- GitHub-Repo ist öffentlich und aktuell
- npm-Paket ist veröffentlicht
- exakter Registry-Install ist verifiziert
- `skills add ... -l` findet den Skill
