export type RootKind = "managed" | "external";

export interface WorkspaceRoot {
  id: string;
  path: string;
  kind: RootKind;
  writePolicy: "agent-only" | "external-read-only";
}

export interface WorkspaceConfig {
  schemaVersion: number;
  workspaceId: string;
  createdAt: string;
  managedRootId: string;
  roots: WorkspaceRoot[];
  index: {
    databasePath: string;
    manifestPath: string;
  };
  git: {
    enabled: boolean;
    remoteName: string;
    remoteConfigured: boolean;
  };
}

export interface RootSnapshot {
  id: string;
  path: string;
  kind: RootKind;
  fileCount: number;
  latestMtimeMs: number;
  fingerprint: string;
  git?: {
    repoRoot: string;
    head?: string;
    dirty: boolean;
  };
}

export interface VerifyRootStatus {
  id: string;
  ok: boolean;
  reason?: string;
  current?: RootSnapshot;
  expected?: RootSnapshot;
}

export interface VerifyResult {
  ok: boolean;
  state: "ok" | "missing" | "stale";
  manifest?: IndexManifest;
  roots: VerifyRootStatus[];
  hint?: string;
}

export interface IndexManifest {
  buildId: string;
  schemaVersion: number;
  indexedAt: string;
  workspacePath: string;
  documentCount: number;
  sectionCount: number;
  roots: RootSnapshot[];
}

export interface DocumentRecord {
  docId: string;
  rootId: string;
  relPath: string;
  absPath: string;
  title: string;
  docType?: string;
  status?: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  bodyText: string;
  fileHash: string;
  mtimeMs: number;
}

export interface SectionRecord {
  sectionId: string;
  docId: string;
  rootId: string;
  heading: string;
  headingPath: string;
  level: number;
  ordinal: number;
  content: string;
  tokenCount: number;
}

export interface SearchResult {
  docId: string;
  sectionId: string;
  title: string;
  headingPath: string;
  absPath: string;
  relPath: string;
  snippet: string;
  score: number;
  rawScore: number;
  metadata: DocumentMetadataView;
}

export interface DocumentMetadataView {
  docId: string;
  title: string;
  absPath: string;
  relPath: string;
  docType?: string;
  status?: string;
  tags: string[];
  summary?: string;
  project?: string;
  department?: string;
  owners: string[];
  systems: string[];
  frontmatter: Record<string, unknown>;
}

export interface DocumentHeadingView {
  heading: string;
  headingPath: string;
  level: number;
  ordinal: number;
}

export interface SearchFilters {
  docType?: string;
  status?: string;
  tags?: string[];
  project?: string[];
  department?: string[];
  owners?: string[];
  systems?: string[];
}

export interface HistoryEntry {
  commit: string;
  committedAt: string;
  author: string;
  subject: string;
}

export interface CliEnvelope<T> {
  ok: true;
  command: string;
  version: string;
  buildId?: string;
  warnings: string[];
  data: T;
}

export interface CliErrorPayload {
  ok: false;
  command: string;
  version: string;
  error: {
    code: string;
    message: string;
    hint?: string;
    details?: unknown;
  };
}
