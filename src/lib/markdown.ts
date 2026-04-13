import path from "node:path";

import matter from "gray-matter";

import { sha256 } from "./hash";
import type { DocumentRecord, SectionRecord } from "./types";

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

function countTokens(value: string): number {
  return value.trim() ? value.trim().split(/\s+/u).length : 0;
}

function normalizeTags(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
}

function deriveDocId(rootId: string, relPath: string): string {
  const withoutExtension = relPath.replace(/\.md$/iu, "");
  return `${rootId}.${slugify(withoutExtension.replace(/[\\/]+/g, "."))}`;
}

export function parseMarkdownDocument(
  absPath: string,
  relPath: string,
  rootId: string,
  rawContent: string,
  mtimeMs: number
): { document: DocumentRecord; sections: SectionRecord[] } {
  const parsed = matter(rawContent);
  const content = parsed.content.replace(/\r\n/g, "\n");
  const lines = content.split("\n");
  const headingPattern = /^(#{1,6})\s+(.*)$/u;
  const sections: SectionRecord[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  let introLines: string[] = [];
  let currentSection:
    | {
        heading: string;
        level: number;
        ordinal: number;
        lines: string[];
        pathParts: string[];
      }
    | undefined;
  let ordinal = 0;

  const flushCurrent = (): void => {
    if (!currentSection) {
      return;
    }

    const contentText = currentSection.lines.join("\n").trim();
    const headingPath = currentSection.pathParts.join(" > ");
    sections.push({
      sectionId: `${documentId}#${slugify(`${headingPath}-${currentSection.ordinal}`)}`,
      docId: documentId,
      rootId,
      heading: currentSection.heading,
      headingPath,
      level: currentSection.level,
      ordinal: currentSection.ordinal,
      content: contentText,
      tokenCount: countTokens(contentText)
    });
  };

  const titleFromFirstHeading = lines.find((line) => line.startsWith("# "))?.replace(/^#\s+/u, "").trim();
  const title =
    (typeof parsed.data.title === "string" && parsed.data.title.trim()) ||
    titleFromFirstHeading ||
    path.basename(relPath, ".md");
  const documentId =
    (typeof parsed.data.id === "string" && parsed.data.id.trim()) || deriveDocId(rootId, relPath);

  for (const line of lines) {
    const match = line.match(headingPattern);
    if (!match) {
      if (currentSection) {
        currentSection.lines.push(line);
      } else {
        introLines.push(line);
      }
      continue;
    }

    flushCurrent();

    const level = match[1].length;
    const heading = match[2].trim();

    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    stack.push({ level, title: heading });

    currentSection = {
      heading,
      level,
      ordinal: ordinal + 1,
      lines: [],
      pathParts: stack.map((entry) => entry.title)
    };
    ordinal += 1;
  }

  flushCurrent();

  const introText = introLines.join("\n").trim();
  if (introText) {
    sections.unshift({
      sectionId: `${documentId}#intro`,
      docId: documentId,
      rootId,
      heading: "Introduction",
      headingPath: "Introduction",
      level: 0,
      ordinal: 0,
      content: introText,
      tokenCount: countTokens(introText)
    });
  }

  const document: DocumentRecord = {
    docId: documentId,
    rootId,
    relPath,
    absPath,
    title,
    docType: typeof parsed.data.type === "string" ? parsed.data.type : undefined,
    status: typeof parsed.data.status === "string" ? parsed.data.status : undefined,
    tags: normalizeTags(parsed.data.tags),
    frontmatter: parsed.data as Record<string, unknown>,
    bodyText: content.trim(),
    fileHash: sha256(rawContent),
    mtimeMs
  };

  if (sections.length === 0) {
    sections.push({
      sectionId: `${documentId}#body`,
      docId: documentId,
      rootId,
      heading: title,
      headingPath: title,
      level: 0,
      ordinal: 0,
      content: document.bodyText,
      tokenCount: countTokens(document.bodyText)
    });
  }

  return { document, sections };
}

