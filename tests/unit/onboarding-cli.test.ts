import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { setupWorkspace } from "../../src/lib/workspace";

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, "dist/index.js");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const tempPaths: string[] = [];

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "company-agent-wiki-cli-test-"));
}

function writeAnswersFile(workspaceRoot: string): string {
  const answerFile = path.join(workspaceRoot, "answers.json");
  fs.writeFileSync(
    answerFile,
    JSON.stringify(
      {
        answeredBy: "Codex Agent",
        answers: {
          official_legal_name: "CodeCell Applications GmbH",
          legal_form: "GmbH",
          managing_directors: ["Nikolas Gottschol"],
          vat_regime: "Regelbesteuerung"
        }
      },
      null,
      2
    )
  );
  return answerFile;
}

function runCli(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  }) as SpawnSyncReturns<string>;
}

beforeAll(() => {
  execFileSync(npmCommand, ["run", "build"], {
    cwd: repoRoot,
    stdio: "pipe"
  });
});

afterEach(() => {
  while (tempPaths.length > 0) {
    const target = tempPaths.pop();
    if (target && fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
});

describe("onboarding company CLI", () => {
  it("reports a fresh workspace as missing-index instead of failing verify", () => {
    const tempRoot = createTempWorkspace();
    tempPaths.push(tempRoot);
    const workspaceRoot = path.join(tempRoot, "workspace");
    setupWorkspace({ workspaceRoot, gitInit: false });

    const verify = runCli(["verify", "--workspace", workspaceRoot, "--json"]);
    expect(verify.status).toBe(0);
    const payload = JSON.parse(verify.stdout);
    expect(payload.data.state).toBe("missing");
  });

  it("can detect the workspace automatically from the current directory", () => {
    const tempRoot = createTempWorkspace();
    tempPaths.push(tempRoot);
    const workspaceRoot = path.join(tempRoot, "workspace");
    setupWorkspace({ workspaceRoot, gitInit: false });

    const verify = spawnSync(process.execPath, [cliPath, "verify", "--json"], {
      cwd: workspaceRoot,
      encoding: "utf8"
    }) as SpawnSyncReturns<string>;

    expect(verify.status).toBe(0);
    const payload = JSON.parse(verify.stdout);
    expect(payload.data.state).toBe("missing");

    const about = spawnSync(process.execPath, [cliPath, "about", "--json"], {
      cwd: workspaceRoot,
      encoding: "utf8"
    }) as SpawnSyncReturns<string>;
    expect(about.status).toBe(0);
    expect(fs.realpathSync(JSON.parse(about.stdout).data.cwdWorkspace)).toBe(fs.realpathSync(workspaceRoot));
  });

  it("renders the questionnaire in text and JSON mode", () => {
    const human = runCli(["onboarding", "company"]);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain("# Unternehmens-Onboarding");

    const machine = runCli(["onboarding", "company", "--json"]);
    expect(machine.status).toBe(0);
    const payload = JSON.parse(machine.stdout);
    expect(payload.data.profileId).toBe("de-company-v1");
    expect(payload.data.sections.length).toBeGreaterThanOrEqual(5);
  });

  it("previews, applies and immediately reads onboarding documents", () => {
    const tempRoot = createTempWorkspace();
    tempPaths.push(tempRoot);
    const workspaceRoot = path.join(tempRoot, "workspace");
    setupWorkspace({ workspaceRoot, gitInit: false });
    const answerFile = writeAnswersFile(tempRoot);

    const preview = runCli([
      "onboarding",
      "company",
      "--workspace",
      workspaceRoot,
      "--answers-file",
      answerFile,
      "--json"
    ]);
    expect(preview.status).toBe(0);
    const previewPayload = JSON.parse(preview.stdout);
    expect(previewPayload.command).toBe("onboarding company preview");
    expect(previewPayload.data.documents.length).toBeGreaterThanOrEqual(3);

    const apply = runCli([
      "onboarding",
      "company",
      "--workspace",
      workspaceRoot,
      "--answers-file",
      answerFile,
      "--execute",
      "--json"
    ]);
    expect(apply.status).toBe(0);
    const applyPayload = JSON.parse(apply.stdout);
    expect(applyPayload.data.mode).toBe("applied");
    expect(applyPayload.data.indexBuildId).toBeTruthy();

    const read = runCli([
      "read",
      "--workspace",
      workspaceRoot,
      "--doc-id",
      "company.profile",
      "--json"
    ]);
    expect(read.status).toBe(0);
    const readPayload = JSON.parse(read.stdout);
    expect(readPayload.data.rawMarkdown).toContain("CodeCell Applications GmbH");
  });

  it("handles hyphenated natural-language search queries", () => {
    const tempRoot = createTempWorkspace();
    tempPaths.push(tempRoot);
    const workspaceRoot = path.join(tempRoot, "workspace");
    setupWorkspace({ workspaceRoot, gitInit: false });
    fs.writeFileSync(
      path.join(workspaceRoot, "knowledge/canonical", "ki-telefonassistent.md"),
      `---
title: KI-Telefonassistent
type: process
status: draft
---
# KI-Telefonassistent

Der KI-Telefonassistent priorisiert Rückrufe und Buchhaltungsanfragen.
`
    );

    const rebuild = runCli(["index", "rebuild", "--workspace", workspaceRoot, "--json"]);
    expect(rebuild.status).toBe(0);

    const search = runCli(["search", "KI-Telefonassistent", "--workspace", workspaceRoot, "--json"]);
    expect(search.status).toBe(0);
    const payload = JSON.parse(search.stdout);
    expect(payload.data.results.length).toBeGreaterThan(0);
  });

  it("supports metadata-first reads with headings and metadata filters", () => {
    const tempRoot = createTempWorkspace();
    tempPaths.push(tempRoot);
    const workspaceRoot = path.join(tempRoot, "workspace");
    setupWorkspace({ workspaceRoot, gitInit: false });
    fs.writeFileSync(
      path.join(workspaceRoot, "knowledge/canonical", "projekt-alpha-roadmap.md"),
      `---
title: Projekt Alpha Roadmap
type: project
status: draft
tags:
  - projekt
  - alpha
project: alpha
department: entwicklung
owners:
  - nikolas-gottschol
systems:
  - linear
summary: Roadmap und Entscheidungen für Projekt Alpha.
---
# Projekt Alpha Roadmap

## Ziele

Projekt Alpha priorisiert den KI-Telefonassistenten.

## Risiken

Das Budget ist knapp.
`
    );

    const rebuild = runCli(["index", "rebuild", "--workspace", workspaceRoot, "--json"]);
    expect(rebuild.status).toBe(0);

    const filteredSearch = runCli([
      "route",
      "Projekt Alpha",
      "--workspace",
      workspaceRoot,
      "--type",
      "project",
      "--project",
      "alpha",
      "--department",
      "entwicklung",
      "--json"
    ]);
    expect(filteredSearch.status).toBe(0);
    const searchPayload = JSON.parse(filteredSearch.stdout);
    expect(searchPayload.data.groups).toHaveLength(1);
    expect(searchPayload.data.groups[0].metadata.project).toBe("alpha");

    const metadataRead = runCli([
      "read",
      "--workspace",
      workspaceRoot,
      "--doc-id",
      "canonical.projekt-alpha-roadmap",
      "--metadata",
      "--headings",
      "--json"
    ]);
    expect(metadataRead.status).toBe(0);
    const readPayload = JSON.parse(metadataRead.stdout);
    expect(readPayload.data.metadata.docType).toBe("project");
    expect(readPayload.data.metadata.department).toBe("entwicklung");
    expect(readPayload.data.headings.some((item: { headingPath: string }) => item.headingPath === "Projekt Alpha Roadmap > Ziele")).toBe(true);
  });

  it("enforces onboarding flag guards", () => {
    const forceWithoutExecute = runCli(["onboarding", "company", "--force"]);
    expect(forceWithoutExecute.status).toBe(1);
    expect(JSON.parse(forceWithoutExecute.stdout).error.code).toBe("FORCE_REQUIRES_EXECUTE");

    const executeWithoutAnswers = runCli(["onboarding", "company", "--execute"]);
    expect(executeWithoutAnswers.status).toBe(1);
    expect(JSON.parse(executeWithoutAnswers.stdout).error.code).toBe("ANSWERS_FILE_REQUIRED");
  });
});
