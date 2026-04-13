import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  detectWorkspaceRoot,
  doctor,
  getGlobalRegistryPath,
  listRegisteredWorkspaces,
  resolveWorkspaceSelection,
  setupWorkspace
} from "../../src/lib/workspace";

const tempPaths: string[] = [];
const originalConfigHome = process.env.COMPANY_AGENT_WIKI_CONFIG_HOME;

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "company-agent-wiki-workspace-test-"));
}

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

describe("workspace scaffold UX", () => {
  it("creates starter documents by default", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    const registryHome = createTempWorkspace();
    tempPaths.push(registryHome);
    process.env.COMPANY_AGENT_WIKI_CONFIG_HOME = registryHome;

    const result = setupWorkspace({ workspaceRoot, gitInit: false });

    expect(fs.existsSync(path.join(workspaceRoot, "knowledge/canonical/wiki-start-here.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, "knowledge/canonical/company-profile.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, "knowledge/canonical/kernprozesse.md"))).toBe(true);
    expect(fs.existsSync(getGlobalRegistryPath())).toBe(true);
    expect(fs.realpathSync(listRegisteredWorkspaces().defaultWorkspace || "")).toBe(fs.realpathSync(workspaceRoot));
    expect(result.nextSteps[0]).toContain("doctor");
    expect(result.nextSteps[1]).toContain("index rebuild");
    expect(result.nextSteps[2]).toContain("verify");
  });

  it("can skip starter documents explicitly", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    const registryHome = createTempWorkspace();
    tempPaths.push(registryHome);
    process.env.COMPANY_AGENT_WIKI_CONFIG_HOME = registryHome;

    setupWorkspace({ workspaceRoot, gitInit: false, starterDocs: false });

    expect(fs.existsSync(path.join(workspaceRoot, "knowledge/canonical/wiki-start-here.md"))).toBe(false);
    expect(fs.existsSync(path.join(workspaceRoot, "knowledge/canonical/company-profile.md"))).toBe(false);
  });

  it("can detect the workspace root from nested folders and reports Codex runtime checks", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    const registryHome = createTempWorkspace();
    tempPaths.push(registryHome);
    process.env.COMPANY_AGENT_WIKI_CONFIG_HOME = registryHome;
    setupWorkspace({ workspaceRoot, gitInit: false });

    const nestedFolder = path.join(workspaceRoot, "knowledge/canonical/company");
    fs.mkdirSync(nestedFolder, { recursive: true });

    expect(detectWorkspaceRoot(nestedFolder)).toBe(workspaceRoot);

    const result = doctor(workspaceRoot);
    const checkNames = result.checks.map((check) => check.name);
    expect(checkNames).toContain("codex-cli-shim");
    expect(checkNames).toContain("codex-bin-in-path");
    expect(checkNames).toContain("global-workspace-registry");
    expect(checkNames).toContain("global-default-workspace");
  });

  it("can resolve a globally registered default workspace outside the workspace directory", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    const registryHome = createTempWorkspace();
    tempPaths.push(registryHome);
    process.env.COMPANY_AGENT_WIKI_CONFIG_HOME = registryHome;
    setupWorkspace({ workspaceRoot, gitInit: false });

    const outsideDir = createTempWorkspace();
    tempPaths.push(outsideDir);

    const selection = resolveWorkspaceSelection(outsideDir);
    expect(fs.realpathSync(selection.workspaceRoot || "")).toBe(fs.realpathSync(workspaceRoot));
    expect(selection.source).toBe("global-default");
  });
});
