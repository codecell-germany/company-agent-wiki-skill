import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { EXIT_CODES, INDEX_SCHEMA_VERSION } from "./constants";
import { CliError, coerceCliError, isSqliteLockError } from "./errors";
import { fileExists, readJsonFile, replaceFileAtomic, walkMarkdownFiles, writeJsonAtomic } from "./fs-utils";
import { sha256, newBuildId } from "./hash";
import { snapshotGitState } from "./git";
import { parseMarkdownDocument } from "./markdown";
import { loadWorkspaceConfig, resolveRootPath, resolveWorkspacePaths } from "./workspace";
import { withWorkspaceWriteLock } from "./write-lock";
import type {
  CoverageResult,
  DocumentHeadingView,
  DocumentMetadataView,
  DocumentRecord,
  IndexManifest,
  RouteDebugCandidate,
  RouteDebugResult,
  RouteGroup,
  RouteResult,
  RootSnapshot,
  SearchFilters,
  SearchResult,
  SectionRecord,
  VerifyResult
} from "./types";

function openDatabase(databasePath: string, options?: { readonly?: boolean }): Database.Database {
  try {
    const database = new Database(
      databasePath,
      options?.readonly ? { readonly: true, fileMustExist: true } : undefined
    );
    database.pragma("busy_timeout = 5000");
    if (options?.readonly) {
      database.pragma("query_only = 1");
    } else {
      database.pragma("journal_mode = WAL");
      database.pragma("synchronous = NORMAL");
    }
    return database;
  } catch (error) {
    throw (
      coerceCliError(error, {
        sqliteLockHint:
          "Retry in a moment and avoid running multiple CLI commands in parallel against the same workspace."
      }) || error
    );
  }
}

function closeDatabaseQuietly(database: Database.Database | undefined): void {
  if (!database) {
    return;
  }

  try {
    database.close();
  } catch {
    // best effort close
  }
}

function throwKnownDatabaseError(error: unknown, workspaceRoot: string): never {
  const cliError = coerceCliError(error, {
    sqliteLockHint: `Retry in a moment, serialize parallel CLI reads against ${path.resolve(
      workspaceRoot
    )}, or rerun with --auto-rebuild after the current write finishes.`,
    sqliteLockDetails: {
      workspaceRoot: path.resolve(workspaceRoot)
    }
  });
  if (cliError) {
    throw cliError;
  }
  throw error;
}

function createSchema(database: Database.Database): void {
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE roots (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      file_count INTEGER NOT NULL,
      latest_mtime_ms INTEGER NOT NULL,
      git_repo_root TEXT,
      git_head TEXT,
      git_dirty INTEGER NOT NULL,
      indexed_at TEXT NOT NULL
    );

    CREATE TABLE documents (
      doc_id TEXT PRIMARY KEY,
      root_id TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      abs_path TEXT NOT NULL,
      title TEXT NOT NULL,
      doc_type TEXT,
      status TEXT,
      tags_json TEXT NOT NULL,
      frontmatter_json TEXT NOT NULL,
      body_text TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE documents_fts USING fts5(
      doc_id UNINDEXED,
      title,
      description,
      summary,
      aliases,
      rel_path,
      body_text,
      tags,
      tokenize = 'porter unicode61'
    );

    CREATE TABLE sections (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id TEXT UNIQUE NOT NULL,
      doc_id TEXT NOT NULL,
      root_id TEXT NOT NULL,
      heading TEXT NOT NULL,
      heading_path TEXT NOT NULL,
      level INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE sections_fts USING fts5(
      section_id UNINDEXED,
      doc_id UNINDEXED,
      title,
      description,
      summary,
      aliases,
      heading,
      heading_path,
      content,
      tags,
      tokenize = 'porter unicode61'
    );
  `);
}

function collectRootSnapshot(rootId: string, rootPath: string, kind: "managed" | "external"): RootSnapshot {
  const markdownFiles = walkMarkdownFiles(rootPath);
  const entries: string[] = [];
  let latestMtimeMs = 0;

  for (const filePath of markdownFiles) {
    const stats = fs.statSync(filePath);
    const relPath = path.relative(rootPath, filePath);
    latestMtimeMs = Math.max(latestMtimeMs, Math.trunc(stats.mtimeMs));
    entries.push(`${relPath}|${stats.size}|${Math.trunc(stats.mtimeMs)}`);
  }

  return {
    id: rootId,
    path: rootPath,
    kind,
    fileCount: markdownFiles.length,
    latestMtimeMs,
    fingerprint: sha256(entries.join("\n")),
    git: snapshotGitState(rootPath)
  };
}

function insertRoot(database: Database.Database, snapshot: RootSnapshot, indexedAt: string): void {
  database
    .prepare(
      `
        INSERT INTO roots (
          id, path, kind, fingerprint, file_count, latest_mtime_ms,
          git_repo_root, git_head, git_dirty, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      snapshot.id,
      snapshot.path,
      snapshot.kind,
      snapshot.fingerprint,
      snapshot.fileCount,
      snapshot.latestMtimeMs,
      snapshot.git?.repoRoot ?? null,
      snapshot.git?.head ?? null,
      snapshot.git?.dirty ? 1 : 0,
      indexedAt
    );
}

function insertDocument(database: Database.Database, document: DocumentRecord): void {
  const searchableMetadata = extractSearchableMetadata(document.frontmatter);
  database
    .prepare(
      `
        INSERT INTO documents (
          doc_id, root_id, rel_path, abs_path, title, doc_type, status,
          tags_json, frontmatter_json, body_text, file_hash, mtime_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      document.docId,
      document.rootId,
      document.relPath,
      document.absPath,
      document.title,
      document.docType ?? null,
      document.status ?? null,
      JSON.stringify(document.tags),
      JSON.stringify(document.frontmatter),
      document.bodyText,
      document.fileHash,
      document.mtimeMs
    );

  database
    .prepare(
      `
        INSERT INTO documents_fts (
          doc_id, title, description, summary, aliases, rel_path, body_text, tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      document.docId,
      document.title,
      searchableMetadata.description ?? "",
      searchableMetadata.summary ?? "",
      searchableMetadata.aliases.join(" "),
      document.relPath,
      document.bodyText,
      document.tags.join(" ")
    );
}

function insertSections(database: Database.Database, document: DocumentRecord, sections: SectionRecord[]): void {
  const searchableMetadata = extractSearchableMetadata(document.frontmatter);
  const sectionInsert = database.prepare(
    `
      INSERT INTO sections (
        section_id, doc_id, root_id, heading, heading_path, level, ordinal, content, token_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  );

  const ftsInsert = database.prepare(
    `
        INSERT INTO sections_fts (
          rowid, section_id, doc_id, title, description, summary, aliases, heading, heading_path, content, tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
  );

  for (const section of sections) {
    const result = sectionInsert.run(
      section.sectionId,
      section.docId,
      section.rootId,
      section.heading,
      section.headingPath,
      section.level,
      section.ordinal,
      section.content,
      section.tokenCount
    );
    ftsInsert.run(
      result.lastInsertRowid,
      section.sectionId,
      section.docId,
      document.title,
      searchableMetadata.description ?? "",
      searchableMetadata.summary ?? "",
      searchableMetadata.aliases.join(" "),
      section.heading,
      section.headingPath,
      section.content,
      document.tags.join(" ")
    );
  }
}

function normalizeStringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim());
    if (typeof first === "string") {
      return first.trim();
    }
  }

  return undefined;
}

function normalizeStringArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function dedupeNormalized(values: string[]): string[] {
  const deduped = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = trimmed.toLocaleLowerCase("de-DE");
    if (!deduped.has(normalized)) {
      deduped.set(normalized, trimmed);
    }
  }
  return [...deduped.values()];
}

function collectAliasValues(frontmatter: Record<string, unknown>): string[] {
  return dedupeNormalized([
    ...normalizeStringArrayValue(frontmatter.aliases),
    ...normalizeStringArrayValue(frontmatter.search_terms),
    ...normalizeStringArrayValue(frontmatter.searchTerms),
    ...normalizeStringArrayValue(frontmatter.synonyms)
  ]);
}

function extractSearchableMetadata(frontmatter: Record<string, unknown>): {
  description?: string;
  summary?: string;
  aliases: string[];
} {
  const description = normalizeStringValue(frontmatter.description) ?? normalizeStringValue(frontmatter.summary);
  const summary = normalizeStringValue(frontmatter.summary) ?? description;
  const aliases = collectAliasValues(frontmatter);
  return {
    description,
    summary,
    aliases
  };
}

function buildDocumentMetadataView(row: {
  docId: string;
  title: string;
  absPath: string;
  relPath: string;
  docType?: string | null;
  status?: string | null;
  tagsJson: string;
  frontmatterJson: string;
}): DocumentMetadataView {
  const frontmatter = JSON.parse(row.frontmatterJson) as Record<string, unknown>;
  const tags = JSON.parse(row.tagsJson) as string[];
  const searchableMetadata = extractSearchableMetadata(frontmatter);

  return {
    docId: row.docId,
    title: row.title,
    absPath: row.absPath,
    relPath: row.relPath,
    docType: row.docType ?? undefined,
    status: row.status ?? undefined,
    tags,
    aliases: searchableMetadata.aliases,
    description: searchableMetadata.description,
    summary: searchableMetadata.summary,
    project: normalizeStringValue(frontmatter.project),
    department: normalizeStringValue(frontmatter.department),
    owners: normalizeStringArrayValue(frontmatter.owners),
    systems: normalizeStringArrayValue(frontmatter.systems),
    frontmatter
  };
}

function includesNormalized(haystack: string | undefined, needles: string[] | undefined): boolean {
  if (!needles || needles.length === 0) {
    return true;
  }
  if (!haystack) {
    return false;
  }

  const normalizedHaystack = haystack.toLowerCase();
  return needles.some((needle) => normalizedHaystack === needle.toLowerCase());
}

function intersectsNormalized(haystack: string[], needles: string[] | undefined): boolean {
  if (!needles || needles.length === 0) {
    return true;
  }
  const normalizedHaystack = new Set(haystack.map((entry) => entry.toLowerCase()));
  return needles.some((needle) => normalizedHaystack.has(needle.toLowerCase()));
}

function matchesFilters(metadata: DocumentMetadataView, filters?: SearchFilters): boolean {
  if (!filters) {
    return true;
  }

  if (filters.docType && metadata.docType?.toLowerCase() !== filters.docType.toLowerCase()) {
    return false;
  }

  if (filters.status && metadata.status?.toLowerCase() !== filters.status.toLowerCase()) {
    return false;
  }

  if (!intersectsNormalized(metadata.tags, filters.tags)) {
    return false;
  }

  if (!includesNormalized(metadata.project, filters.project)) {
    return false;
  }

  if (!includesNormalized(metadata.department, filters.department)) {
    return false;
  }

  if (!intersectsNormalized(metadata.owners, filters.owners)) {
    return false;
  }

  if (!intersectsNormalized(metadata.systems, filters.systems)) {
    return false;
  }

  return true;
}

export function rebuildIndexUnlocked(workspaceRoot: string): IndexManifest {
  const config = loadWorkspaceConfig(workspaceRoot);
  const paths = resolveWorkspacePaths(workspaceRoot);
  const tempDbPath = `${paths.indexDbPath}.${process.pid}.${Date.now()}.${newBuildId()}.next`;
  const indexedAt = new Date().toISOString();

  if (fileExists(tempDbPath)) {
    fs.unlinkSync(tempDbPath);
  }

  let database: Database.Database | undefined;
  try {
    database = openDatabase(tempDbPath);
    createSchema(database);

    const insertMetadata = database.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)");
    insertMetadata.run("schema_version", String(INDEX_SCHEMA_VERSION));
    const buildId = newBuildId();
    insertMetadata.run("build_id", buildId);
    insertMetadata.run("workspace_root", paths.workspaceRoot);
    insertMetadata.run("indexed_at", indexedAt);

    let documentCount = 0;
    let sectionCount = 0;
    const snapshots: RootSnapshot[] = [];

    for (const root of config.roots) {
      const rootPath = resolveRootPath(paths.workspaceRoot, root);
      if (!fileExists(rootPath)) {
        throw new CliError(
          "ROOT_NOT_FOUND",
          `Registered root is missing: ${rootPath}`,
          EXIT_CODES.notFound,
          { hint: "Fix the root path or remove the root before rebuilding the index." }
        );
      }

      const snapshot = collectRootSnapshot(root.id, rootPath, root.kind);
      snapshots.push(snapshot);
      insertRoot(database, snapshot, indexedAt);

      const markdownFiles = walkMarkdownFiles(rootPath);
      for (const filePath of markdownFiles) {
        const rawContent = fs.readFileSync(filePath, "utf8");
        const stats = fs.statSync(filePath);
        const relPath = path.relative(rootPath, filePath);
        const parsed = parseMarkdownDocument(filePath, relPath, root.id, rawContent, Math.trunc(stats.mtimeMs));

        insertDocument(database, parsed.document);
        insertSections(database, parsed.document, parsed.sections);
        documentCount += 1;
        sectionCount += parsed.sections.length;
      }
    }

    database.exec("INSERT INTO sections_fts(sections_fts) VALUES('optimize');");
    closeDatabaseQuietly(database);
    database = undefined;

    replaceFileAtomic(paths.indexDbPath, fs.readFileSync(tempDbPath));
    fs.unlinkSync(tempDbPath);

    const manifest: IndexManifest = {
      buildId,
      schemaVersion: INDEX_SCHEMA_VERSION,
      indexedAt,
      workspacePath: paths.workspaceRoot,
      documentCount,
      sectionCount,
      roots: snapshots
    };
    writeJsonAtomic(paths.indexManifestPath, manifest);

    return manifest;
  } catch (error) {
    closeDatabaseQuietly(database);
    if (fileExists(tempDbPath)) {
      fs.rmSync(tempDbPath, { force: true });
    }
    throwKnownDatabaseError(error, workspaceRoot);
  }
}

export function rebuildIndex(workspaceRoot: string): IndexManifest {
  return withWorkspaceWriteLock(workspaceRoot, "index-rebuild", () => rebuildIndexUnlocked(workspaceRoot));
}

export function readManifest(workspaceRoot: string): IndexManifest {
  const paths = resolveWorkspacePaths(workspaceRoot);
  if (!fileExists(paths.indexManifestPath)) {
    throw new CliError(
      "INDEX_MISSING",
      `Index manifest missing at ${paths.indexManifestPath}`,
      EXIT_CODES.indexMissing,
      {
        hint: `Run: company-agent-wiki-cli index rebuild --workspace ${paths.workspaceRoot}`
      }
    );
  }

  return readJsonFile<IndexManifest>(paths.indexManifestPath);
}

export function verifyIndex(workspaceRoot: string): VerifyResult {
  const config = loadWorkspaceConfig(workspaceRoot);
  let manifest: IndexManifest;
  try {
    manifest = readManifest(workspaceRoot);
  } catch (error) {
    if (error instanceof CliError && error.code === "INDEX_MISSING") {
      return {
        ok: false,
        state: "missing",
        roots: [],
        hint: error.hint
      };
    }
    throw error;
  }

  if (manifest.schemaVersion !== INDEX_SCHEMA_VERSION) {
    return {
      ok: false,
      state: "stale",
      manifest,
      roots: manifest.roots.map((root) => ({
        id: root.id,
        ok: false,
        reason: `Indexed schema version ${manifest.schemaVersion} does not match expected schema ${INDEX_SCHEMA_VERSION}.`
      }))
    };
  }

  const roots = manifest.roots.map((expected) => {
    const rootConfig = config.roots.find((root) => root.id === expected.id);
    if (!rootConfig) {
      return {
        id: expected.id,
        ok: false,
        reason: "Root removed from workspace config.",
        expected
      };
    }

    const currentRootPath = resolveRootPath(workspaceRoot, rootConfig);
    if (!fileExists(currentRootPath)) {
      return {
        id: expected.id,
        ok: false,
        reason: `Root path missing: ${currentRootPath}`,
        expected
      };
    }

    const current = collectRootSnapshot(expected.id, currentRootPath, rootConfig.kind);
    const matches =
      current.fingerprint === expected.fingerprint &&
      current.fileCount === expected.fileCount &&
      current.latestMtimeMs === expected.latestMtimeMs;

    return {
      id: expected.id,
      ok: matches,
      reason: matches ? undefined : "Root snapshot differs from indexed manifest.",
      expected,
      current
    };
  });

  return {
    ok: roots.every((root) => root.ok),
    state: roots.every((root) => root.ok) ? "ok" : "stale",
    manifest,
    roots
  };
}

function requireFreshIndex(workspaceRoot: string, options?: { autoRebuild?: boolean }): IndexManifest {
  const verification = verifyIndex(workspaceRoot);
  if (verification.state === "missing") {
    if (options?.autoRebuild) {
      return rebuildIndex(workspaceRoot);
    }
    throw new CliError(
      "INDEX_MISSING",
      "The workspace has not been indexed yet.",
      EXIT_CODES.indexMissing,
      {
        hint:
          verification.hint || `Run: company-agent-wiki-cli index rebuild --workspace ${path.resolve(workspaceRoot)}`
      }
    );
  }

  if (!verification.ok) {
    if (options?.autoRebuild) {
      return rebuildIndex(workspaceRoot);
    }
    throw new CliError(
      "INDEX_STALE",
      "The indexed snapshot no longer matches the current roots.",
      EXIT_CODES.indexStale,
      {
        hint: `Run: company-agent-wiki-cli index rebuild --workspace ${path.resolve(workspaceRoot)}`,
        details: verification.roots.filter((root) => !root.ok)
      }
    );
  }
  return verification.manifest as IndexManifest;
}

function openVerifiedDatabase(
  workspaceRoot: string,
  options?: { autoRebuild?: boolean }
): { database: Database.Database; manifest: IndexManifest } {
  const manifest = requireFreshIndex(workspaceRoot, options);
  const paths = resolveWorkspacePaths(workspaceRoot);
  if (!fileExists(paths.indexDbPath)) {
    throw new CliError(
      "INDEX_MISSING",
      `Index database missing at ${paths.indexDbPath}`,
      EXIT_CODES.indexMissing,
      { hint: `Run: company-agent-wiki-cli index rebuild --workspace ${paths.workspaceRoot}` }
    );
  }

  return {
    database: openDatabase(paths.indexDbPath, { readonly: true }),
    manifest
  };
}

function extractQueryTokens(query: string): string[] {
  const rawTokens = query.match(/[\p{L}\p{N}]+/gu)?.map((token) => token.trim()).filter(Boolean) ?? [];
  const tokens = dedupeNormalized(rawTokens);
  if (tokens.length === 0) {
    throw new CliError(
      "INVALID_QUERY",
      "The search query does not contain any searchable terms.",
      EXIT_CODES.validation,
      { hint: "Use letters or numbers in the query, for example: KI Telefonassistent Buchhaltung." }
    );
  }
  return tokens;
}

function buildFtsMatchQuery(query: string): string {
  return extractQueryTokens(query)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(" OR ");
}

function normalizeComparableText(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/ß/gu, "ss")
    .toLocaleLowerCase("de-DE")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function includesComparableToken(haystack: string, token: string): boolean {
  if (!haystack || !token) {
    return false;
  }
  return haystack.includes(token);
}

function buildFieldHitReasons(matchedFields: string[], exactPhraseFields: string[]): string[] {
  const reasons: string[] = [];
  if (exactPhraseFields.length > 0) {
    reasons.push(`Exakte Phrasenübereinstimmung in: ${exactPhraseFields.join(", ")}`);
  }
  if (matchedFields.length > 0) {
    reasons.push(`Token-Treffer in: ${matchedFields.join(", ")}`);
  }
  return reasons;
}

function chooseBestHeading(queryTokens: string[], headings: string[]): string {
  if (headings.length === 0) {
    return "Document";
  }

  let bestHeading = headings[0];
  let bestScore = -1;
  for (const heading of headings) {
    const normalizedHeading = normalizeComparableText(heading);
    let score = 0;
    for (const token of queryTokens) {
      if (includesComparableToken(normalizedHeading, normalizeComparableText(token))) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestHeading = heading;
    }
  }
  return bestHeading;
}

function buildRouteSignals(
  query: string,
  metadata: DocumentMetadataView,
  headingPath: string
): { score: number; matchedTokens: string[]; matchedFields: string[]; exactPhraseFields: string[]; coverage: number; reasons: string[] } {
  const tokens = extractQueryTokens(query).map((token) => normalizeComparableText(token));
  const normalizedQuery = normalizeComparableText(query);
  const normalizedTitle = normalizeComparableText(metadata.title);
  const normalizedDescription = normalizeComparableText(metadata.description);
  const normalizedSummary = normalizeComparableText(metadata.summary);
  const normalizedHeading = normalizeComparableText(headingPath);
  const normalizedRelPath = normalizeComparableText(metadata.relPath);
  const normalizedTags = metadata.tags.map((entry) => normalizeComparableText(entry));
  const normalizedAliases = metadata.aliases.map((entry) => normalizeComparableText(entry));

  const matchedTokens = new Set<string>();
  const matchedFields = new Set<string>();
  const exactPhraseFields = new Set<string>();
  let signalScore = 0;

  const addExactPhrase = (field: string, amount: number, haystack: string | string[]): void => {
    const hit = Array.isArray(haystack)
      ? haystack.some((entry) => entry.includes(normalizedQuery))
      : haystack.includes(normalizedQuery);
    if (!normalizedQuery || !hit) {
      return;
    }
    exactPhraseFields.add(field);
    matchedFields.add(field);
    signalScore += amount;
  };

  addExactPhrase("title", 6, normalizedTitle);
  addExactPhrase("description", 5, normalizedDescription);
  addExactPhrase("summary", 4.5, normalizedSummary);
  addExactPhrase("aliases", 6.5, normalizedAliases);
  addExactPhrase("headings", 5.5, normalizedHeading);
  addExactPhrase("path", 4, normalizedRelPath);

  for (const token of tokens) {
    let tokenMatched = false;

    if (includesComparableToken(normalizedTitle, token)) {
      matchedFields.add("title");
      signalScore += 3.5;
      tokenMatched = true;
    }
    if (includesComparableToken(normalizedDescription, token)) {
      matchedFields.add("description");
      signalScore += 3;
      tokenMatched = true;
    }
    if (includesComparableToken(normalizedSummary, token)) {
      matchedFields.add("summary");
      signalScore += 2.5;
      tokenMatched = true;
    }
    if (includesComparableToken(normalizedHeading, token)) {
      matchedFields.add("headings");
      signalScore += 3;
      tokenMatched = true;
    }
    if (includesComparableToken(normalizedRelPath, token)) {
      matchedFields.add("path");
      signalScore += 2;
      tokenMatched = true;
    }
    if (normalizedTags.some((entry) => entry === token || includesComparableToken(entry, token))) {
      matchedFields.add("tags");
      signalScore += 3.5;
      tokenMatched = true;
    }
    if (normalizedAliases.some((entry) => entry === token || includesComparableToken(entry, token))) {
      matchedFields.add("aliases");
      signalScore += 4;
      tokenMatched = true;
    }

    if (tokenMatched) {
      matchedTokens.add(token);
    }
  }

  const coverage = tokens.length === 0 ? 0 : matchedTokens.size / tokens.length;
  if (coverage === 1 && tokens.length > 1) {
    signalScore += 4;
  } else {
    signalScore += coverage * 2;
  }

  const denominator = Math.max(10, tokens.length * 12);
  const score = Number(Math.min(1, signalScore / denominator).toFixed(6));

  return {
    score,
    matchedTokens: [...matchedTokens.values()],
    matchedFields: [...matchedFields.values()],
    exactPhraseFields: [...exactPhraseFields.values()],
    coverage: Number(coverage.toFixed(6)),
    reasons: buildFieldHitReasons([...matchedFields.values()], [...exactPhraseFields.values()])
  };
}

function isFtsQueryError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /fts5|syntax error|no such column|malformed|unterminated/i.test(error.message);
}

function normalizeSearchScore(rawScore: number): number {
  return Number((1 / (1 + Math.exp(rawScore))).toFixed(6));
}

export function search(
  workspaceRoot: string,
  query: string,
  limit: number,
  options?: { autoRebuild?: boolean; filters?: SearchFilters }
): { manifest: IndexManifest; results: SearchResult[] } {
  let database: Database.Database | undefined;
  let manifest: IndexManifest | undefined;
  try {
    const opened = openVerifiedDatabase(workspaceRoot, options);
    database = opened.database;
    manifest = opened.manifest;
  } catch (error) {
    throwKnownDatabaseError(error, workspaceRoot);
  }
  const safeQuery = buildFtsMatchQuery(query);
  const sectionStatement = database.prepare(
    `
      SELECT
        s.doc_id as docId,
        s.section_id as sectionId,
        d.title as title,
        s.heading_path as headingPath,
        d.abs_path as absPath,
        d.rel_path as relPath,
        d.doc_type as docType,
        d.status as status,
        d.tags_json as tagsJson,
        d.frontmatter_json as frontmatterJson,
        snippet(sections_fts, 8, '<mark>', '</mark>', ' … ', 18) as snippet,
        bm25(sections_fts) as score
      FROM sections_fts
      JOIN sections s ON s.row_id = sections_fts.rowid
      JOIN documents d ON d.doc_id = s.doc_id
      WHERE sections_fts MATCH ?
      ORDER BY bm25(sections_fts)
      LIMIT ?
    `
  );

  const compareSearchResults = (left: SearchResult, right: SearchResult): number => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.rawScore - right.rawScore;
  };

  let results: SearchResult[] = [];
  try {
    const sectionRows = sectionStatement.all(safeQuery, limit * 8) as Array<
      Omit<SearchResult, "metadata"> & { docType?: string | null; status?: string | null; tagsJson: string; frontmatterJson: string }
    >;
    results = sectionRows
      .map((row) => {
        const metadata = buildDocumentMetadataView(row);
        const routeSignals = buildRouteSignals(query, metadata, row.headingPath);
        const combinedScore = Number(
          Math.min(1, normalizeSearchScore(row.score) * 0.35 + routeSignals.score * 0.65).toFixed(6)
        );

        return {
          docId: row.docId,
          sectionId: row.sectionId,
          title: row.title,
          headingPath: row.headingPath,
          absPath: row.absPath,
          relPath: row.relPath,
          snippet: row.snippet,
          score: combinedScore,
          rawScore: row.score,
          metadata
        };
      })
      .filter((row) => matchesFilters(row.metadata, options?.filters))
      .sort(compareSearchResults)
      .slice(0, limit);

    if (results.length < limit) {
      const documentStatement = database.prepare(
        `
          SELECT
            d.doc_id as docId,
            d.doc_id || '#document' as sectionId,
            d.title as title,
            'Document' as headingPath,
            d.abs_path as absPath,
            d.rel_path as relPath,
            d.doc_type as docType,
            d.status as status,
            d.tags_json as tagsJson,
            d.frontmatter_json as frontmatterJson,
            snippet(documents_fts, 6, '<mark>', '</mark>', ' … ', 24) as snippet,
            bm25(documents_fts) as score
          FROM documents_fts
          JOIN documents d ON d.doc_id = documents_fts.doc_id
          WHERE documents_fts MATCH ?
          ORDER BY bm25(documents_fts)
          LIMIT ?
        `
      );

      const existingDocIds = new Set(results.map((item) => item.docId));
      const documentRows = documentStatement.all(safeQuery, limit * 8) as Array<
        Omit<SearchResult, "metadata"> & { docType?: string | null; status?: string | null; tagsJson: string; frontmatterJson: string }
      >;
      for (const row of documentRows) {
        const metadata = buildDocumentMetadataView(row);
        const routeSignals = buildRouteSignals(query, metadata, row.headingPath);
        const hydrated: SearchResult = {
          docId: row.docId,
          sectionId: row.sectionId,
          title: row.title,
          headingPath: row.headingPath,
          absPath: row.absPath,
          relPath: row.relPath,
          snippet: row.snippet,
          score: Number(
            Math.min(1, normalizeSearchScore(row.score) * 0.35 + routeSignals.score * 0.65).toFixed(6)
          ),
          rawScore: row.score,
          metadata
        };

        if (existingDocIds.has(hydrated.docId) || !matchesFilters(hydrated.metadata, options?.filters)) {
          continue;
        }
        results.push(hydrated);
        existingDocIds.add(hydrated.docId);
        if (results.length >= limit) {
          break;
        }
      }
      results.sort(compareSearchResults);
    }
  } catch (error) {
    closeDatabaseQuietly(database);
    if (isSqliteLockError(error)) {
      throwKnownDatabaseError(error, workspaceRoot);
    }
    if (isFtsQueryError(error)) {
      throw new CliError(
        "INVALID_QUERY",
        "The search query could not be translated into a valid SQLite FTS query.",
        EXIT_CODES.validation,
        { hint: "Use normal free text. The CLI now normalizes queries like KI-Telefonassistent automatically." }
      );
    }
    throw error;
  }

  closeDatabaseQuietly(database);
  return { manifest: manifest as IndexManifest, results };
}

function isStrongRouteCandidate(candidate: RouteGroup): boolean {
  return (
    candidate.score >= 0.58 ||
    candidate.signals.exactPhraseFields.some((field) => ["aliases", "title", "headings"].includes(field)) ||
    (candidate.signals.coverage >= 0.6 && candidate.score >= 0.42)
  );
}

function isNearMissRouteCandidate(candidate: RouteGroup): boolean {
  return candidate.score >= 0.18 || candidate.signals.matchedTokens.length > 0;
}

function compareRouteCandidates(left: RouteGroup, right: RouteGroup): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  return left.rawScore - right.rawScore;
}

function buildRouteGroup(
  query: string,
  candidate: {
    docId: string;
    title: string;
    absPath: string;
    relPath: string;
    bestSectionId: string;
    bestHeading: string;
    bestSnippet: string;
    rawScore: number;
    metadata: DocumentMetadataView;
  },
  source: "fts" | "fallback"
): RouteGroup {
  const routeSignals = buildRouteSignals(query, candidate.metadata, candidate.bestHeading);
  return {
    docId: candidate.docId,
    title: candidate.title,
    absPath: candidate.absPath,
    relPath: candidate.relPath,
    bestSectionId: candidate.bestSectionId,
    bestHeading: candidate.bestHeading,
    bestSnippet: candidate.bestSnippet,
    score: routeSignals.score,
    rawScore: candidate.rawScore,
    metadata: candidate.metadata,
    signals: {
      matchedTokens: routeSignals.matchedTokens,
      matchedFields: routeSignals.matchedFields,
      exactPhraseFields: routeSignals.exactPhraseFields,
      coverage: routeSignals.coverage,
      source
    }
  };
}

function listFallbackRouteCandidates(
  workspaceRoot: string,
  query: string,
  options?: { autoRebuild?: boolean; filters?: SearchFilters }
): { manifest: IndexManifest; candidates: RouteDebugCandidate[] } {
  let database: Database.Database | undefined;
  let manifest: IndexManifest | undefined;
  try {
    const opened = openVerifiedDatabase(workspaceRoot, options);
    database = opened.database;
    manifest = opened.manifest;

    const rows = database
      .prepare(
        `
          SELECT
            d.doc_id as docId,
            d.title as title,
            d.abs_path as absPath,
            d.rel_path as relPath,
            d.doc_type as docType,
            d.status as status,
            d.tags_json as tagsJson,
            d.frontmatter_json as frontmatterJson,
            GROUP_CONCAT(s.heading_path, ' || ') as headingPaths
          FROM documents d
          LEFT JOIN sections s ON s.doc_id = d.doc_id
          GROUP BY d.doc_id
        `
      )
      .all() as Array<{
      docId: string;
      title: string;
      absPath: string;
      relPath: string;
      docType?: string | null;
      status?: string | null;
      tagsJson: string;
      frontmatterJson: string;
      headingPaths?: string | null;
    }>;

    const queryTokens = extractQueryTokens(query);
    const candidates = rows
      .map((row) => {
        const metadata = buildDocumentMetadataView(row);
        if (!matchesFilters(metadata, options?.filters)) {
          return undefined;
        }

        const headings = (row.headingPaths || "")
          .split(" || ")
          .map((entry) => entry.trim())
          .filter(Boolean);
        const bestHeading = chooseBestHeading(queryTokens, headings);
        const fallbackGroup = buildRouteGroup(
          query,
          {
            docId: row.docId,
            title: row.title,
            absPath: row.absPath,
            relPath: row.relPath,
            bestSectionId: `${row.docId}#document`,
            bestHeading,
            bestSnippet: metadata.description || metadata.summary || row.title,
            rawScore: 0,
            metadata
          },
          "fallback"
        );

        return {
          ...fallbackGroup,
          reasons: buildFieldHitReasons(fallbackGroup.signals.matchedFields, fallbackGroup.signals.exactPhraseFields)
        } satisfies RouteDebugCandidate;
      })
      .filter((candidate): candidate is RouteDebugCandidate => Boolean(candidate))
      .sort(compareRouteCandidates);

    closeDatabaseQuietly(database);
    return {
      manifest: manifest as IndexManifest,
      candidates
    };
  } catch (error) {
    closeDatabaseQuietly(database);
    throwKnownDatabaseError(error, workspaceRoot);
  }
  return { manifest: manifest as IndexManifest, candidates: [] };
}

function analyzeRouteQuery(
  workspaceRoot: string,
  query: string,
  limit: number,
  options?: { autoRebuild?: boolean; filters?: SearchFilters }
): RouteDebugResult {
  const { manifest, results } = search(workspaceRoot, query, limit * 8, options);
  const groupedCandidates = new Map<string, RouteDebugCandidate>();

  for (const result of results) {
    const routeGroup = buildRouteGroup(
      query,
      {
        docId: result.docId,
        title: result.title,
        absPath: result.absPath,
        relPath: result.relPath,
        bestSectionId: result.sectionId,
        bestHeading: result.headingPath,
        bestSnippet: result.snippet,
        rawScore: result.rawScore,
        metadata: result.metadata
      },
      "fts"
    );
    const candidate: RouteDebugCandidate = {
      ...routeGroup,
      reasons: buildFieldHitReasons(routeGroup.signals.matchedFields, routeGroup.signals.exactPhraseFields)
    };
    const existing = groupedCandidates.get(candidate.docId);
    if (!existing || compareRouteCandidates(candidate, existing) < 0) {
      groupedCandidates.set(candidate.docId, candidate);
    }
  }

  if (groupedCandidates.size < limit + 3 || [...groupedCandidates.values()].filter(isStrongRouteCandidate).length === 0) {
    const fallback = listFallbackRouteCandidates(workspaceRoot, query, options);
    for (const candidate of fallback.candidates) {
      const existing = groupedCandidates.get(candidate.docId);
      if (!existing || compareRouteCandidates(candidate, existing) < 0) {
        groupedCandidates.set(candidate.docId, candidate);
      }
    }
  }

  const sortedCandidates = [...groupedCandidates.values()].sort(compareRouteCandidates);
  const groups = sortedCandidates.filter(isStrongRouteCandidate).slice(0, limit);
  const selectedIds = new Set(groups.map((candidate) => candidate.docId));
  const nearMisses = sortedCandidates
    .filter((candidate) => !selectedIds.has(candidate.docId) && isNearMissRouteCandidate(candidate))
    .slice(0, Math.max(3, Math.min(limit, 5)));

  return {
    manifest,
    query,
    tokens: extractQueryTokens(query),
    groups,
    nearMisses,
    candidates: sortedCandidates.slice(0, Math.max(limit + 5, 8))
  };
}

export function route(
  workspaceRoot: string,
  query: string,
  limit: number,
  options?: { autoRebuild?: boolean; filters?: SearchFilters }
): RouteResult {
  const analysis = analyzeRouteQuery(workspaceRoot, query, limit, options);
  return {
    manifest: analysis.manifest,
    groups: analysis.groups,
    nearMisses: analysis.nearMisses
  };
}

export function routeDebug(
  workspaceRoot: string,
  query: string,
  limit: number,
  options?: { autoRebuild?: boolean; filters?: SearchFilters }
): RouteDebugResult {
  return analyzeRouteQuery(workspaceRoot, query, limit, options);
}

export function coverage(
  workspaceRoot: string,
  query: string,
  limit: number,
  options?: { autoRebuild?: boolean; filters?: SearchFilters }
): CoverageResult {
  const analysis = analyzeRouteQuery(workspaceRoot, query, limit, options);
  const topStrong = analysis.groups[0];
  let state: CoverageResult["state"] = "missing";
  let warning: string | undefined;

  if (analysis.groups.length > 0 && topStrong && topStrong.score >= 0.65) {
    state = "strong";
  } else if (analysis.groups.length > 0 || analysis.nearMisses.length > 0) {
    state = "partial";
    warning =
      "Die Query ist teilweise abgedeckt. Prüfe die near misses und ergänze bei Bedarf `aliases`, `description`, `summary` oder präzisere Überschriften.";
  } else {
    warning =
      "Keine belastbare Dokumentabdeckung gefunden. Lege Routing-Signale wie `aliases`, `description`, `summary` oder klarere Headings an.";
  }

  return {
    manifest: analysis.manifest,
    query,
    state,
    primary: analysis.groups.slice(0, Math.min(limit, 3)),
    supporting: analysis.groups.slice(3, Math.max(3, limit)),
    nearMisses: analysis.nearMisses,
    warning
  };
}

export function resolveDocumentById(
  workspaceRoot: string,
  docId: string,
  options?: { autoRebuild?: boolean }
): { manifest: IndexManifest; absPath: string; relPath: string; title: string } {
  let database: Database.Database | undefined;
  let manifest: IndexManifest | undefined;
  let row:
    | {
        absPath: string;
        relPath: string;
        title: string;
      }
    | undefined;
  try {
    const opened = openVerifiedDatabase(workspaceRoot, options);
    database = opened.database;
    manifest = opened.manifest;
    row = database
      .prepare("SELECT abs_path as absPath, rel_path as relPath, title FROM documents WHERE doc_id = ? LIMIT 1")
      .get(docId) as { absPath: string; relPath: string; title: string } | undefined;
  } catch (error) {
    closeDatabaseQuietly(database);
    throwKnownDatabaseError(error, workspaceRoot);
  }
  closeDatabaseQuietly(database);

  if (!row) {
    throw new CliError("DOCUMENT_NOT_FOUND", `Document '${docId}' not found in index.`, EXIT_CODES.notFound);
  }

  return { manifest: manifest as IndexManifest, ...row };
}

export function getDocumentMetadataById(
  workspaceRoot: string,
  docId: string,
  options?: { autoRebuild?: boolean }
): { manifest: IndexManifest; metadata: DocumentMetadataView } {
  let database: Database.Database | undefined;
  let manifest: IndexManifest | undefined;
  let row:
    | {
        docId: string;
        title: string;
        absPath: string;
        relPath: string;
        docType?: string | null;
        status?: string | null;
        tagsJson: string;
        frontmatterJson: string;
      }
    | undefined;
  try {
    const opened = openVerifiedDatabase(workspaceRoot, options);
    database = opened.database;
    manifest = opened.manifest;
    row = database
      .prepare(
        `
          SELECT
            doc_id as docId,
            title,
            abs_path as absPath,
            rel_path as relPath,
            doc_type as docType,
            status,
            tags_json as tagsJson,
            frontmatter_json as frontmatterJson
          FROM documents
          WHERE doc_id = ?
          LIMIT 1
        `
      )
      .get(docId) as
      | {
          docId: string;
          title: string;
          absPath: string;
          relPath: string;
          docType?: string | null;
          status?: string | null;
          tagsJson: string;
          frontmatterJson: string;
        }
      | undefined;
  } catch (error) {
    closeDatabaseQuietly(database);
    throwKnownDatabaseError(error, workspaceRoot);
  }
  closeDatabaseQuietly(database);

  if (!row) {
    throw new CliError("DOCUMENT_NOT_FOUND", `Document '${docId}' not found in index.`, EXIT_CODES.notFound);
  }

  return {
    manifest: manifest as IndexManifest,
    metadata: buildDocumentMetadataView(row)
  };
}

export function getDocumentMetadataByPath(
  workspaceRoot: string,
  absPath: string,
  options?: { autoRebuild?: boolean }
): { manifest: IndexManifest; metadata: DocumentMetadataView } {
  let database: Database.Database | undefined;
  let manifest: IndexManifest | undefined;
  let row:
    | {
        docId: string;
        title: string;
        absPath: string;
        relPath: string;
        docType?: string | null;
        status?: string | null;
        tagsJson: string;
        frontmatterJson: string;
      }
    | undefined;
  try {
    const opened = openVerifiedDatabase(workspaceRoot, options);
    database = opened.database;
    manifest = opened.manifest;
    row = database
      .prepare(
        `
          SELECT
            doc_id as docId,
            title,
            abs_path as absPath,
            rel_path as relPath,
            doc_type as docType,
            status,
            tags_json as tagsJson,
            frontmatter_json as frontmatterJson
          FROM documents
          WHERE abs_path = ?
          LIMIT 1
        `
      )
      .get(absPath) as
      | {
          docId: string;
          title: string;
          absPath: string;
          relPath: string;
          docType?: string | null;
          status?: string | null;
          tagsJson: string;
          frontmatterJson: string;
        }
      | undefined;
  } catch (error) {
    closeDatabaseQuietly(database);
    throwKnownDatabaseError(error, workspaceRoot);
  }
  closeDatabaseQuietly(database);

  if (!row) {
    throw new CliError("DOCUMENT_NOT_FOUND", `Document for path '${absPath}' not found in index.`, EXIT_CODES.notFound);
  }

  return {
    manifest: manifest as IndexManifest,
    metadata: buildDocumentMetadataView(row)
  };
}

export function getDocumentHeadings(
  workspaceRoot: string,
  docId: string,
  options?: { autoRebuild?: boolean }
): { manifest: IndexManifest; headings: DocumentHeadingView[] } {
  let database: Database.Database | undefined;
  let manifest: IndexManifest | undefined;
  let headings: DocumentHeadingView[] = [];
  try {
    const opened = openVerifiedDatabase(workspaceRoot, options);
    database = opened.database;
    manifest = opened.manifest;
    headings = database
      .prepare(
        `
          SELECT
            heading,
            heading_path as headingPath,
            level,
            ordinal
          FROM sections
          WHERE doc_id = ?
          ORDER BY ordinal ASC
        `
      )
      .all(docId) as DocumentHeadingView[];
  } catch (error) {
    closeDatabaseQuietly(database);
    throwKnownDatabaseError(error, workspaceRoot);
  }
  closeDatabaseQuietly(database);

  return {
    manifest: manifest as IndexManifest,
    headings
  };
}
