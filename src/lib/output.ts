import { CLI_SCHEMA_VERSION } from "./constants";
import { CliError, coerceCliError } from "./errors";
import type { CliEnvelope, CliErrorPayload } from "./types";

export function envelope<T>(
  command: string,
  data: T,
  warnings: string[] = [],
  buildId?: string
): CliEnvelope<T> {
  return {
    ok: true,
    command,
    version: CLI_SCHEMA_VERSION,
    buildId,
    warnings,
    data
  };
}

export function errorEnvelope(command: string, error: unknown): CliErrorPayload {
  const normalizedError = error instanceof CliError ? error : coerceCliError(error);

  if (normalizedError instanceof CliError) {
    return {
      ok: false,
      command,
      version: CLI_SCHEMA_VERSION,
      error: {
        code: normalizedError.code,
        message: normalizedError.message,
        hint: normalizedError.hint,
        details: normalizedError.details
      }
    };
  }

  return {
    ok: false,
    command,
    version: CLI_SCHEMA_VERSION,
    error: {
      code: "UNEXPECTED_ERROR",
      message: error instanceof Error ? error.message : String(error)
    }
  };
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
