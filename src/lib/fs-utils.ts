import fs from "node:fs";
import path from "node:path";

export function ensureDir(targetPath: string): void {
  fs.mkdirSync(targetPath, { recursive: true });
}

export function writeTextFile(targetPath: string, content: string): void {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, content, "utf8");
}

export function writeJsonFile(targetPath: string, value: unknown): void {
  writeTextFile(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeJsonAtomic(targetPath: string, value: unknown): void {
  const tempPath = `${targetPath}.tmp`;
  writeJsonFile(tempPath, value);
  fs.renameSync(tempPath, targetPath);
}

export function replaceFileAtomic(targetPath: string, content: string | Buffer): void {
  const tempPath = `${targetPath}.tmp`;
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(tempPath, content);
  fs.renameSync(tempPath, targetPath);
}

export function readJsonFile<T>(targetPath: string): T {
  return JSON.parse(fs.readFileSync(targetPath, "utf8")) as T;
}

export function fileExists(targetPath: string): boolean {
  return fs.existsSync(targetPath);
}

export function isDirectory(targetPath: string): boolean {
  return fileExists(targetPath) && fs.statSync(targetPath).isDirectory();
}

export function walkMarkdownFiles(rootPath: string): string[] {
  const files: string[] = [];
  const skipDirs = new Set([".git", "node_modules", ".DS_Store"]);

  function walk(currentPath: string): void {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (skipDirs.has(entry.name)) {
        continue;
      }
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(entryPath);
      }
    }
  }

  walk(rootPath);
  return files.sort();
}

