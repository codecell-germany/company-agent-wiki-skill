import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CliError } from "../../src/lib/errors";
import { coverage, rebuildIndex, route, routeDebug, search, verifyIndex } from "../../src/lib/indexer";
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

  it("supports alias-aware routing and exposes near misses", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    setupWorkspace({ workspaceRoot, gitInit: false });

    writeKnowledgeFile(
      workspaceRoot,
      "processes/google-cloud-rechnung.md",
      `---
id: process.google-cloud.rechnung
title: Google Cloud Rechnung buchen
type: process
status: active
tags:
  - google
  - cloud
  - buchen
description: Buchungslogik für Google Cloud Rechnungen.
summary: Beleggrundlage und Buchungslogik für Google Cloud.
aliases:
  - Google Cloud Statement
  - Beleggrundlage buchen
---
# Google Cloud Rechnung buchen

## Beleggrundlage

Google Cloud Statements dienen als Beleggrundlage.
`
    );

    writeKnowledgeFile(
      workspaceRoot,
      "processes/google-ads-rechnung.md",
      `---
id: process.google-ads.rechnung
title: Google Ads Rechnung prüfen
type: process
status: draft
tags:
  - google
  - ads
description: Prüfschritte für Google Ads Rechnungen.
summary: Relevante Prüfschritte für Google Ads.
aliases:
  - Google Rechnung
---
# Google Ads Rechnung prüfen
`
    );

    rebuildIndex(workspaceRoot);

    const routed = route(workspaceRoot, "Google Cloud Statement Beleggrundlage buchen", 5);
    expect(routed.groups.length).toBeGreaterThan(0);
    expect(routed.groups[0]?.docId).toBe("process.google-cloud.rechnung");
    expect(routed.groups[0]?.metadata.aliases).toContain("Google Cloud Statement");
    expect(routed.groups[0]?.signals.matchedFields).toContain("aliases");
    expect(routed.nearMisses.some((item) => item.docId === "process.google-ads.rechnung")).toBe(true);
  });

  it("explains routing decisions and reports partial coverage", () => {
    const workspaceRoot = createTempWorkspace();
    tempPaths.push(workspaceRoot);
    setupWorkspace({ workspaceRoot, gitInit: false });

    writeKnowledgeFile(
      workspaceRoot,
      "processes/cardif-versicherungen.md",
      `---
id: process.cardif.versicherung
title: Cardif Leasingratenversicherung buchen
type: process
status: active
tags:
  - cardif
  - versicherung
description: Wiederverwendung und Buchung der monatlichen Cardif-Versicherung.
summary: Monatliche Cardif-Versicherung mit Wiederverwendungslogik.
aliases:
  - Cardif monatlich
---
# Cardif Leasingratenversicherung buchen
`
    );

    rebuildIndex(workspaceRoot);

    const debug = routeDebug(workspaceRoot, "Cardif Leasingratenversicherung monatlich wiederverwenden buchen", 5);
    expect(debug.candidates.length).toBeGreaterThan(0);
    expect(debug.candidates[0]?.docId).toBe("process.cardif.versicherung");
    expect(debug.candidates[0]?.reasons.some((reason) => reason.includes("aliases") || reason.includes("title"))).toBe(true);

    const coverageResult = coverage(workspaceRoot, "Cardif Erstattung Sonderfall", 5);
    expect(["partial", "strong"]).toContain(coverageResult.state);
    expect(coverageResult.primary.length + coverageResult.nearMisses.length).toBeGreaterThan(0);
  });
});
