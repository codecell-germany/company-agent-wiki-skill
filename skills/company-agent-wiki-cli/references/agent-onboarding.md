# Agent Onboarding

## Use This Sequence

```bash
"$CODEX_HOME/bin/company-agent-wiki-cli" --help
"$HOME/.codex/bin/company-agent-wiki-cli" --help
company-agent-wiki-cli --help
company-agent-wiki-cli setup workspace --workspace /absolute/path --git-init
company-agent-wiki-cli onboarding company
company-agent-wiki-cli onboarding company --workspace /absolute/path --answers-file /absolute/path/to/answers.json
company-agent-wiki-cli onboarding company --workspace /absolute/path --answers-file /absolute/path/to/answers.json --execute
company-agent-wiki-cli doctor --workspace /absolute/path --json
company-agent-wiki-cli index rebuild --workspace /absolute/path --json
company-agent-wiki-cli verify --workspace /absolute/path --json
company-agent-wiki-cli serve --workspace /absolute/path --port 4187 --auto-rebuild
```

Only after the company profile is clear enough and these checks succeed should you search or browse deeply.

## If the Workspace Does Not Exist Yet

```bash
company-agent-wiki-cli setup workspace --workspace /absolute/path --git-init
```

If the human has a private Git remote ready:

```bash
company-agent-wiki-cli setup workspace \
  --workspace /absolute/path \
  --git-init \
  --git-remote git@github.com:your-org/private-company-knowledge.git
```

## If `INDEX_STALE` Appears

Run:

```bash
company-agent-wiki-cli index rebuild --workspace /absolute/path --json
```

Do not continue with stale results.

For frequent edits, the authoring loop can also use the guarded auto-rebuild path:

```bash
company-agent-wiki-cli search "KI-Telefonassistent" --workspace /absolute/path --auto-rebuild --json
```

After candidate routing, prefer metadata-first reading:

```bash
company-agent-wiki-cli read --workspace /absolute/path --doc-id canonical.projekt-alpha-roadmap --metadata --headings --auto-rebuild --json
company-agent-wiki-cli read --workspace /absolute/path --doc-id canonical.projekt-alpha-roadmap --auto-rebuild
```
