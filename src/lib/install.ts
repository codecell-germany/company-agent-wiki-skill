import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CLI_NAME, INSTALLER_NAME, SKILL_NAME } from "./constants";
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

export function installIntoCodexHome(options?: {
  codexHome?: string;
  force?: boolean;
}): {
  codexHome: string;
  binDir: string;
  runtimeDir: string;
  skillDir: string;
  shimPath: string;
  shimInPath: boolean;
  pathHint?: string;
} {
  const packageRoot = resolvePackageRoot(__dirname);
  const codexHome = options?.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const runtimeDir = path.join(codexHome, "tools", SKILL_NAME);
  const skillDir = path.join(codexHome, "skills", SKILL_NAME);
  const binDir = path.join(codexHome, "bin");
  const shimPath = path.join(binDir, CLI_NAME);

  if (options?.force) {
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
    codexHome,
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
