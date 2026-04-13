import fs from "node:fs";
import path from "node:path";

import { Command } from "commander";

import { CLI_NAME, CLI_SCHEMA_VERSION, EXIT_CODES, PACKAGE_NAME } from "./lib/constants";
import { CliError, coerceCliError } from "./lib/errors";
import { getGitDiff, getGitHistory } from "./lib/git";
import { detectInstalledRuntimeHome } from "./lib/install";
import {
  getDocumentHeadings,
  getDocumentMetadataById,
  getDocumentMetadataByPath,
  rebuildIndex,
  resolveDocumentById,
  route,
  search,
  verifyIndex
} from "./lib/indexer";
import { applyCompanyOnboarding, COMPANY_ONBOARDING_DE_V1, previewCompanyOnboarding, renderOnboardingMarkdown } from "./lib/onboarding";
import { envelope, errorEnvelope, printJson } from "./lib/output";
import { startServer } from "./lib/server";
import {
  addRoot,
  detectWorkspaceRoot,
  getDefaultAgentsHome,
  doctor,
  getDefaultCodexHome,
  getGlobalRegistryPath,
  listRegisteredWorkspaces,
  listRoots,
  registerWorkspaceGlobally,
  rememberWorkspaceGlobally,
  resolveWorkspaceSelection,
  setupWorkspace
} from "./lib/workspace";
import type { DocumentHeadingView, DocumentMetadataView, SearchFilters } from "./lib/types";

function assertWorkspace(workspacePath: string | undefined): string {
  if (workspacePath?.trim()) {
    const resolved = path.resolve(workspacePath);
    rememberWorkspaceGlobally(resolved, { setDefault: true, source: "runtime" });
    return resolved;
  }

  const selection = resolveWorkspaceSelection(process.cwd());
  if (selection.workspaceRoot) {
    return selection.workspaceRoot;
  }

  throw new CliError("WORKSPACE_REQUIRED", "Missing --workspace option and no workspace was detected from the current directory.", EXIT_CODES.usage, {
    hint: `Pass --workspace /absolute/path, run the command from a directory inside the private workspace, or register one globally in ${getGlobalRegistryPath()}.`
  });
}

function printHumanChecks(checks: Array<{ name: string; ok: boolean; message: string }>): void {
  for (const check of checks) {
    const prefix = check.ok ? "[ok]" : "[fail]";
    process.stdout.write(`${prefix} ${check.name}: ${check.message}\n`);
  }
}

function collectValues(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function buildSearchFilters(options: {
  type?: string;
  status?: string;
  tag?: string[];
  project?: string[];
  department?: string[];
  owner?: string[];
  system?: string[];
}): SearchFilters | undefined {
  const filters: SearchFilters = {
    docType: options.type?.trim() || undefined,
    status: options.status?.trim() || undefined,
    tags: options.tag?.length ? options.tag : undefined,
    project: options.project?.length ? options.project : undefined,
    department: options.department?.length ? options.department : undefined,
    owners: options.owner?.length ? options.owner : undefined,
    systems: options.system?.length ? options.system : undefined
  };

  return Object.values(filters).some((value) => value !== undefined) ? filters : undefined;
}

function printMetadata(metadata: DocumentMetadataView): void {
  process.stdout.write(`${metadata.title}\n`);
  process.stdout.write(`  doc_id: ${metadata.docId}\n`);
  process.stdout.write(`  path: ${metadata.absPath}\n`);
  if (metadata.docType) {
    process.stdout.write(`  type: ${metadata.docType}\n`);
  }
  if (metadata.status) {
    process.stdout.write(`  status: ${metadata.status}\n`);
  }
  if (metadata.project) {
    process.stdout.write(`  project: ${metadata.project}\n`);
  }
  if (metadata.department) {
    process.stdout.write(`  department: ${metadata.department}\n`);
  }
  if (metadata.tags.length > 0) {
    process.stdout.write(`  tags: ${metadata.tags.join(", ")}\n`);
  }
  if (metadata.owners.length > 0) {
    process.stdout.write(`  owners: ${metadata.owners.join(", ")}\n`);
  }
  if (metadata.systems.length > 0) {
    process.stdout.write(`  systems: ${metadata.systems.join(", ")}\n`);
  }
  if (metadata.description) {
    process.stdout.write(`  description: ${metadata.description}\n`);
  }
  if (metadata.summary) {
    process.stdout.write(`  summary: ${metadata.summary}\n`);
  }
}

function printHeadings(headings: DocumentHeadingView[]): void {
  if (headings.length === 0) {
    process.stdout.write("  headings: none\n");
    return;
  }

  process.stdout.write("  headings:\n");
  for (const heading of headings) {
    process.stdout.write(`    - ${heading.headingPath}\n`);
  }
}

const program = new Command();
program.name(CLI_NAME).description("Agent-first local company knowledge CLI").version(CLI_SCHEMA_VERSION);

program
  .command("about")
  .description("Show CLI runtime metadata and common shared-agent paths")
  .option("--json", "Emit JSON output", false)
  .action((options) => {
    const agentsHome = getDefaultAgentsHome();
    const codexHome = getDefaultCodexHome();
    const runtimeHome = detectInstalledRuntimeHome(__dirname) || null;
      const data = {
        packageName: PACKAGE_NAME,
        cliName: CLI_NAME,
        schemaVersion: CLI_SCHEMA_VERSION,
        runtimeHome,
        runtimeShimPath: runtimeHome ? path.join(runtimeHome, "bin", CLI_NAME) : null,
        agentsHome,
        agentsShimPath: path.join(agentsHome, "bin", CLI_NAME),
        codexHome,
        codexShimPath: path.join(codexHome, "bin", CLI_NAME),
        cwdWorkspace: detectWorkspaceRoot(process.cwd()) || null,
        globalRegistryPath: getGlobalRegistryPath(),
        resolvedWorkspace: resolveWorkspaceSelection(process.cwd())
      };

    if (options.json) {
      printJson(envelope("about", data));
      return;
    }

    process.stdout.write(`${CLI_NAME}\n`);
    process.stdout.write(`  schema version: ${CLI_SCHEMA_VERSION}\n`);
    if (data.runtimeShimPath) {
      process.stdout.write(`  runtime shim: ${data.runtimeShimPath}\n`);
    }
    process.stdout.write(`  shared agent shim: ${data.agentsShimPath}\n`);
    process.stdout.write(`  codex shim: ${data.codexShimPath}\n`);
    if (data.cwdWorkspace) {
      process.stdout.write(`  detected workspace: ${data.cwdWorkspace}\n`);
    }
    if (data.resolvedWorkspace.workspaceRoot && data.resolvedWorkspace.source !== "cwd") {
      process.stdout.write(`  resolved workspace: ${data.resolvedWorkspace.workspaceRoot} (${data.resolvedWorkspace.source})\n`);
    }
    process.stdout.write(`  global registry: ${data.globalRegistryPath}\n`);
  });

const workspace = new Command("workspace").description("Manage global workspace discovery");

workspace
  .command("current")
  .description("Show the currently resolved workspace and discovery source")
  .option("--json", "Emit JSON output", false)
  .action((options) => {
    const selection = resolveWorkspaceSelection(process.cwd());
    const data = {
      workspaceRoot: selection.workspaceRoot || null,
      source: selection.source || null,
      registryPath: selection.registryPath,
      defaultWorkspace: selection.defaultWorkspace || null
    };

    if (options.json) {
      printJson(envelope("workspace current", data));
      return;
    }

    if (data.workspaceRoot) {
      process.stdout.write(`Resolved workspace: ${data.workspaceRoot}\n`);
      process.stdout.write(`Source: ${data.source}\n`);
    } else {
      process.stdout.write("No workspace resolved.\n");
    }
    process.stdout.write(`Global registry: ${data.registryPath}\n`);
    if (data.defaultWorkspace) {
      process.stdout.write(`Default workspace: ${data.defaultWorkspace}\n`);
    }
  });

workspace
  .command("list")
  .description("List globally registered workspaces")
  .option("--json", "Emit JSON output", false)
  .action((options) => {
    const result = listRegisteredWorkspaces();
    if (options.json) {
      printJson(envelope("workspace list", result));
      return;
    }

    process.stdout.write(`Global registry: ${result.registryPath}\n`);
    if (result.workspaces.length === 0) {
      process.stdout.write("No registered workspaces.\n");
      return;
    }

    for (const item of result.workspaces) {
      const defaultMarker = result.defaultWorkspace === item.path ? " [default]" : "";
      const existsMarker = item.exists ? "" : " [missing]";
      process.stdout.write(`- ${item.label}${defaultMarker}${existsMarker}\n`);
      process.stdout.write(`  ${item.path}\n`);
    }
  });

workspace
  .command("register")
  .description("Register an existing workspace globally for other agents")
  .requiredOption("--workspace <path>", "Absolute or relative workspace path")
  .option("--default", "Also mark this workspace as the global default", false)
  .option("--json", "Emit JSON output", false)
  .action((options) => {
    const entry = registerWorkspaceGlobally(path.resolve(options.workspace), {
      setDefault: Boolean(options.default),
      source: "manual"
    });
    const result = {
      registryPath: getGlobalRegistryPath(),
      entry
    };

    if (options.json) {
      printJson(envelope("workspace register", result));
      return;
    }

    process.stdout.write(`Registered workspace: ${entry.path}\n`);
    if (options.default) {
      process.stdout.write("This workspace is now the global default.\n");
    }
  });

workspace
  .command("use")
  .description("Set a registered workspace as the global default")
  .requiredOption("--workspace <path>", "Absolute or relative workspace path")
  .option("--json", "Emit JSON output", false)
  .action((options) => {
    const entry = registerWorkspaceGlobally(path.resolve(options.workspace), {
      setDefault: true,
      source: "manual"
    });
    const result = {
      registryPath: getGlobalRegistryPath(),
      defaultWorkspace: entry.path
    };

    if (options.json) {
      printJson(envelope("workspace use", result));
      return;
    }

    process.stdout.write(`Global default workspace: ${entry.path}\n`);
  });

program.addCommand(workspace);

program
  .command("setup")
  .description("Workspace setup commands")
  .addCommand(
    new Command("workspace")
      .requiredOption("--workspace <path>", "Absolute or relative workspace path")
      .option("--git-init", "Initialize a local Git repository", false)
      .option("--git-remote <url>", "Configure a Git remote URL")
      .option("--no-starter-docs", "Skip creation of starter Markdown documents")
      .option("--force", "Rewrite an existing scaffold", false)
      .option("--json", "Emit JSON output", false)
      .action((options) => {
        const workspaceRoot = path.resolve(options.workspace);
        const result = setupWorkspace({
          workspaceRoot,
          gitInit: Boolean(options.gitInit),
          gitRemote: options.gitRemote,
          starterDocs: options.starterDocs,
          force: Boolean(options.force)
        });

        if (options.json) {
          printJson(envelope("setup workspace", result, result.warnings));
          return;
        }

        process.stdout.write(`Workspace ready at ${result.workspaceRoot}\n`);
        for (const created of result.created) {
          process.stdout.write(`- ${created}\n`);
        }
        for (const warning of result.warnings) {
          process.stdout.write(`warning: ${warning}\n`);
        }
        if ("nextSteps" in result && Array.isArray(result.nextSteps)) {
          process.stdout.write("Next steps:\n");
          for (const step of result.nextSteps) {
            process.stdout.write(`- ${step}\n`);
          }
        }
      })
  );

program
  .command("doctor")
  .option("--workspace <path>", "Workspace path. Optional when current directory is already inside a workspace.")
  .option("--json", "Emit JSON output", false)
  .action((options) => {
    const result = doctor(assertWorkspace(options.workspace));
    if (options.json) {
      printJson(envelope("doctor", result));
      return;
    }
    printHumanChecks(result.checks);
  });

program
  .command("verify")
  .option("--workspace <path>", "Workspace path. Optional when current directory is already inside a workspace.")
  .option("--json", "Emit JSON output", false)
  .action((options) => {
    const result = verifyIndex(assertWorkspace(options.workspace));
    if (options.json) {
      printJson(envelope("verify", result, [], result.manifest?.buildId));
      return;
    }
    if (result.state === "missing") {
      process.stdout.write("Index fehlt noch.\n");
      if (result.hint) {
        process.stdout.write(`Hinweis: ${result.hint}\n`);
      }
      return;
    }
    process.stdout.write(result.ok ? "Index ist frisch.\n" : "Index ist veraltet.\n");
    for (const root of result.roots) {
      process.stdout.write(`${root.ok ? "[ok]" : "[stale]"} ${root.id}${root.reason ? `: ${root.reason}` : ""}\n`);
    }
  });

const roots = new Command("roots").description("Manage registered Markdown roots");

roots
  .command("add")
  .option("--workspace <path>", "Workspace path. Optional when current directory is already inside a workspace.")
  .requiredOption("--id <id>", "Root identifier")
  .requiredOption("--path <path>", "Root path")
  .option("--kind <kind>", "managed or external", "external")
  .option("--json", "Emit JSON output", false)
  .action((options) => {
    const root = addRoot(assertWorkspace(options.workspace), {
      id: options.id,
      rootPath: options.path,
      kind: options.kind === "managed" ? "managed" : "external"
    });

    if (options.json) {
      printJson(envelope("roots add", root));
      return;
    }
    process.stdout.write(`Added root ${root.id} -> ${root.path}\n`);
  });

roots
  .command("list")
  .option("--workspace <path>", "Workspace path. Optional when current directory is already inside a workspace.")
  .option("--json", "Emit JSON output", false)
  .action((options) => {
    const result = listRoots(assertWorkspace(options.workspace));
    if (options.json) {
      printJson(envelope("roots list", { roots: result }));
      return;
    }
    for (const root of result) {
      process.stdout.write(`- ${root.id} (${root.kind}) -> ${root.absPath}\n`);
    }
  });

program.addCommand(roots);

const index = new Command("index").description("Index management");

index
  .command("rebuild")
  .option("--workspace <path>", "Workspace path. Optional when current directory is already inside a workspace.")
  .option("--json", "Emit JSON output", false)
  .action((options) => {
    const manifest = rebuildIndex(assertWorkspace(options.workspace));
    if (options.json) {
      printJson(envelope("index rebuild", manifest, [], manifest.buildId));
      return;
    }
    process.stdout.write(`Indexed ${manifest.documentCount} documents and ${manifest.sectionCount} sections.\n`);
    process.stdout.write(`Build: ${manifest.buildId}\n`);
  });

program.addCommand(index);

const onboarding = new Command("onboarding").description("Agent-guided onboarding blueprints");

onboarding
  .command("company")
  .description("Show or materialize the default German company onboarding questionnaire")
  .option("--workspace <path>", "Workspace path for preview/apply mode")
  .option("--answers-file <path>", "JSON file with onboarding answers")
  .option("--execute", "Write generated Markdown files into the managed root", false)
  .option("--force", "Overwrite onboarding target files when executing", false)
  .option("--json", "Emit JSON output", false)
  .action((options) => {
    if (options.force && !options.execute) {
      throw new CliError("FORCE_REQUIRES_EXECUTE", "Use --force only together with --execute.", EXIT_CODES.usage);
    }

    if (options.execute && !options.answersFile) {
      throw new CliError(
        "ANSWERS_FILE_REQUIRED",
        "Pass --answers-file before using --execute.",
        EXIT_CODES.usage,
        { hint: "First prepare a JSON answer file and then call onboarding company with --workspace and --answers-file." }
      );
    }

    if (options.answersFile) {
      const workspaceRoot = assertWorkspace(options.workspace);

      if (options.execute) {
        const result = applyCompanyOnboarding({
          workspaceRoot,
          answerFile: options.answersFile,
          execute: true,
          force: Boolean(options.force)
        });

        if (options.json) {
          printJson(envelope("onboarding company apply", result, result.warnings));
          return;
        }

        process.stdout.write(`Onboarding angewendet. ${result.documents.length} Draft-Dokumente geschrieben.\n`);
        for (const document of result.documents) {
          process.stdout.write(`- ${document.relPath}${document.existed ? " (überschrieben)" : ""}\n`);
        }
        if (result.indexBuildId) {
          process.stdout.write(`Index neu aufgebaut: ${result.indexBuildId}\n`);
        }
        for (const warning of result.warnings) {
          process.stdout.write(`warning: ${warning}\n`);
        }
        return;
      }

      const preview = previewCompanyOnboarding(workspaceRoot, options.answersFile);
      if (options.json) {
        printJson(
          envelope(
            "onboarding company preview",
            {
              profileId: preview.normalized.profileId,
              answeredAt: preview.normalized.answeredAt,
              answeredBy: preview.normalized.answeredBy,
              documents: preview.documents
            },
            preview.warnings
          )
        );
        return;
      }

      process.stdout.write(`Preview. ${preview.documents.length} Draft-Dokumente würden erzeugt.\n`);
      for (const document of preview.documents) {
        process.stdout.write(`- ${document.relPath}${document.existed ? " (existiert bereits)" : ""}\n`);
      }
      for (const warning of preview.warnings) {
        process.stdout.write(`warning: ${warning}\n`);
      }
      process.stdout.write("Nächster Schritt: denselben Befehl mit --execute ausführen. --force ist nur zusammen mit --execute erlaubt.\n");
      return;
    }

    if (options.json) {
      printJson(envelope("onboarding company", COMPANY_ONBOARDING_DE_V1));
      return;
    }

    process.stdout.write(renderOnboardingMarkdown(COMPANY_ONBOARDING_DE_V1));
  });

program.addCommand(onboarding);

program
  .command("search")
  .argument("<query>", "Search query")
  .option("--workspace <path>", "Workspace path. Optional when current directory is already inside a workspace.")
  .option("--limit <number>", "Maximum number of results", "10")
  .option("--type <value>", "Filter by front matter type")
  .option("--status <value>", "Filter by front matter status")
  .option("--tag <value>", "Repeatable tag filter", collectValues, [])
  .option("--project <value>", "Repeatable project filter", collectValues, [])
  .option("--department <value>", "Repeatable department filter", collectValues, [])
  .option("--owner <value>", "Repeatable owner filter", collectValues, [])
  .option("--system <value>", "Repeatable system filter", collectValues, [])
  .option("--auto-rebuild", "Rebuild the derived index automatically when missing or stale", false)
  .option("--json", "Emit JSON output", false)
  .action((query, options) => {
    const result = search(assertWorkspace(options.workspace), query, Number(options.limit), {
      autoRebuild: Boolean(options.autoRebuild),
      filters: buildSearchFilters(options)
    });
    if (options.json) {
      printJson(envelope("search", result, [], result.manifest.buildId));
      return;
    }
    if (result.results.length === 0) {
      process.stdout.write("Keine Treffer.\n");
      return;
    }
    for (const item of result.results) {
      process.stdout.write(`${item.title}\n`);
      process.stdout.write(`  ${item.headingPath}\n`);
      process.stdout.write(`  ${item.absPath}\n`);
      if (item.metadata.docType || item.metadata.project || item.metadata.department || item.metadata.tags.length > 0) {
        const metadataBits = [
          item.metadata.docType ? `type=${item.metadata.docType}` : null,
          item.metadata.project ? `project=${item.metadata.project}` : null,
          item.metadata.department ? `department=${item.metadata.department}` : null,
          item.metadata.tags.length > 0 ? `tags=${item.metadata.tags.join(",")}` : null
        ].filter(Boolean);
        process.stdout.write(`  ${metadataBits.join(" | ")}\n`);
      }
      process.stdout.write(`  ${item.snippet}\n\n`);
    }
  });

program
  .command("route")
  .argument("<query>", "Routing query")
  .option("--workspace <path>", "Workspace path. Optional when current directory is already inside a workspace.")
  .option("--limit <number>", "Maximum number of grouped results", "8")
  .option("--type <value>", "Filter by front matter type")
  .option("--status <value>", "Filter by front matter status")
  .option("--tag <value>", "Repeatable tag filter", collectValues, [])
  .option("--project <value>", "Repeatable project filter", collectValues, [])
  .option("--department <value>", "Repeatable department filter", collectValues, [])
  .option("--owner <value>", "Repeatable owner filter", collectValues, [])
  .option("--system <value>", "Repeatable system filter", collectValues, [])
  .option("--auto-rebuild", "Rebuild the derived index automatically when missing or stale", false)
  .option("--json", "Emit JSON output", false)
  .action((query, options) => {
    const result = route(assertWorkspace(options.workspace), query, Number(options.limit), {
      autoRebuild: Boolean(options.autoRebuild),
      filters: buildSearchFilters(options)
    });
    if (options.json) {
      printJson(envelope("route", result, [], result.manifest.buildId));
      return;
    }
    if (result.groups.length === 0) {
      process.stdout.write("Keine Treffer.\n");
      return;
    }
    for (const item of result.groups) {
      process.stdout.write(`${item.title}\n`);
      process.stdout.write(`  ${item.bestHeading}\n`);
      process.stdout.write(`  ${item.absPath}\n`);
      if (item.metadata.docType || item.metadata.project || item.metadata.department || item.metadata.tags.length > 0) {
        const metadataBits = [
          item.metadata.docType ? `type=${item.metadata.docType}` : null,
          item.metadata.project ? `project=${item.metadata.project}` : null,
          item.metadata.department ? `department=${item.metadata.department}` : null,
          item.metadata.tags.length > 0 ? `tags=${item.metadata.tags.join(",")}` : null
        ].filter(Boolean);
        process.stdout.write(`  ${metadataBits.join(" | ")}\n`);
      }
      process.stdout.write(`  ${item.bestSnippet}\n\n`);
    }
  });

program
  .command("read")
  .option("--workspace <path>", "Workspace path. Optional when current directory is already inside a workspace.")
  .option("--doc-id <id>", "Indexed document identifier")
  .option("--path <path>", "Absolute or workspace-relative document path")
  .option("--metadata", "Only return indexed metadata and front matter", false)
  .option("--headings", "Return the indexed heading tree", false)
  .option("--auto-rebuild", "Rebuild the derived index automatically when missing or stale", false)
  .option("--json", "Emit JSON output", false)
  .action((options) => {
    const workspaceRoot = assertWorkspace(options.workspace);

    if (!options.docId && !options.path) {
      throw new CliError("READ_TARGET_REQUIRED", "Pass either --doc-id or --path.", EXIT_CODES.usage);
    }

    const metadataResult = options.docId
      ? getDocumentMetadataById(workspaceRoot, options.docId, {
          autoRebuild: Boolean(options.autoRebuild)
        })
      : (() => {
          const candidatePath = path.isAbsolute(options.path) ? options.path : path.join(workspaceRoot, options.path);
          return getDocumentMetadataByPath(workspaceRoot, path.resolve(candidatePath), {
            autoRebuild: Boolean(options.autoRebuild)
          });
        })();
    const headingsResult = options.headings
      ? getDocumentHeadings(workspaceRoot, metadataResult.metadata.docId, {
          autoRebuild: Boolean(options.autoRebuild)
        })
      : undefined;

    if (options.metadata || options.headings) {
      if (options.json) {
        printJson(
          envelope(
            "read",
            {
              metadata: metadataResult.metadata,
              headings: headingsResult?.headings ?? []
            },
            [],
            metadataResult.manifest.buildId
          )
        );
        return;
      }

      printMetadata(metadataResult.metadata);
      if (options.headings) {
        printHeadings(headingsResult?.headings ?? []);
      }
      return;
    }

    const rawMarkdown = fs.readFileSync(metadataResult.metadata.absPath, "utf8");
    if (options.json) {
      printJson(
        envelope(
          "read",
          {
            metadata: metadataResult.metadata,
            rawMarkdown
          },
          [],
          metadataResult.manifest.buildId
        )
      );
      return;
    }

    process.stdout.write(rawMarkdown);
    if (!rawMarkdown.endsWith("\n")) {
      process.stdout.write("\n");
    }
  });

program
  .command("history")
  .option("--workspace <path>", "Workspace path. Optional when current directory is already inside a workspace.")
  .option("--doc-id <id>", "Indexed document identifier")
  .option("--path <path>", "Absolute or workspace-relative document path")
  .option("--limit <number>", "Maximum number of commits", "20")
  .option("--json", "Emit JSON output", false)
  .action((options) => {
    const workspaceRoot = assertWorkspace(options.workspace);
    const resolvedPath = options.docId
      ? resolveDocumentById(workspaceRoot, options.docId).absPath
      : path.resolve(path.isAbsolute(options.path) ? options.path : path.join(workspaceRoot, options.path));
    const history = getGitHistory(resolvedPath, Number(options.limit));

    if (options.json) {
      printJson(envelope("history", { path: resolvedPath, history }));
      return;
    }

    for (const entry of history) {
      process.stdout.write(`${entry.commit} ${entry.committedAt} ${entry.author} ${entry.subject}\n`);
    }
  });

program
  .command("diff")
  .option("--workspace <path>", "Workspace path. Optional when current directory is already inside a workspace.")
  .option("--doc-id <id>", "Indexed document identifier")
  .option("--path <path>", "Absolute or workspace-relative document path")
  .option("--base <ref>", "Base Git ref", "HEAD")
  .option("--compare <ref>", "Optional compare ref")
  .option("--json", "Emit JSON output", false)
  .action((options) => {
    const workspaceRoot = assertWorkspace(options.workspace);
    const resolvedPath = options.docId
      ? resolveDocumentById(workspaceRoot, options.docId).absPath
      : path.resolve(path.isAbsolute(options.path) ? options.path : path.join(workspaceRoot, options.path));
    const diff = getGitDiff(resolvedPath, options.base, options.compare);

    if (options.json) {
      printJson(envelope("diff", { path: resolvedPath, diff }));
      return;
    }

    process.stdout.write(diff || "No diff.\n");
  });

program
  .command("serve")
  .option("--workspace <path>", "Workspace path. Optional when current directory is already inside a workspace.")
  .option("--port <number>", "HTTP port", "4187")
  .option("--auto-rebuild", "Rebuild the derived index automatically when missing or stale", false)
  .action((options) => {
    const workspaceRoot = assertWorkspace(options.workspace);
    const port = Number(options.port);
    const verification = verifyIndex(workspaceRoot);
    startServer(workspaceRoot, port, { autoRebuild: Boolean(options.autoRebuild) });
    process.stdout.write(`Workspace: ${workspaceRoot}\n`);
    process.stdout.write(`Index state: ${verification.state}\n`);
    if (Boolean(options.autoRebuild) && verification.state !== "ok") {
      process.stdout.write("Auto-rebuild is enabled. The first read or search request will refresh the derived index.\n");
    }
    process.stdout.write(`Read-only web view available at http://127.0.0.1:${port}\n`);
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const normalizedError = error instanceof CliError ? error : coerceCliError(error) || error;
    const payload = errorEnvelope(program.name(), normalizedError);
    printJson(payload);
    if (normalizedError instanceof CliError) {
      process.exit(normalizedError.exitCode);
    }
    process.exit(EXIT_CODES.runtime);
  }
}

void main();
