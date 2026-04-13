import { Command } from "commander";

import { INSTALLER_NAME } from "./lib/constants";
import { installIntoAgentHomes } from "./lib/install";
import { envelope, errorEnvelope, printJson } from "./lib/output";

const program = new Command();
program.name(INSTALLER_NAME).description("Install the Company Agent Wiki skill and CLI for shared agent homes and Codex compatibility");

program
  .command("install")
  .option("--agents-home <path>", "Target shared agents home directory")
  .option("--codex-home <path>", "Target Codex home directory")
  .option("--target <target>", "Install target: agents, codex or all", "all")
  .option("--force", "Replace an existing install", false)
  .option("--json", "Emit JSON output", false)
  .action((options) => {
    const result = installIntoAgentHomes({
      agentsHome: options.agentsHome,
      codexHome: options.codexHome,
      force: Boolean(options.force),
      target: options.target
    });

    if (options.json) {
      printJson(envelope("install", result));
      return;
    }

    for (const install of result.installs) {
      process.stdout.write(`Installed ${install.target} target (${install.mode}) into ${install.home}\n`);
      process.stdout.write(`CLI shim: ${install.shimPath}\n`);
      if (install.mode === "full") {
        if (install.skillDir) {
          process.stdout.write(`Skill payload: ${install.skillDir}\n`);
        }
        if (install.runtimeDir) {
          process.stdout.write(`Runtime: ${install.runtimeDir}\n`);
        }
      } else if (install.runtimeDir) {
        process.stdout.write(`Runtime source: ${install.runtimeDir}\n`);
      }
      if (install.pathHint) {
        process.stdout.write(`warning: ${install.pathHint}\n`);
      }
    }
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    printJson(errorEnvelope("installer", error));
    process.exit(1);
  }
}

void main();
