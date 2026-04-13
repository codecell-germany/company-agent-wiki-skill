import { describe, expect, it } from "vitest";

import { CliError, coerceCliError } from "../../src/lib/errors";

describe("error coercion", () => {
  it("maps SQLite lock errors to a dedicated CliError", () => {
    const normalized = coerceCliError(new Error("database is locked"));

    expect(normalized).toBeInstanceOf(CliError);
    expect(normalized?.code).toBe("SQLITE_LOCKED");
    expect(normalized?.hint).toContain("Retry");
  });
});
