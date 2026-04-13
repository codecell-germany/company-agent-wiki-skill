import { Command } from "commander";

import { INSTALLER_NAME } from "./lib/constants";
import { installIntoCodexHome } from "./lib/install";
import { envelope, errorEnvelope, printJson } from "./lib/output";

const program = new Command();
program.name(INSTALLER_NAME).description("Install the Company Agent Wiki skill and CLI into Codex");

program
  .command("install")
  .option("--codex-home <path>", "Target Codex home directory")
  .option("--force", "Replace an existing install", false)
  .option("--json", "Emit JSON output", false)
  .action((options) => {
    const result = installIntoCodexHome({
      codexHome: options.codexHome,
      force: Boolean(options.force)
    });

    if (options.json) {
      printJson(envelope("install", result));
      return;
    }

    process.stdout.write(`Installed into ${result.codexHome}\n`);
    process.stdout.write(`CLI shim: ${result.shimPath}\n`);
    if (result.pathHint) {
      process.stdout.write(`warning: ${result.pathHint}\n`);
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
