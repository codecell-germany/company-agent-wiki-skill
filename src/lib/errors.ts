import { EXIT_CODES } from "./constants";

export class CliError extends Error {
  public readonly code: string;
  public readonly exitCode: number;
  public readonly hint?: string;
  public readonly details?: unknown;

  public constructor(
    code: string,
    message: string,
    exitCode: number,
    options?: { hint?: string; details?: unknown }
  ) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.hint = options?.hint;
    this.details = options?.details;
  }
}

export function isSqliteLockError(error: unknown): error is Error {
  return error instanceof Error && /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(error.message);
}

export function coerceCliError(
  error: unknown,
  options?: { sqliteLockHint?: string; sqliteLockDetails?: unknown }
): CliError | undefined {
  if (error instanceof CliError) {
    return error;
  }

  if (isSqliteLockError(error)) {
    return new CliError(
      "SQLITE_LOCKED",
      "The derived SQLite index is temporarily locked by another process.",
      EXIT_CODES.sqliteLocked,
      {
        hint:
          options?.sqliteLockHint ||
          "Retry in a moment and serialize search, route, read, history and diff against the same workspace when possible.",
        details: options?.sqliteLockDetails
      }
    );
  }

  return undefined;
}
