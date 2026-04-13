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
  DocumentHeadingView,
  DocumentMetadataView,
  DocumentRecord,
  IndexManifest,
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
          doc_id, title, body_text, tags
        ) VALUES (?, ?, ?, ?)
      `
    )
    .run(document.docId, document.title, document.bodyText, document.tags.join(" "));
}

function insertSections(database: Database.Database, document: DocumentRecord, sections: SectionRecord[]): void {
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
        rowid, section_id, doc_id, title, heading, heading_path, content, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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

  return {
    docId: row.docId,
    title: row.title,
    absPath: row.absPath,
    relPath: row.relPath,
    docType: row.docType ?? undefined,
    status: row.status ?? undefined,
    tags,
    summary: normalizeStringValue(frontmatter.summary),
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

function buildFtsMatchQuery(query: string): string {
  const tokens = query.match(/[\p{L}\p{N}]+/gu)?.map((token) => token.trim()).filter(Boolean) ?? [];
  if (tokens.length === 0) {
    throw new CliError(
      "INVALID_QUERY",
      "The search query does not contain any searchable terms.",
      EXIT_CODES.validation,
      { hint: "Use letters or numbers in the query, for example: KI Telefonassistent Buchhaltung." }
    );
  }
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" ");
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
        snippet(sections_fts, 5, '<mark>', '</mark>', ' … ', 18) as snippet,
        bm25(sections_fts) as score
      FROM sections_fts
      JOIN sections s ON s.row_id = sections_fts.rowid
      JOIN documents d ON d.doc_id = s.doc_id
      WHERE sections_fts MATCH ?
      ORDER BY bm25(sections_fts)
      LIMIT ?
    `
  );

  let results: SearchResult[] = [];
  try {
    const sectionRows = sectionStatement.all(safeQuery, limit * 8) as Array<
      Omit<SearchResult, "metadata"> & { docType?: string | null; status?: string | null; tagsJson: string; frontmatterJson: string }
    >;
    results = sectionRows
      .map((row) => ({
        docId: row.docId,
        sectionId: row.sectionId,
        title: row.title,
        headingPath: row.headingPath,
        absPath: row.absPath,
        relPath: row.relPath,
        snippet: row.snippet,
        score: normalizeSearchScore(row.score),
        rawScore: row.score,
        metadata: buildDocumentMetadataView(row)
      }))
      .filter((row) => matchesFilters(row.metadata, options?.filters))
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
            snippet(documents_fts, 2, '<mark>', '</mark>', ' … ', 24) as snippet,
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
        const hydrated: SearchResult = {
          docId: row.docId,
          sectionId: row.sectionId,
          title: row.title,
          headingPath: row.headingPath,
          absPath: row.absPath,
          relPath: row.relPath,
          snippet: row.snippet,
          score: normalizeSearchScore(row.score),
          rawScore: row.score,
          metadata: buildDocumentMetadataView(row)
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

export function route(
  workspaceRoot: string,
  query: string,
  limit: number,
  options?: { autoRebuild?: boolean; filters?: SearchFilters }
): {
  manifest: IndexManifest;
  groups: Array<{
    docId: string;
    title: string;
    absPath: string;
    relPath: string;
    bestSectionId: string;
    bestHeading: string;
    bestSnippet: string;
    score: number;
    rawScore: number;
    metadata: DocumentMetadataView;
  }>;
} {
  const { manifest, results } = search(workspaceRoot, query, limit * 3, options);
  const groups = new Map<
    string,
    {
      docId: string;
      title: string;
      absPath: string;
      relPath: string;
      bestSectionId: string;
      bestHeading: string;
      bestSnippet: string;
      score: number;
      rawScore: number;
      metadata: DocumentMetadataView;
    }
  >();

  for (const result of results) {
    if (groups.has(result.docId)) {
      continue;
    }
    groups.set(result.docId, {
      docId: result.docId,
      title: result.title,
      absPath: result.absPath,
      relPath: result.relPath,
      bestSectionId: result.sectionId,
      bestHeading: result.headingPath,
      bestSnippet: result.snippet,
      score: result.score,
      rawScore: result.rawScore,
      metadata: result.metadata
    });
  }

  return {
    manifest,
    groups: [...groups.values()].slice(0, limit)
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
