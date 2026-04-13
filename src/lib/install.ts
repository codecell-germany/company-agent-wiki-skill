import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CLI_NAME, INSTALLER_NAME, PACKAGE_NAME, SKILL_NAME } from "./constants";
import { ensureDir } from "./fs-utils";

function resolvePackageRoot(fromDir: string): string {
  let current = fromDir;
  while (true) {
    const candidate = path.join(current, "package.json");
    if (fs.existsSync(candidate)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Unable to resolve package root for installer.");
    }
    current = parent;
  }
}

function copyDependencyTree(packageRoot: string, runtimeNodeModules: string, dependencyName: string, visited: Set<string>): void {
  if (visited.has(dependencyName)) {
    return;
  }
  visited.add(dependencyName);

  const packageJsonPath = require.resolve(`${dependencyName}/package.json`, { paths: [packageRoot] });
  const dependencyRoot = path.dirname(packageJsonPath);
  const dependencyPackage = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    name: string;
    dependencies?: Record<string, string>;
  };

  const destinationPath = path.join(runtimeNodeModules, dependencyName);
  ensureDir(path.dirname(destinationPath));
  fs.cpSync(dependencyRoot, destinationPath, { recursive: true });

  for (const childName of Object.keys(dependencyPackage.dependencies || {})) {
    copyDependencyTree(packageRoot, runtimeNodeModules, childName, visited);
  }
}

function writeShim(targetPath: string, runtimeScript: string): void {
  const content = `#!/usr/bin/env sh
set -eu
NODE_BIN="\${NODE_BIN:-node}"
exec "$NODE_BIN" "${runtimeScript}" "$@"
`;

  fs.writeFileSync(targetPath, content, { encoding: "utf8", mode: 0o755 });
}

export function getDefaultAgentsHome(): string {
  return process.env.AGENTS_HOME || path.join(os.homedir(), ".agents");
}

export function getDefaultCodexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

type InstallTarget = "agents" | "codex";

interface InstallLocation {
  target: InstallTarget;
  mode: "full" | "shim-only";
  home: string;
  binDir: string;
  runtimeDir?: string;
  skillDir?: string;
  shimPath: string;
  shimInPath: boolean;
  pathHint?: string;
}

function installIntoHome(target: InstallTarget, home: string, packageRoot: string, force = false): InstallLocation {
  const runtimeDir = path.join(home, "tools", SKILL_NAME);
  const skillDir = path.join(home, "skills", SKILL_NAME);
  const binDir = path.join(home, "bin");
  const shimPath = path.join(binDir, CLI_NAME);

  if (force) {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    fs.rmSync(skillDir, { recursive: true, force: true });
    fs.rmSync(shimPath, { force: true });
  }

  ensureDir(runtimeDir);
  ensureDir(skillDir);
  ensureDir(binDir);

  fs.cpSync(path.join(packageRoot, "dist"), path.join(runtimeDir, "dist"), { recursive: true });
  fs.cpSync(path.join(packageRoot, "skills", SKILL_NAME), skillDir, { recursive: true });

  const runtimeNodeModules = path.join(runtimeDir, "node_modules");
  ensureDir(runtimeNodeModules);

  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const visited = new Set<string>();
  for (const dependencyName of Object.keys(packageJson.dependencies || {})) {
    copyDependencyTree(packageRoot, runtimeNodeModules, dependencyName, visited);
  }

  const runtimeScript = path.join(runtimeDir, "dist", "index.js");
  writeShim(shimPath, runtimeScript);

  return {
    target,
    mode: "full",
    home,
    binDir,
    runtimeDir,
    skillDir,
    shimPath,
    shimInPath: (process.env.PATH || "").split(path.delimiter).includes(binDir),
    pathHint: (process.env.PATH || "").split(path.delimiter).includes(binDir)
      ? undefined
      : `The shim exists, but ${binDir} is not in PATH. Use "${shimPath}" directly or add ${binDir} to PATH.`
  };
}

function installCompatibilityShim(target: InstallTarget, home: string, runtimeHome: string, force = false): InstallLocation {
  const runtimeDir = path.join(runtimeHome, "tools", SKILL_NAME);
  const runtimeScript = path.join(runtimeDir, "dist", "index.js");
  if (!fs.existsSync(runtimeScript)) {
    throw new Error(`Cannot create compatibility shim because runtime is missing: ${runtimeScript}`);
  }

  const binDir = path.join(home, "bin");
  const shimPath = path.join(binDir, CLI_NAME);
  const legacyRuntimeDir = path.join(home, "tools", SKILL_NAME);
  const legacySkillDir = path.join(home, "skills", SKILL_NAME);

  if (force) {
    fs.rmSync(legacyRuntimeDir, { recursive: true, force: true });
    fs.rmSync(legacySkillDir, { recursive: true, force: true });
    fs.rmSync(shimPath, { force: true });
  }

  ensureDir(binDir);
  writeShim(shimPath, runtimeScript);

  return {
    target,
    mode: "shim-only",
    home,
    binDir,
    runtimeDir,
    shimPath,
    shimInPath: (process.env.PATH || "").split(path.delimiter).includes(binDir),
    pathHint: (process.env.PATH || "").split(path.delimiter).includes(binDir)
      ? undefined
      : `The shim exists, but ${binDir} is not in PATH. Use "${shimPath}" directly or add ${binDir} to PATH.`
  };
}

export function detectInstalledRuntimeHome(runtimeDir: string): string | undefined {
  const normalized = path.resolve(runtimeDir);
  const skillDir = path.dirname(normalized);
  const toolsDir = path.dirname(skillDir);
  if (path.basename(normalized) !== "dist") {
    return undefined;
  }
  if (path.basename(skillDir) !== SKILL_NAME || path.basename(toolsDir) !== "tools") {
    return undefined;
  }
  return path.dirname(toolsDir);
}

export function installIntoAgentHomes(options?: {
  agentsHome?: string;
  codexHome?: string;
  force?: boolean;
  target?: "agents" | "codex" | "all";
}): {
  packageName: string;
  installerName: string;
  cliName: string;
  installs: InstallLocation[];
} {
  const packageRoot = resolvePackageRoot(__dirname);
  const agentsHome = options?.agentsHome || getDefaultAgentsHome();
  const codexHome = options?.codexHome || getDefaultCodexHome();
  const target = options?.target || "all";
  if (!["agents", "codex", "all"].includes(target)) {
    throw new Error(`Unsupported install target "${target}". Use agents, codex or all.`);
  }
  const installs: InstallLocation[] = [];

  if (target === "agents" || target === "all") {
    installs.push(installIntoHome("agents", agentsHome, packageRoot, options?.force));
  }

  if (target === "codex" || target === "all") {
    const shouldSkipCodex = installs.some((entry) => entry.home === codexHome);
    if (!shouldSkipCodex) {
      if (target === "codex") {
        installs.push(installIntoHome("codex", codexHome, packageRoot, options?.force));
      } else {
        installs.push(installCompatibilityShim("codex", codexHome, agentsHome, options?.force));
      }
    }
  }

  return {
    packageName: PACKAGE_NAME,
    installerName: INSTALLER_NAME,
    cliName: CLI_NAME,
    installs
  };
}
