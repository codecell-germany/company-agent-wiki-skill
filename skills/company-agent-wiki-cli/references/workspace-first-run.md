# Workspace First Run

## Human Inputs Required

- a private workspace folder path
- if desired, a private Git remote URL

## What the Agent Can Safely Do

- scaffold the local workspace
- initialize a local Git repository
- attach a provided remote URL
- create the default starter documents for the first useful company knowledge
- preview or apply onboarding-generated starter Markdown from an answers file
- register Markdown roots
- rebuild the derived index
- verify freshness or a still-missing first index
- run the read-only web view via `company-agent-wiki-cli serve --workspace /absolute/path --port 4187`

## Runtime Discovery

Before relying on the CLI, verify a real executable path:

```bash
"$CODEX_HOME/bin/company-agent-wiki-cli" --help
"$HOME/.codex/bin/company-agent-wiki-cli" --help
company-agent-wiki-cli --help
```

The package-based `npx` path is only valid once the npm package is published.

If the current folder is already inside a private workspace, runtime commands may omit `--workspace`.

## What Must Stay Out of This Public Repo

- real business documents
- exported customer data
- local workspace indexes
- private tokens or environment files
