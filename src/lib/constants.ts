export const PACKAGE_NAME = "@codecell-germany/company-agent-wiki-skill";
export const CLI_NAME = "company-agent-wiki-cli";
export const INSTALLER_NAME = "company-agent-wiki-skill";
export const SKILL_NAME = "company-agent-wiki-cli";

export const WORKSPACE_INTERNAL_DIR = ".company-agent-wiki";
export const WORKSPACE_CONFIG_FILE = "workspace.json";
export const INDEX_DB_FILE = "index.sqlite";
export const INDEX_MANIFEST_FILE = "index-manifest.json";
export const GLOBAL_REGISTRY_DIR_NAME = "company-agent-wiki";
export const GLOBAL_REGISTRY_FILE = "workspaces.json";
export const WORKSPACE_LAYOUT_VERSION = 1;
export const CLI_SCHEMA_VERSION = "2026-04-14";
export const INDEX_SCHEMA_VERSION = 2;

export const DEFAULT_MANAGED_ROOT_ID = "canonical";
export const DEFAULT_MANAGED_ROOT_PATH = "knowledge/canonical";
export const DEFAULT_ARCHIVE_ROOT_PATH = "knowledge/archive";

export const EXIT_CODES = {
  ok: 0,
  usage: 1,
  config: 2,
  indexStale: 3,
  indexMissing: 4,
  validation: 5,
  notFound: 6,
  git: 7,
  sqliteLocked: 8,
  workspaceBusy: 9,
  runtime: 10
} as const;
