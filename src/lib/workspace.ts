import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CLI_NAME,
  DEFAULT_ARCHIVE_ROOT_PATH,
  DEFAULT_MANAGED_ROOT_ID,
  DEFAULT_MANAGED_ROOT_PATH,
  EXIT_CODES,
  GLOBAL_REGISTRY_DIR_NAME,
  GLOBAL_REGISTRY_FILE,
  INDEX_DB_FILE,
  INDEX_MANIFEST_FILE,
  WORKSPACE_CONFIG_FILE,
  WORKSPACE_INTERNAL_DIR,
  WORKSPACE_LAYOUT_VERSION
} from "./constants";
import { CliError } from "./errors";
import { fileExists, isDirectory, readJsonFile, writeJsonAtomic, writeJsonFile, writeTextFile } from "./fs-utils";
import { newBuildId } from "./hash";
import { configureRemote, initGitRepository, isGitAvailable, isGitRepository } from "./git";
import type {
  GlobalWorkspaceRegistry,
  RegisteredWorkspace,
  ResolvedWorkspaceSelection,
  WorkspaceConfig,
  WorkspaceRoot
} from "./types";

export interface WorkspacePaths {
  workspaceRoot: string;
  internalDir: string;
  configPath: string;
  indexDbPath: string;
  indexManifestPath: string;
  managedRootPath: string;
  archiveRootPath: string;
}

export function getDefaultCodexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export function getDefaultAgentsHome(): string {
  return process.env.AGENTS_HOME || path.join(os.homedir(), ".agents");
}

export function getGlobalRegistryDir(): string {
  const explicit = process.env.COMPANY_AGENT_WIKI_CONFIG_HOME;
  if (explicit?.trim()) {
    return path.resolve(explicit);
  }

  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), GLOBAL_REGISTRY_DIR_NAME, "vitest");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", GLOBAL_REGISTRY_DIR_NAME);
  }

  if (process.platform === "win32") {
    const roaming = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(roaming, GLOBAL_REGISTRY_DIR_NAME);
  }

  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdgConfig, GLOBAL_REGISTRY_DIR_NAME);
}

export function getGlobalRegistryPath(): string {
  return path.join(getGlobalRegistryDir(), GLOBAL_REGISTRY_FILE);
}

export function resolveWorkspacePaths(workspaceRoot: string): WorkspacePaths {
  const absoluteRoot = normalizeWorkspaceRootPath(workspaceRoot);
  const internalDir = path.join(absoluteRoot, WORKSPACE_INTERNAL_DIR);

  return {
    workspaceRoot: absoluteRoot,
    internalDir,
    configPath: path.join(internalDir, WORKSPACE_CONFIG_FILE),
    indexDbPath: path.join(internalDir, INDEX_DB_FILE),
    indexManifestPath: path.join(internalDir, INDEX_MANIFEST_FILE),
    managedRootPath: path.join(absoluteRoot, DEFAULT_MANAGED_ROOT_PATH),
    archiveRootPath: path.join(absoluteRoot, DEFAULT_ARCHIVE_ROOT_PATH)
  };
}

export function detectWorkspaceRoot(startDir = process.cwd()): string | undefined {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, WORKSPACE_INTERNAL_DIR, WORKSPACE_CONFIG_FILE);
    if (fileExists(candidate)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function createDefaultGlobalRegistry(): GlobalWorkspaceRegistry {
  return {
    schemaVersion: WORKSPACE_LAYOUT_VERSION,
    updatedAt: new Date().toISOString(),
    workspaces: []
  };
}

function normalizeWorkspaceRootPath(candidatePath: string): string {
  const resolved = path.resolve(candidatePath);
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function loadGlobalWorkspaceRegistry(): GlobalWorkspaceRegistry {
  const registryPath = getGlobalRegistryPath();
  if (!fileExists(registryPath)) {
    return createDefaultGlobalRegistry();
  }

  const raw = readJsonFile<GlobalWorkspaceRegistry>(registryPath);
  const registry = createDefaultGlobalRegistry();
  registry.schemaVersion = raw.schemaVersion || registry.schemaVersion;
  registry.updatedAt = raw.updatedAt || registry.updatedAt;

  const deduped = new Map<string, RegisteredWorkspace>();
  for (const entry of raw.workspaces || []) {
    const normalizedPath = normalizeWorkspaceRootPath(entry.path);
    if (!fileExists(resolveWorkspacePaths(normalizedPath).configPath)) {
      continue;
    }

    const normalizedEntry: RegisteredWorkspace = {
      workspaceId: entry.workspaceId,
      path: normalizedPath,
      label: entry.label || path.basename(normalizedPath),
      registeredAt: entry.registeredAt,
      lastUsedAt: entry.lastUsedAt,
      source: entry.source
    };

    const existing = deduped.get(normalizedPath);
    if (!existing || existing.lastUsedAt < normalizedEntry.lastUsedAt) {
      deduped.set(normalizedPath, normalizedEntry);
    }
  }

  registry.workspaces = Array.from(deduped.values()).sort((left, right) => left.label.localeCompare(right.label));
  if (raw.defaultWorkspace) {
    const normalizedDefault = normalizeWorkspaceRootPath(raw.defaultWorkspace);
    if (deduped.has(normalizedDefault)) {
      registry.defaultWorkspace = normalizedDefault;
    }
  }

  const serializedRaw = JSON.stringify(raw);
  const serializedNormalized = JSON.stringify(registry);
  if (serializedRaw !== serializedNormalized) {
    saveGlobalWorkspaceRegistry(registry);
  }

  return registry;
}

export function saveGlobalWorkspaceRegistry(registry: GlobalWorkspaceRegistry): void {
  writeJsonAtomic(getGlobalRegistryPath(), registry);
}

function buildRegisteredWorkspace(workspaceRoot: string, source: RegisteredWorkspace["source"]): RegisteredWorkspace {
  const resolvedRoot = normalizeWorkspaceRootPath(workspaceRoot);
  const config = loadWorkspaceConfig(resolvedRoot);
  const now = new Date().toISOString();

  return {
    workspaceId: config.workspaceId,
    path: resolvedRoot,
    label: path.basename(resolvedRoot),
    registeredAt: now,
    lastUsedAt: now,
    source
  };
}

export function registerWorkspaceGlobally(
  workspaceRoot: string,
  options?: { setDefault?: boolean; source?: RegisteredWorkspace["source"] }
): RegisteredWorkspace {
  const resolvedRoot = path.resolve(workspaceRoot);
  const nextEntry = buildRegisteredWorkspace(resolvedRoot, options?.source || "manual");
  const registry = loadGlobalWorkspaceRegistry();
  const existing = registry.workspaces.find((item) => item.path === resolvedRoot);

  if (existing) {
    existing.workspaceId = nextEntry.workspaceId;
    existing.label = nextEntry.label;
    existing.lastUsedAt = nextEntry.lastUsedAt;
    existing.source = nextEntry.source;
  } else {
    registry.workspaces.push(nextEntry);
  }

  if (options?.setDefault || !registry.defaultWorkspace) {
    registry.defaultWorkspace = resolvedRoot;
  }
  registry.updatedAt = new Date().toISOString();
  saveGlobalWorkspaceRegistry(registry);

  return registry.workspaces.find((item) => item.path === resolvedRoot) || nextEntry;
}

export function rememberWorkspaceGlobally(
  workspaceRoot: string,
  options?: { setDefault?: boolean; source?: RegisteredWorkspace["source"] }
): RegisteredWorkspace | undefined {
  const configPath = resolveWorkspacePaths(workspaceRoot).configPath;
  if (!fileExists(configPath)) {
    return undefined;
  }

  try {
    return registerWorkspaceGlobally(workspaceRoot, options);
  } catch {
    return undefined;
  }
}

export function listRegisteredWorkspaces(): {
  registryPath: string;
  defaultWorkspace?: string;
  workspaces: Array<RegisteredWorkspace & { exists: boolean }>;
} {
  const registry = loadGlobalWorkspaceRegistry();
  return {
    registryPath: getGlobalRegistryPath(),
    defaultWorkspace: registry.defaultWorkspace,
    workspaces: registry.workspaces.map((item) => ({
      ...item,
      exists: fileExists(resolveWorkspacePaths(item.path).configPath)
    }))
  };
}

export function resolveWorkspaceSelection(startDir = process.cwd()): ResolvedWorkspaceSelection {
  const registryPath = getGlobalRegistryPath();
  const cwdWorkspace = detectWorkspaceRoot(startDir);
  if (cwdWorkspace) {
    rememberWorkspaceGlobally(cwdWorkspace, { setDefault: true, source: "detected" });
    return {
      workspaceRoot: cwdWorkspace,
      source: "cwd",
      registryPath,
      defaultWorkspace: loadGlobalWorkspaceRegistry().defaultWorkspace
    };
  }

  const registry = loadGlobalWorkspaceRegistry();
  const existingWorkspaces = registry.workspaces.filter((item) => fileExists(resolveWorkspacePaths(item.path).configPath));
  const defaultWorkspace = registry.defaultWorkspace;

  if (defaultWorkspace && fileExists(resolveWorkspacePaths(defaultWorkspace).configPath)) {
    rememberWorkspaceGlobally(defaultWorkspace, { setDefault: true, source: "runtime" });
    return {
      workspaceRoot: defaultWorkspace,
      source: "global-default",
      registryPath,
      defaultWorkspace
    };
  }

  if (existingWorkspaces.length === 1) {
    const onlyWorkspace = existingWorkspaces[0].path;
    rememberWorkspaceGlobally(onlyWorkspace, { setDefault: true, source: "runtime" });
    return {
      workspaceRoot: onlyWorkspace,
      source: "single-registered",
      registryPath,
      defaultWorkspace: onlyWorkspace
    };
  }

  return {
    registryPath,
    defaultWorkspace
  };
}

function templateWorkspaceReadme(): string {
  return `# Private Company Knowledge Workspace

This workspace is intentionally separate from the public code repository.

- \`knowledge/canonical/\` holds tracked Markdown source documents
- \`knowledge/archive/\` is reserved for archived documents
- \`knowledge/canonical/wiki-start-here.md\` and the other starter files give the first useful structure for agents
- \`.company-agent-wiki/workspace.json\` stores tracked workspace metadata
- \`.company-agent-wiki/index.sqlite\` and \`.company-agent-wiki/index-manifest.json\` are derived and should stay ignored

Recommended first productive loop:

1. fill the starter documents or run \`company-agent-wiki-cli onboarding company\`
2. run \`company-agent-wiki-cli index rebuild --workspace /absolute/path\`
3. verify freshness
4. browse with \`company-agent-wiki-cli serve --workspace /absolute/path --port 4187\`

Use \`company-agent-wiki-cli\` for verification, indexing and read-only browsing.
`;
}

interface StarterDocument {
  relPath: string;
  content: string;
}

function createStarterDocuments(): StarterDocument[] {
  return [
    {
      relPath: "wiki-start-here.md",
      content: `---
title: Wiki Start Here
type: guide
status: draft
tags:
  - wiki
  - start
---
# Wiki Start Here

Dieses Firmen-Wiki startet mit einem kleinen, agentenfreundlichen Grundgerüst.

## Empfohlene erste Schritte

1. Unternehmensprofil prüfen oder über das Onboarding ergänzen.
2. Rollen, Systeme und Kernprozesse mit echten Informationen anreichern.
3. Danach den Index neu aufbauen und die Webansicht starten.

## Startdokumente

- \`company-profile.md\`
- \`organisation-und-rollen.md\`
- \`systeme-und-tools.md\`
- \`kernprozesse.md\`
- \`projekte-und-roadmap.md\`
- \`glossar.md\`

## Nützliche Befehle

\`\`\`bash
company-agent-wiki-cli doctor --workspace /absolute/path --json
company-agent-wiki-cli index rebuild --workspace /absolute/path --json
company-agent-wiki-cli verify --workspace /absolute/path --json
company-agent-wiki-cli serve --workspace /absolute/path --port 4187
\`\`\`
`
    },
    {
      relPath: "company-profile.md",
      content: `---
title: Unternehmensprofil
type: profile
status: draft
tags:
  - company
  - profile
---
# Unternehmensprofil

## Kurzbeschreibung

- Wer ist das Unternehmen?
- Was ist die Hauptleistung?
- Für wen arbeitet das Unternehmen?

## Rechtlicher Kern

- Offizielle Firmierung:
- Rechtsform:
- Sitz:
- Registerstatus:

## Geschäftsmodell

- Hauptangebote:
- Zielgruppen:
- Erlöslogik:

## Offene Punkte

- Welche Angaben fehlen noch?
`
    },
    {
      relPath: "organisation-und-rollen.md",
      content: `---
title: Organisation und Rollen
type: map
status: draft
tags:
  - company
  - roles
---
# Organisation und Rollen

## Kernrollen

| Rolle | Verantwortung | Personen | Hinweise |
| --- | --- | --- | --- |
| Geschäftsführung |  |  |  |
| Buchhaltung |  |  |  |
| Vertrieb |  |  |  |
| Entwicklung |  |  |  |

## Freigabemodell

- Wer entscheidet fachlich?
- Wer entscheidet finanziell?
- Wer darf operativ freigeben?
`
    },
    {
      relPath: "systeme-und-tools.md",
      content: `---
title: Systeme und Tools
type: inventory
status: draft
tags:
  - systems
  - tools
---
# Systeme und Tools

## Kritische Systeme

| System | Zweck | Owner | Kritikalität | Hinweise |
| --- | --- | --- | --- | --- |
|  |  |  | hoch/mittel/niedrig |  |

## Schnittstellen

- Welche Systeme sprechen miteinander?
- Welche Zugangsdaten oder Tokens sind kritisch?
- Welche Systeme sollen später als Connectoren betrachtet werden?
`
    },
    {
      relPath: "kernprozesse.md",
      content: `---
title: Kernprozesse
type: process-map
status: draft
tags:
  - processes
---
# Kernprozesse

## Hauptprozesse

| Prozess | Startsignal | Ergebnis | Owner | Hinweise |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Priorisierte Prozessdokumentation

- Welche Prozesse sind sofort agentenrelevant?
- Welche Sonderfälle oder Ausnahmen müssen zuerst dokumentiert werden?
`
    },
    {
      relPath: "projekte-und-roadmap.md",
      content: `---
title: Projekte und Roadmap
type: roadmap
status: draft
tags:
  - projects
  - roadmap
---
# Projekte und Roadmap

## Aktive Projekte

| Projekt | Status | Ziel | Owner | Nächster Schritt |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Offene strategische Themen

- Welche größeren Initiativen laufen gerade?
- Welche Projekte liefern bereits verwertbares Firmenwissen?
`
    },
    {
      relPath: "glossar.md",
      content: `---
title: Glossar
type: glossary
status: draft
tags:
  - glossary
---
# Glossar

## Wichtige Begriffe

| Begriff | Bedeutung | Kontext |
| --- | --- | --- |
|  |  |  |

## Sprachregeln

- Welche Begriffe verwendet das Unternehmen bewusst?
- Welche Begriffe sollten vermieden oder erklärt werden?
`
    }
  ];
}

function templateKnowledgeReadme(): string {
  return `# Managed Knowledge Root

Store canonical Markdown knowledge here.

The default setup already creates starter documents for:

- company profile
- organisation and roles
- systems and tools
- core processes
- projects and roadmap
- glossary

Recommended frontmatter:

\`\`\`yaml
---
id: process.example
title: Example process
type: process
status: active
tags:
  - example
---
\`\`\`
`;
}

function templateWorkspaceGitignore(): string {
  return `${WORKSPACE_INTERNAL_DIR}/${INDEX_DB_FILE}
${WORKSPACE_INTERNAL_DIR}/${INDEX_MANIFEST_FILE}
.DS_Store
`;
}

function createDefaultConfig(): WorkspaceConfig {
  return {
    schemaVersion: WORKSPACE_LAYOUT_VERSION,
    workspaceId: newBuildId(),
    createdAt: new Date().toISOString(),
    managedRootId: DEFAULT_MANAGED_ROOT_ID,
    roots: [
      {
        id: DEFAULT_MANAGED_ROOT_ID,
        path: DEFAULT_MANAGED_ROOT_PATH,
        kind: "managed",
        writePolicy: "agent-only"
      }
    ],
    index: {
      databasePath: path.join(WORKSPACE_INTERNAL_DIR, INDEX_DB_FILE),
      manifestPath: path.join(WORKSPACE_INTERNAL_DIR, INDEX_MANIFEST_FILE)
    },
    git: {
      enabled: true,
      remoteName: "origin",
      remoteConfigured: false
    }
  };
}

export function loadWorkspaceConfig(workspaceRoot: string): WorkspaceConfig {
  const paths = resolveWorkspacePaths(workspaceRoot);
  if (!fileExists(paths.configPath)) {
    throw new CliError(
      "WORKSPACE_NOT_INITIALIZED",
      `Workspace metadata not found at ${paths.configPath}`,
      EXIT_CODES.config,
      {
        hint: `Run setup first: company-agent-wiki-cli setup workspace --workspace ${paths.workspaceRoot}`
      }
    );
  }

  return readJsonFile<WorkspaceConfig>(paths.configPath);
}

export function saveWorkspaceConfig(workspaceRoot: string, config: WorkspaceConfig): void {
  const paths = resolveWorkspacePaths(workspaceRoot);
  writeJsonFile(paths.configPath, config);
}

function normalizeStoredRootPath(workspaceRoot: string, candidatePath: string): string {
  const absoluteCandidate = path.resolve(candidatePath);
  const relative = path.relative(workspaceRoot, absoluteCandidate);

  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative || ".";
  }

  return absoluteCandidate;
}

function isPathInsideWorkspace(workspaceRoot: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveRootPath(workspaceRoot: string, root: WorkspaceRoot): string {
  if (path.isAbsolute(root.path)) {
    return root.path;
  }
  return path.join(workspaceRoot, root.path);
}

export function setupWorkspace(options: {
  workspaceRoot: string;
  gitInit: boolean;
  gitRemote?: string;
  starterDocs?: boolean;
  force?: boolean;
}): { workspaceRoot: string; configPath: string; created: string[]; warnings: string[]; nextSteps: string[] } {
  const paths = resolveWorkspacePaths(options.workspaceRoot);
  const configExists = fileExists(paths.configPath);
  if (configExists && !options.force) {
    throw new CliError(
      "WORKSPACE_EXISTS",
      `Workspace already initialized at ${paths.workspaceRoot}`,
      EXIT_CODES.config,
      { hint: "Use --force to rewrite the scaffold or choose another workspace path." }
    );
  }

  fs.mkdirSync(paths.workspaceRoot, { recursive: true });
  fs.mkdirSync(paths.internalDir, { recursive: true });
  fs.mkdirSync(paths.managedRootPath, { recursive: true });
  fs.mkdirSync(paths.archiveRootPath, { recursive: true });

  const config = createDefaultConfig();
  if (options.gitRemote) {
    config.git.remoteConfigured = true;
  }
  saveWorkspaceConfig(paths.workspaceRoot, config);

  writeTextFile(path.join(paths.workspaceRoot, "README.md"), templateWorkspaceReadme());
  writeTextFile(path.join(paths.workspaceRoot, ".gitignore"), templateWorkspaceGitignore());
  writeTextFile(path.join(paths.managedRootPath, "README.md"), templateKnowledgeReadme());
  writeTextFile(path.join(paths.archiveRootPath, "README.md"), "# Archive\n");

  const created = [
    paths.configPath,
    path.join(paths.workspaceRoot, "README.md"),
    path.join(paths.workspaceRoot, ".gitignore"),
    path.join(paths.managedRootPath, "README.md"),
    path.join(paths.archiveRootPath, "README.md")
  ];

  if (options.starterDocs !== false) {
    for (const document of createStarterDocuments()) {
      const absPath = path.join(paths.managedRootPath, document.relPath);
      writeTextFile(absPath, document.content);
      created.push(absPath);
    }
  }

  const warnings: string[] = [];
  if (options.gitInit) {
    if (!isGitAvailable()) {
      warnings.push("Git is not available in PATH. Workspace setup completed without Git initialization.");
    } else {
      initGitRepository(paths.workspaceRoot);
      if (options.gitRemote) {
        configureRemote(paths.workspaceRoot, config.git.remoteName, options.gitRemote);
      }
    }
  }

  registerWorkspaceGlobally(paths.workspaceRoot, { setDefault: true, source: "setup" });

  return {
    workspaceRoot: paths.workspaceRoot,
    configPath: paths.configPath,
    created,
    warnings,
    nextSteps: [
      `company-agent-wiki-cli doctor --workspace ${paths.workspaceRoot} --json`,
      `company-agent-wiki-cli index rebuild --workspace ${paths.workspaceRoot} --json`,
      `company-agent-wiki-cli verify --workspace ${paths.workspaceRoot} --json`,
      `company-agent-wiki-cli serve --workspace ${paths.workspaceRoot} --port 4187`,
      "Other agents can now discover this workspace automatically via the global workspace registry."
    ]
  };
}

export function addRoot(
  workspaceRoot: string,
  rootDefinition: { id: string; rootPath: string; kind?: "managed" | "external" }
): WorkspaceRoot {
  const config = loadWorkspaceConfig(workspaceRoot);
  if (config.roots.some((root) => root.id === rootDefinition.id)) {
    throw new CliError("ROOT_EXISTS", `Root '${rootDefinition.id}' already exists.`, EXIT_CODES.validation);
  }

  const absoluteRoot = path.resolve(rootDefinition.rootPath);
  if (!isDirectory(absoluteRoot)) {
    throw new CliError(
      "ROOT_NOT_FOUND",
      `Markdown root not found: ${absoluteRoot}`,
      EXIT_CODES.notFound
    );
  }

  if (rootDefinition.kind === "managed" && !isPathInsideWorkspace(workspaceRoot, absoluteRoot)) {
    throw new CliError(
      "MANAGED_ROOT_OUTSIDE_WORKSPACE",
      `Managed roots must stay inside the private workspace: ${absoluteRoot}`,
      EXIT_CODES.validation,
      { hint: "Use an external root for outside paths or choose a managed path inside the workspace." }
    );
  }

  const root: WorkspaceRoot = {
    id: rootDefinition.id,
    path: normalizeStoredRootPath(workspaceRoot, absoluteRoot),
    kind: rootDefinition.kind || "external",
    writePolicy: rootDefinition.kind === "managed" ? "agent-only" : "external-read-only"
  };

  config.roots.push(root);
  saveWorkspaceConfig(workspaceRoot, config);
  rememberWorkspaceGlobally(workspaceRoot, { setDefault: true, source: "runtime" });
  return root;
}

export function listRoots(workspaceRoot: string): Array<WorkspaceRoot & { absPath: string; exists: boolean; git: boolean }> {
  const config = loadWorkspaceConfig(workspaceRoot);
  return config.roots.map((root) => {
    const absPath = resolveRootPath(workspaceRoot, root);
    return {
      ...root,
      absPath,
      exists: fileExists(absPath),
      git: fileExists(absPath) ? isGitRepository(absPath) : false
    };
  });
}

export function doctor(workspaceRoot: string): {
  workspaceRoot: string;
  checks: Array<{ name: string; ok: boolean; message: string }>;
} {
  const paths = resolveWorkspacePaths(workspaceRoot);
  const checks: Array<{ name: string; ok: boolean; message: string }> = [];
  const agentsHome = getDefaultAgentsHome();
  const agentsBinDir = path.join(agentsHome, "bin");
  const agentsShimPath = path.join(agentsBinDir, CLI_NAME);
  const codexHome = getDefaultCodexHome();
  const codexBinDir = path.join(codexHome, "bin");
  const codexShimPath = path.join(codexBinDir, CLI_NAME);
  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const registryPath = getGlobalRegistryPath();
  const registry = loadGlobalWorkspaceRegistry();

  checks.push({
    name: "workspace-root",
    ok: isDirectory(paths.workspaceRoot),
    message: isDirectory(paths.workspaceRoot)
      ? `Workspace root exists: ${paths.workspaceRoot}`
      : `Workspace root missing: ${paths.workspaceRoot}`
  });

  checks.push({
    name: "workspace-config",
    ok: fileExists(paths.configPath),
    message: fileExists(paths.configPath)
      ? `Workspace config found: ${paths.configPath}`
      : `Workspace config missing: ${paths.configPath}`
  });

  checks.push({
    name: "git-binary",
    ok: isGitAvailable(),
    message: isGitAvailable() ? "Git is available in PATH." : "Git is not available in PATH."
  });

  checks.push({
    name: "agents-cli-shim",
    ok: fileExists(agentsShimPath),
    message: fileExists(agentsShimPath)
      ? `Shared agent CLI shim found: ${agentsShimPath}`
      : `Shared agent CLI shim missing: ${agentsShimPath}`
  });

  checks.push({
    name: "agents-bin-in-path",
    ok: pathEntries.includes(agentsBinDir),
    message: pathEntries.includes(agentsBinDir)
      ? `Shared agent bin directory is available in PATH: ${agentsBinDir}`
      : `Shared agent bin directory is not in PATH: ${agentsBinDir}`
  });

  checks.push({
    name: "codex-cli-shim",
    ok: fileExists(codexShimPath),
    message: fileExists(codexShimPath)
      ? `Codex compatibility shim found: ${codexShimPath}`
      : `Codex compatibility shim missing: ${codexShimPath}`
  });

  checks.push({
    name: "codex-bin-in-path",
    ok: pathEntries.includes(codexBinDir),
    message: pathEntries.includes(codexBinDir)
      ? `Codex bin directory is available in PATH: ${codexBinDir}`
      : `Codex bin directory is not in PATH: ${codexBinDir}`
  });

  checks.push({
    name: "global-workspace-registry",
    ok: fileExists(registryPath),
    message: fileExists(registryPath)
      ? `Global workspace registry found: ${registryPath}`
      : `Global workspace registry missing: ${registryPath}`
  });

  checks.push({
    name: "global-default-workspace",
    ok:
      typeof registry.defaultWorkspace === "string" &&
      fileExists(resolveWorkspacePaths(registry.defaultWorkspace).configPath),
    message:
      typeof registry.defaultWorkspace === "string"
        ? `Global default workspace: ${registry.defaultWorkspace}`
        : "No global default workspace registered yet."
  });

  if (fileExists(paths.configPath)) {
    const config = loadWorkspaceConfig(workspaceRoot);
    for (const root of config.roots) {
      const absPath = resolveRootPath(workspaceRoot, root);
      checks.push({
        name: `root:${root.id}`,
        ok: isDirectory(absPath),
        message: isDirectory(absPath) ? `Root is available: ${absPath}` : `Root is missing: ${absPath}`
      });
    }
  }

  checks.push({
    name: "index-database",
    ok: fileExists(paths.indexDbPath),
    message: fileExists(paths.indexDbPath)
      ? `Index database present: ${paths.indexDbPath}`
      : `Index database missing: ${paths.indexDbPath}`
  });

  checks.push({
    name: "index-manifest",
    ok: fileExists(paths.indexManifestPath),
    message: fileExists(paths.indexManifestPath)
      ? `Index manifest present: ${paths.indexManifestPath}`
      : `Index manifest missing: ${paths.indexManifestPath}`
  });

  return {
    workspaceRoot: paths.workspaceRoot,
    checks
  };
}
