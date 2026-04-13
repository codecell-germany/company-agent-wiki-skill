import { describe, expect, it } from "vitest";

import { parseMarkdownDocument } from "../../src/lib/markdown";

describe("parseMarkdownDocument", () => {
  it("creates sections for intro text and headings", () => {
    const raw = `---
id: process.invoice.aws
title: AWS invoice handling
tags:
  - aws
  - finance
---

Short intro.

# Download

Open the portal.

## Validate

Check VAT and dates.
`;

    const parsed = parseMarkdownDocument(
      "/tmp/aws.md",
      "vendors/aws.md",
      "canonical",
      raw,
      1712900000000
    );

    expect(parsed.document.docId).toBe("process.invoice.aws");
    expect(parsed.document.title).toBe("AWS invoice handling");
    expect(parsed.document.tags).toEqual(["aws", "finance"]);
    expect(parsed.sections).toHaveLength(3);
    expect(parsed.sections[0].heading).toBe("Introduction");
    expect(parsed.sections[1].headingPath).toBe("Download");
    expect(parsed.sections[2].headingPath).toBe("Download > Validate");
  });
});

