import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { EXIT_CODES } from "./constants";
import { CliError } from "./errors";
import type { HistoryEntry } from "./types";

function runGit(args: string[], cwd: string, allowFailure = false): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    if (allowFailure) {
      return "";
    }
    throw new CliError("GIT_ERROR", `Git command failed: git ${args.join(" ")}`, EXIT_CODES.git, {
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

export function isGitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return true;
  } catch {
    return false;
  }
}

export function isGitRepository(targetPath: string): boolean {
  return runGit(["rev-parse", "--is-inside-work-tree"], targetPath, true) === "true";
}

export function initGitRepository(targetPath: string): void {
  if (fs.existsSync(path.join(targetPath, ".git"))) {
    return;
  }
  runGit(["init"], targetPath);
}

export function configureRemote(targetPath: string, remoteName: string, remoteUrl: string): void {
  const existing = runGit(["remote", "get-url", remoteName], targetPath, true);
  if (!existing) {
    runGit(["remote", "add", remoteName, remoteUrl], targetPath);
    return;
  }
  if (existing !== remoteUrl) {
    runGit(["remote", "set-url", remoteName, remoteUrl], targetPath);
  }
}

export function resolveGitRepository(targetPath: string): { repoRoot: string; relativePath: string } | null {
  if (!isGitAvailable()) {
    return null;
  }

  const directory = fs.statSync(targetPath).isDirectory() ? targetPath : path.dirname(targetPath);
  const repoRoot = runGit(["rev-parse", "--show-toplevel"], directory, true);
  if (!repoRoot) {
    return null;
  }

  return {
    repoRoot,
    relativePath: path.relative(repoRoot, targetPath)
  };
}

export function snapshotGitState(targetPath: string): { repoRoot: string; head?: string; dirty: boolean } | undefined {
  const resolved = resolveGitRepository(targetPath);
  if (!resolved) {
    return undefined;
  }

  const head = runGit(["rev-parse", "HEAD"], resolved.repoRoot, true) || undefined;
  const dirtyOutput = runGit(["status", "--porcelain", "--", resolved.relativePath], resolved.repoRoot, true);

  return {
    repoRoot: resolved.repoRoot,
    head,
    dirty: Boolean(dirtyOutput)
  };
}

export function getGitHistory(filePath: string, limit: number): HistoryEntry[] {
  const resolved = resolveGitRepository(filePath);
  if (!resolved) {
    throw new CliError(
      "GIT_NOT_AVAILABLE",
      `No Git repository found for ${filePath}`,
      EXIT_CODES.git,
      { hint: "Track the workspace or the registered root with Git before using history." }
    );
  }

  const output = runGit(
    [
      "log",
      `-n${limit}`,
      "--date=iso-strict",
      "--pretty=format:%H%x09%ad%x09%an%x09%s",
      "--",
      resolved.relativePath
    ],
    resolved.repoRoot
  );

  if (!output) {
    return [];
  }

  return output.split("\n").map((line) => {
    const [commit, committedAt, author, subject] = line.split("\t");
    return { commit, committedAt, author, subject };
  });
}

export function getGitDiff(filePath: string, baseRef: string, compareRef?: string): string {
  const resolved = resolveGitRepository(filePath);
  if (!resolved) {
    throw new CliError(
      "GIT_NOT_AVAILABLE",
      `No Git repository found for ${filePath}`,
      EXIT_CODES.git,
      { hint: "Track the workspace or the registered root with Git before using diff." }
    );
  }

  const args = compareRef
    ? ["diff", "--no-ext-diff", "--unified=3", baseRef, compareRef, "--", resolved.relativePath]
    : ["diff", "--no-ext-diff", "--unified=3", baseRef, "--", resolved.relativePath];

  return runGit(args, resolved.repoRoot, true);
}

