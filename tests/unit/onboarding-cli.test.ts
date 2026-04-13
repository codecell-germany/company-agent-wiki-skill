import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { setupWorkspace } from "../../src/lib/workspace";

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, "dist/index.js");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const tempPaths: string[] = [];
const originalConfigHome = process.env.COMPANY_AGENT_WIKI_CONFIG_HOME;

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "company-agent-wiki-cli-test-"));
}

function writeAnswersFile(workspaceRoot: string): string {
  const answerFile = path.join(workspaceRoot, "answers.json");
  fs.writeFileSync(
    answerFile,
    JSON.stringify(
      {
        answeredBy: "AI Agent",
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
    encoding: "utf8",
    env: process.env
  }) as SpawnSyncReturns<string>;
}

function runCliAsync(args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: repoRoot,
      env: env || process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

beforeAll(() => {
  execFileSync(npmCommand, ["run", "build"], {
    cwd: repoRoot,
    stdio: "pipe"
  });
});

afterEach(() => {
  if (originalConfigHome === undefined) {
    delete process.env.COMPANY_AGENT_WIKI_CONFIG_HOME;
  } else {
    process.env.COMPANY_AGENT_WIKI_CONFIG_HOME = originalConfigHome;
  }

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

  it("installs shared-agent and Codex compatibility shims through the installer", () => {
    const tempRoot = createTempWorkspace();
    tempPaths.push(tempRoot);
    const agentsHome = path.join(tempRoot, "agents");
    const codexHome = path.join(tempRoot, "codex");

    const install = spawnSync(process.execPath, [path.join(repoRoot, "dist/installer.js"), "install", "--agents-home", agentsHome, "--codex-home", codexHome, "--force", "--json"], {
      cwd: repoRoot,
      encoding: "utf8"
    }) as SpawnSyncReturns<string>;

    expect(install.status).toBe(0);
    const payload = JSON.parse(install.stdout);
    expect(payload.data.installs).toHaveLength(2);
    expect(payload.data.installs[0].mode).toBe("full");
    expect(payload.data.installs[1].mode).toBe("shim-only");
    expect(fs.existsSync(path.join(agentsHome, "bin", "company-agent-wiki-cli"))).toBe(true);
    expect(fs.existsSync(path.join(codexHome, "bin", "company-agent-wiki-cli"))).toBe(true);
    expect(fs.existsSync(path.join(agentsHome, "skills", "company-agent-wiki-cli", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(codexHome, "skills", "company-agent-wiki-cli"))).toBe(false);
    expect(fs.existsSync(path.join(codexHome, "tools", "company-agent-wiki-cli"))).toBe(false);

    const about = spawnSync(path.join(agentsHome, "bin", "company-agent-wiki-cli"), ["about", "--json"], {
      cwd: repoRoot,
      encoding: "utf8"
    }) as SpawnSyncReturns<string>;
    expect(about.status).toBe(0);
    const aboutPayload = JSON.parse(about.stdout);
    expect(fs.realpathSync(aboutPayload.data.runtimeHome)).toBe(fs.realpathSync(agentsHome));
  });

  it("can resolve a globally registered workspace outside the workspace directory", () => {
    const tempRoot = createTempWorkspace();
    tempPaths.push(tempRoot);
    const workspaceRoot = path.join(tempRoot, "workspace");
    const registryHome = path.join(tempRoot, "global-registry");
    fs.mkdirSync(registryHome, { recursive: true });
    process.env.COMPANY_AGENT_WIKI_CONFIG_HOME = registryHome;

    setupWorkspace({ workspaceRoot, gitInit: false });

    const current = spawnSync(process.execPath, [cliPath, "workspace", "current", "--json"], {
      cwd: tempRoot,
      encoding: "utf8",
      env: process.env
    }) as SpawnSyncReturns<string>;

    expect(current.status).toBe(0);
    const currentPayload = JSON.parse(current.stdout);
    expect(fs.realpathSync(currentPayload.data.workspaceRoot)).toBe(fs.realpathSync(workspaceRoot));
    expect(currentPayload.data.source).toBe("global-default");

    const verify = spawnSync(process.execPath, [cliPath, "verify", "--json"], {
      cwd: tempRoot,
      encoding: "utf8",
      env: process.env
    }) as SpawnSyncReturns<string>;

    expect(verify.status).toBe(0);
    const verifyPayload = JSON.parse(verify.stdout);
    expect(verifyPayload.data.state).toBe("missing");
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
description: Klare Kurzbeschreibung für Agenten vor dem Volltext-Read.
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
    expect(readPayload.data.metadata.description).toContain("Kurzbeschreibung für Agenten");
    expect(readPayload.data.metadata.summary).toContain("Roadmap und Entscheidungen");
    expect(readPayload.data.headings.some((item: { headingPath: string }) => item.headingPath === "Projekt Alpha Roadmap > Ziele")).toBe(true);
  });

  it("serializes concurrent auto-rebuild writers while allowing both search commands to succeed", async () => {
    const tempRoot = createTempWorkspace();
    tempPaths.push(tempRoot);
    const workspaceRoot = path.join(tempRoot, "workspace");
    setupWorkspace({ workspaceRoot, gitInit: false });
    const documentPath = path.join(workspaceRoot, "knowledge/canonical", "parallel-suche.md");
    fs.writeFileSync(
      documentPath,
      `---
title: Parallele Suche
type: note
status: draft
---
# Parallele Suche

Erster Stand.
`
    );

    const firstBuild = runCli(["index", "rebuild", "--workspace", workspaceRoot, "--json"]);
    expect(firstBuild.status).toBe(0);

    fs.writeFileSync(
      documentPath,
      `---
title: Parallele Suche
type: note
status: draft
---
# Parallele Suche

Parallel lesbare Aktualisierung.
`
    );

    const firstSearchPromise = runCliAsync(
      ["search", "Aktualisierung", "--workspace", workspaceRoot, "--auto-rebuild", "--json"],
      {
        ...process.env,
        COMPANY_AGENT_WIKI_TEST_WRITE_LOCK_DELAY_MS: "500"
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const secondSearchPromise = runCliAsync([
      "search",
      "Aktualisierung",
      "--workspace",
      workspaceRoot,
      "--auto-rebuild",
      "--json"
    ]);

    const [firstSearch, secondSearch] = await Promise.all([firstSearchPromise, secondSearchPromise]);

    expect(firstSearch.code).toBe(0);
    expect(secondSearch.code).toBe(0);
    expect(JSON.parse(firstSearch.stdout).data.results.length).toBeGreaterThan(0);
    expect(JSON.parse(secondSearch.stdout).data.results.length).toBeGreaterThan(0);
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
