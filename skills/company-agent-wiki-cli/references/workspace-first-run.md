# Workspace First Run

## Human Inputs Required

- a private workspace folder path
- if desired, a private Git remote URL

The workspace path only has to be provided once. After setup or manual registration, the CLI stores it in a per-user global registry for later agents.

## What the Agent Can Safely Do

- scaffold the local workspace
- initialize a local Git repository
- attach a provided remote URL
- create the default starter documents for the first useful company knowledge
- preview or apply onboarding-generated starter Markdown from an answers file
- register Markdown roots
- register the workspace globally for later agents
- rebuild the derived index
- verify freshness or a still-missing first index
- run the read-only web view via `company-agent-wiki-cli serve --workspace /absolute/path --port 4187`

## Runtime Discovery

Before relying on the CLI, verify a real executable path:

```bash
npx -y -p @codecell-germany/company-agent-wiki-skill company-agent-wiki-skill install --force
"$CODEX_HOME/bin/company-agent-wiki-cli" --help
"$HOME/.codex/bin/company-agent-wiki-cli" --help
company-agent-wiki-cli --help
```

The package-based `npx` installer path is only valid once the npm package is published.

If the current folder is already inside a private workspace, runtime commands may omit `--workspace`.
If not, inspect or update the global registry:

```bash
company-agent-wiki-cli workspace current --json
company-agent-wiki-cli workspace list --json
company-agent-wiki-cli workspace register --workspace /absolute/path --default --json
```

## What Must Stay Out of This Public Repo

- real business documents
- exported customer data
- local workspace indexes
- private tokens or environment files
