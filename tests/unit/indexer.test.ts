import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CliError } from "../../src/lib/errors";
import { rebuildIndex, search, verifyIndex } from "../../src/lib/indexer";
import { setupWorkspace } from "../../src/lib/workspace";

const tempPaths: string[] = [];

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "company-agent-wiki-indexer-test-"));
}

function writeKnowledgeFile(workspaceRoot: string, relPath: string, content: string): string {
  const targetPath = path.join(workspaceRoot, "knowledge/canonical", relPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
  return targetPath;
}

afterEach(() => {
  while (tempPaths.length > 0) {
    const target = tempPaths.pop();
    if (target && fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
});

describe("indexer UX contract", () => {
  it("reports a missing index on a fresh workspace instead of throwing", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    setupWorkspace({ workspaceRoot, gitInit: false });

    const verification = verifyIndex(workspaceRoot);

    expect(verification.state).toBe("missing");
    expect(verification.ok).toBe(false);
    expect(verification.hint).toContain("index rebuild");
  });

  it("normalizes natural hyphenated queries into safe FTS search", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    setupWorkspace({ workspaceRoot, gitInit: false });

    writeKnowledgeFile(
      workspaceRoot,
      "ki-telefonassistent.md",
      `---
title: KI-Telefonassistent
type: process
status: draft
tags:
  - telefon
---
# KI-Telefonassistent

Der KI-Telefonassistent beantwortet Anrufe und priorisiert die Buchhaltung.
`
    );

    rebuildIndex(workspaceRoot);
    const result = search(workspaceRoot, "KI-Telefonassistent", 5);

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]?.title).toContain("KI-Telefonassistent");
  });

  it("rejects punctuation-only queries with INVALID_QUERY", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    setupWorkspace({ workspaceRoot, gitInit: false });
    rebuildIndex(workspaceRoot);

    expect(() => search(workspaceRoot, "---", 5)).toThrowError(CliError);

    try {
      search(workspaceRoot, "---", 5);
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe("INVALID_QUERY");
    }
  });

  it("can auto-rebuild when the index became stale", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    setupWorkspace({ workspaceRoot, gitInit: false });

    const documentPath = writeKnowledgeFile(
      workspaceRoot,
      "stale-check.md",
      `---
title: Stale Check
type: note
status: draft
---
# Stale Check

Erster Stand.
`
    );

    const firstBuild = rebuildIndex(workspaceRoot);
    fs.writeFileSync(
      documentPath,
      `---
title: Stale Check
type: note
status: draft
---
# Stale Check

Zweiter Stand mit Auto Rebuild.
`
    );

    expect(() => search(workspaceRoot, "Auto Rebuild", 5)).toThrowError(CliError);

    const rebuilt = search(workspaceRoot, "Auto Rebuild", 5, { autoRebuild: true });
    expect(rebuilt.manifest.buildId).not.toBe(firstBuild.buildId);
    expect(rebuilt.results.length).toBeGreaterThan(0);
  });

  it("can narrow results with front-matter filters", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    setupWorkspace({ workspaceRoot, gitInit: false });

    writeKnowledgeFile(
      workspaceRoot,
      "projects/projekt-alpha-roadmap.md",
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
description: Klare Kurzbeschreibung des Projektstatus für Agenten.
summary: Roadmap und nächste Schritte für Projekt Alpha.
---
# Projekt Alpha Roadmap

Projekt Alpha priorisiert den KI-Telefonassistenten.
`
    );

    writeKnowledgeFile(
      workspaceRoot,
      "processes/buchhaltung-aws.md",
      `---
title: AWS Eingangsrechnung buchen
type: process
status: active
tags:
  - buchhaltung
  - aws
project: finance-ops
department: buchhaltung
owners:
  - accounting-team
systems:
  - sevdesk
description: Kurzbeschreibung des AWS-Buchungsprozesses für Agenten.
summary: Buchungsprozess für AWS-Rechnungen.
---
# AWS Eingangsrechnung buchen

Die Buchhaltung verarbeitet AWS-Rechnungen monatlich.
`
    );

    rebuildIndex(workspaceRoot);

    const result = search(workspaceRoot, "Projekt", 5, {
      filters: {
        docType: "project",
        project: ["alpha"],
        department: ["entwicklung"]
      }
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.metadata.project).toBe("alpha");
    expect(result.results[0]?.metadata.department).toBe("entwicklung");
    expect(result.results[0]?.metadata.description).toContain("Projektstatus");
    expect(result.results[0]?.metadata.summary).toContain("Projekt Alpha");
  });
});
