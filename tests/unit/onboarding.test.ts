import { describe, expect, it } from "vitest";

import { COMPANY_ONBOARDING_DE_V1, renderOnboardingMarkdown } from "../../src/lib/onboarding";

describe("COMPANY_ONBOARDING_DE_V1", () => {
  it("contains the expected core sections", () => {
    expect(COMPANY_ONBOARDING_DE_V1.profileId).toBe("de-company-v1");
    expect(COMPANY_ONBOARDING_DE_V1.sections.length).toBeGreaterThanOrEqual(5);
    expect(COMPANY_ONBOARDING_DE_V1.sections.map((section) => section.id)).toContain("tax-finance");
  });

  it("renders markdown with section headlines", () => {
    const markdown = renderOnboardingMarkdown(COMPANY_ONBOARDING_DE_V1);
    expect(markdown).toContain("# Unternehmens-Onboarding");
    expect(markdown).toContain("## Rechtlicher Kern");
    expect(markdown).toContain("## Steuern und Finanzbasis");
  });
});

