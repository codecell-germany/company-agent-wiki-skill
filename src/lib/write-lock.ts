import fs from "node:fs";
import path from "node:path";

import { EXIT_CODES, WORKSPACE_INTERNAL_DIR } from "./constants";
import { CliError } from "./errors";
import { ensureDir, fileExists, readJsonFile, writeJsonAtomic } from "./fs-utils";
import { newBuildId } from "./hash";

interface WorkspaceWriteLockPayload {
  token: string;
  pid: number;
  reason: string;
  workspaceRoot: string;
  acquiredAt: string;
}

const LOCK_FILE_NAME = "write.lock";
const LOCK_WAIT_TIMEOUT_MS = 60_000;
const LOCK_POLL_INTERVAL_MS = 125;
const LOCK_STALE_AFTER_MS = 10 * 60_000;

function sleepMs(durationMs: number): void {
  const shared = new SharedArrayBuffer(4);
  const array = new Int32Array(shared);
  Atomics.wait(array, 0, 0, durationMs);
}

function getLockPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), WORKSPACE_INTERNAL_DIR, LOCK_FILE_NAME);
}

function readLockPayload(lockPath: string): WorkspaceWriteLockPayload | undefined {
  if (!fileExists(lockPath)) {
    return undefined;
  }

  try {
    return readJsonFile<WorkspaceWriteLockPayload>(lockPath);
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== "ESRCH";
  }
}

function canBreakLock(payload: WorkspaceWriteLockPayload | undefined): boolean {
  if (!payload) {
    return true;
  }

  const acquiredAt = Date.parse(payload.acquiredAt);
  const ageMs = Number.isNaN(acquiredAt) ? Number.POSITIVE_INFINITY : Date.now() - acquiredAt;
  if (ageMs > LOCK_STALE_AFTER_MS) {
    return true;
  }

  return !isProcessAlive(payload.pid);
}

function writeLockPayload(lockPath: string, payload: WorkspaceWriteLockPayload): void {
  const tempPath = `${lockPath}.${payload.token}.tmp`;
  writeJsonAtomic(tempPath, payload);
  fs.renameSync(tempPath, lockPath);
}

function createLockPayload(workspaceRoot: string, reason: string): WorkspaceWriteLockPayload {
  return {
    token: newBuildId(),
    pid: process.pid,
    reason,
    workspaceRoot: path.resolve(workspaceRoot),
    acquiredAt: new Date().toISOString()
  };
}

export function withWorkspaceWriteLock<T>(
  workspaceRoot: string,
  reason: string,
  callback: () => T,
  options?: { timeoutMs?: number }
): T {
  const lockPath = getLockPath(workspaceRoot);
  const timeoutMs = options?.timeoutMs ?? LOCK_WAIT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const payload = createLockPayload(workspaceRoot, reason);

  ensureDir(path.dirname(lockPath));

  while (true) {
    try {
      const fileDescriptor = fs.openSync(lockPath, "wx");
      fs.closeSync(fileDescriptor);
      writeLockPayload(lockPath, payload);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }

      const existing = readLockPayload(lockPath);
      if (canBreakLock(existing)) {
        fs.rmSync(lockPath, { force: true });
        continue;
      }

      if (Date.now() >= deadline) {
        throw new CliError(
          "WORKSPACE_BUSY",
          "Another write operation is already running for this workspace.",
          EXIT_CODES.workspaceBusy,
          {
            hint: "Parallel reads should continue to work. For writes or auto-rebuilds, wait for the active write to finish and retry.",
            details: {
              lockPath,
              holder: existing
            }
          }
        );
      }

      sleepMs(LOCK_POLL_INTERVAL_MS);
    }
  }

  const artificialDelay = Number(process.env.COMPANY_AGENT_WIKI_TEST_WRITE_LOCK_DELAY_MS || "0");
  if (Number.isFinite(artificialDelay) && artificialDelay > 0) {
    sleepMs(artificialDelay);
  }

  try {
    return callback();
  } finally {
    const current = readLockPayload(lockPath);
    if (current && current.token === payload.token) {
      fs.rmSync(lockPath, { force: true });
    }
  }
}
