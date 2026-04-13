import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CliError } from "../../src/lib/errors";
import { applyCompanyOnboarding, previewCompanyOnboarding } from "../../src/lib/onboarding";
import { addRoot, loadWorkspaceConfig, saveWorkspaceConfig, setupWorkspace } from "../../src/lib/workspace";

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "company-agent-wiki-test-"));
}

function writeAnswersFile(workspaceRoot: string): string {
  const answerFile = path.join(workspaceRoot, "answers.json");
  fs.writeFileSync(
    answerFile,
    JSON.stringify(
      {
        answeredBy: "AI Agent",
        notes: ["Buchhaltung zuerst priorisieren"],
        answers: {
          official_legal_name: "CodeCell Applications GmbH",
          legal_form: "GmbH",
          registered_seat: "Augsburg",
          company_purpose: "Softwareentwicklung und Automatisierung",
          managing_directors: [
            {
              name: "Nikolas Gottschol",
              role: "Geschäftsführer",
              email: "nikolas@example.com",
              notes: ["Operative Freigaben"]
            }
          ],
          approval_model: "Geschäftsführung final, Buchhaltung fachlich vorbereitend",
          tax_registration_status: "Ja",
          vat_regime: "Regelbesteuerung",
          employee_count: 4,
          employee_data_scope: true,
          departments_or_domains: ["Buchhaltung", "Geschäftsführung"],
          critical_systems: ["Sevdesk", "E-Mail"],
          initial_roots: ["/private/buchhaltung", "/private/management"],
          confidentiality_needs: "Personal und Steuern nur eingeschränkt sichtbar"
        }
      },
      null,
      2
    )
  );
  return answerFile;
}

function writeJson(workspaceRoot: string, fileName: string, value: unknown): string {
  const targetPath = path.join(workspaceRoot, fileName);
  fs.writeFileSync(targetPath, JSON.stringify(value, null, 2));
  return targetPath;
}

const tempPaths: string[] = [];

afterEach(() => {
  while (tempPaths.length > 0) {
    const target = tempPaths.pop();
    if (target && fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
});

describe("company onboarding materialization", () => {
  it("previews canonical onboarding documents for a workspace", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    setupWorkspace({ workspaceRoot, gitInit: false });
    const answerFile = writeAnswersFile(workspaceRoot);

    const preview = previewCompanyOnboarding(workspaceRoot, answerFile);
    const relPaths = preview.documents.map((document) => document.relPath);

    expect(relPaths).toContain("knowledge/canonical/company/company-profile.md");
    expect(relPaths).toContain("knowledge/canonical/company/tax-profile.md");
    expect(relPaths).toContain("knowledge/canonical/company/workforce-profile.md");
    expect(relPaths).toContain("knowledge/canonical/company/knowledge-scope.md");
    expect(relPaths).toContain("knowledge/canonical/people/nikolas-gottschol.md");

    const companyProfile = preview.documents.find((document) => document.docId === "company.profile");
    expect(companyProfile?.content).toContain("id: company.profile");
    expect(companyProfile?.content).toContain("type: profile");
    expect(companyProfile?.content).toContain("status: draft");
    expect(companyProfile?.content).toContain("answered_at:");
    expect(companyProfile?.content).toContain("  - onboarding");
    expect(companyProfile?.content).toContain("CodeCell Applications GmbH");
    expect(companyProfile?.content).toContain("Buchhaltung zuerst priorisieren");
    expect(companyProfile?.existed).toBe(false);
  });

  it("writes onboarding documents and blocks accidental overwrite without force", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    setupWorkspace({ workspaceRoot, gitInit: false });
    const answerFile = writeAnswersFile(workspaceRoot);

    const firstApply = applyCompanyOnboarding({
      workspaceRoot,
      answerFile,
      execute: true
    });

    expect(firstApply.mode).toBe("applied");
    expect(firstApply.documents.length).toBeGreaterThanOrEqual(5);

    const companyProfilePath = path.join(workspaceRoot, "knowledge/canonical/company/company-profile.md");
    expect(fs.existsSync(companyProfilePath)).toBe(true);
    expect(fs.readFileSync(companyProfilePath, "utf8")).toContain("# Unternehmensprofil");

    expect(() =>
      applyCompanyOnboarding({
        workspaceRoot,
        answerFile,
        execute: true
      })
    ).toThrowError(CliError);

    const forcedApply = applyCompanyOnboarding({
      workspaceRoot,
      answerFile,
      execute: true,
      force: true
    });

    expect(forcedApply.warnings.some((warning) => warning.includes("Overwriting existing file"))).toBe(true);
  });

  it("keeps answeredAt stable between preview and apply when the answer file omits it", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    setupWorkspace({ workspaceRoot, gitInit: false });
    const answerFile = writeAnswersFile(workspaceRoot);

    const preview = previewCompanyOnboarding(workspaceRoot, answerFile);
    const applyResult = applyCompanyOnboarding({
      workspaceRoot,
      answerFile,
      execute: false
    });

    expect(preview.normalized.answeredAt).toBe(applyResult.answeredAt);
  });

  it("supports flat top-level answer files", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    setupWorkspace({ workspaceRoot, gitInit: false });
    const answerFile = writeJson(workspaceRoot, "flat-answers.json", {
      answeredBy: "AI Agent",
      official_legal_name: "CodeCell Applications GmbH",
      legal_form: "GmbH",
      vat_regime: "Regelbesteuerung"
    });

    const preview = previewCompanyOnboarding(workspaceRoot, answerFile);

    expect(preview.documents.some((document) => document.docId === "company.profile")).toBe(true);
    expect(preview.documents.some((document) => document.docId === "company.tax-profile")).toBe(true);
  });

  it("rejects unsupported profile IDs and unknown answer keys", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    setupWorkspace({ workspaceRoot, gitInit: false });

    const wrongProfileFile = writeJson(workspaceRoot, "wrong-profile.json", {
      profileId: "de-company-v999",
      answers: {
        official_legal_name: "CodeCell Applications GmbH"
      }
    });

    expect(() => previewCompanyOnboarding(workspaceRoot, wrongProfileFile)).toThrowError(CliError);

    const unknownKeyFile = writeJson(workspaceRoot, "unknown-key.json", {
      answers: {
        official_legal_name: "CodeCell Applications GmbH",
        official_legal_name_typo: "Broken"
      }
    });

    expect(() => previewCompanyOnboarding(workspaceRoot, unknownKeyFile)).toThrowError(CliError);
  });

  it("rejects empty answer files and conflicting person slugs", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    setupWorkspace({ workspaceRoot, gitInit: false });

    const emptyFile = writeJson(workspaceRoot, "empty.json", {
      answeredBy: "AI Agent",
      answers: {}
    });

    expect(() => previewCompanyOnboarding(workspaceRoot, emptyFile)).toThrowError(CliError);

    const conflictingPeopleFile = writeJson(workspaceRoot, "conflicting-people.json", {
      answers: {
        managing_directors: ["Max Müller", "Max Muller"]
      }
    });

    expect(() => previewCompanyOnboarding(workspaceRoot, conflictingPeopleFile)).toThrowError(CliError);
  });

  it("rejects invalid person slugs derived from non-name input", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    setupWorkspace({ workspaceRoot, gitInit: false });

    const invalidPeopleFile = writeJson(workspaceRoot, "invalid-people.json", {
      answers: {
        managing_directors: ["!!!"]
      }
    });

    expect(() => previewCompanyOnboarding(workspaceRoot, invalidPeopleFile)).toThrowError(CliError);
  });

  it("rejects managed roots outside the private workspace", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    setupWorkspace({ workspaceRoot, gitInit: false });

    const externalRoot = createTempWorkspace();
    tempPaths.push(externalRoot);

    expect(() =>
      addRoot(workspaceRoot, {
        id: "outside-managed",
        rootPath: externalRoot,
        kind: "managed"
      })
    ).toThrowError(CliError);
  });

  it("refuses onboarding writes when the managed root in config points outside the workspace", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    setupWorkspace({ workspaceRoot, gitInit: false });
    const externalRoot = createTempWorkspace();
    tempPaths.push(externalRoot);
    const answerFile = writeAnswersFile(workspaceRoot);

    const config = loadWorkspaceConfig(workspaceRoot);
    config.roots[0].path = externalRoot;
    saveWorkspaceConfig(workspaceRoot, config);

    expect(() => previewCompanyOnboarding(workspaceRoot, answerFile)).toThrowError(CliError);
  });
});
