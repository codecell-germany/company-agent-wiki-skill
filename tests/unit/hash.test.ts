import { describe, expect, it } from "vitest";

import { sha256 } from "../../src/lib/hash";

describe("sha256", () => {
  it("is deterministic", () => {
    expect(sha256("company-agent-wiki")).toBe(sha256("company-agent-wiki"));
    expect(sha256("company-agent-wiki")).not.toBe(sha256("other"));
  });
});

