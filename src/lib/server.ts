import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";

import { marked } from "marked";

import { CLI_NAME } from "./constants";
import { CliError, coerceCliError } from "./errors";
import { errorEnvelope } from "./output";
import { getGitDiff, getGitHistory } from "./git";
import { getDocumentMetadataByPath, rebuildIndex, resolveDocumentById, route, search, verifyIndex } from "./indexer";

const CSS = `
  :root {
    color-scheme: light dark;
    font-family: "IBM Plex Sans", "Helvetica Neue", sans-serif;
    background: #f3efe8;
    color: #17212b;
  }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    grid-template-columns: 420px 1fr;
    background:
      radial-gradient(circle at top left, rgba(255, 210, 160, 0.3), transparent 32%),
      linear-gradient(135deg, #f8f4ed 0%, #ece5d9 100%);
  }
  aside {
    padding: 24px;
    border-right: 1px solid rgba(23, 33, 43, 0.1);
    backdrop-filter: blur(8px);
  }
  main {
    padding: 24px 28px 48px;
    overflow: auto;
  }
  h1, h2, h3 {
    margin-top: 0;
    font-family: "Fraunces", "Georgia", serif;
  }
  input, button {
    font: inherit;
    border-radius: 12px;
    border: 1px solid rgba(23, 33, 43, 0.15);
    padding: 10px 14px;
  }
  input {
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 12px;
    background: rgba(255,255,255,0.85);
  }
  button {
    cursor: pointer;
    background: #17212b;
    color: white;
  }
  .panel {
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(23, 33, 43, 0.08);
    border-radius: 20px;
    padding: 18px;
    margin-bottom: 18px;
    box-shadow: 0 14px 40px rgba(23, 33, 43, 0.08);
  }
  .result {
    padding: 12px 0;
    border-top: 1px solid rgba(23, 33, 43, 0.08);
  }
  .result:first-child {
    border-top: none;
    padding-top: 0;
  }
  .result button {
    margin-top: 8px;
  }
  .meta {
    color: rgba(23, 33, 43, 0.7);
    font-size: 0.9rem;
  }
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 12px;
  }
  .stat {
    background: rgba(23, 33, 43, 0.05);
    border: 1px solid rgba(23, 33, 43, 0.08);
    border-radius: 14px;
    padding: 12px;
  }
  .stat strong {
    display: block;
    font-size: 1.1rem;
  }
  .stat span {
    color: rgba(23, 33, 43, 0.72);
    font-size: 0.86rem;
  }
  .root-item {
    padding: 10px 0;
    border-top: 1px solid rgba(23, 33, 43, 0.08);
  }
  .root-item:first-child {
    border-top: none;
    padding-top: 0;
  }
  .badge {
    display: inline-block;
    border-radius: 999px;
    padding: 3px 8px;
    font-size: 0.78rem;
    font-weight: 600;
    background: rgba(23, 33, 43, 0.08);
  }
  .badge.ok {
    background: rgba(42, 122, 80, 0.16);
    color: #1d5d3d;
  }
  .badge.warn {
    background: rgba(184, 104, 22, 0.18);
    color: #8c4b06;
  }
  .placeholder {
    color: rgba(23, 33, 43, 0.72);
  }
  details summary {
    cursor: pointer;
    font-weight: 600;
    margin-bottom: 10px;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: rgba(23, 33, 43, 0.92);
    color: #fdfbf7;
    padding: 16px;
    border-radius: 16px;
  }
  mark {
    background: #f7d27f;
    color: #17212b;
    padding: 0 2px;
  }
`;

const CLIENT_SCRIPT = `
  const queryInput = document.getElementById("query");
  const resultsNode = document.getElementById("results");
  const indexSummaryNode = document.getElementById("index-summary");
  const rootListNode = document.getElementById("root-list");
  const statusNode = document.getElementById("status");
  const actionsNode = document.getElementById("actions");
  const documentNode = document.getElementById("document");
  const historyNode = document.getElementById("history");
  const diffNode = document.getElementById("diff");

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function loadStatus() {
    const response = await fetch("/api/status");
    const data = await response.json();
    statusNode.textContent = JSON.stringify(data, null, 2);
    actionsNode.innerHTML = "";

    if (!data.ok) {
      indexSummaryNode.innerHTML = '<div class="placeholder">Indexstatus konnte nicht geladen werden.</div>';
      rootListNode.innerHTML = "";
      return;
    }

    const verification = data.data.verification;
    const manifest = verification.manifest;
    if (verification.state === "missing") {
      indexSummaryNode.innerHTML = [
        '<div class="placeholder">Der Index wurde für diesen Workspace noch nicht aufgebaut.</div>',
        verification.hint ? '<div class="meta">' + escapeHtml(verification.hint) + '</div>' : ""
      ].join("");
      rootListNode.innerHTML = "";
      renderRebuildAction("Index jetzt aufbauen");
      return;
    }

    const verificationLabel = verification.ok ? "frisch" : "stale";
    const verificationClass = verification.ok ? "ok" : "warn";

    indexSummaryNode.innerHTML = [
      '<div class="summary-grid">',
      '<div class="stat"><strong>' + escapeHtml(manifest.documentCount) + '</strong><span>Dokumente</span></div>',
      '<div class="stat"><strong>' + escapeHtml(manifest.sectionCount) + '</strong><span>Abschnitte</span></div>',
      '<div class="stat"><strong>' + escapeHtml(manifest.buildId) + '</strong><span>Build-ID</span></div>',
      '<div class="stat"><strong><span class="badge ' + verificationClass + '">' + verificationLabel + '</span></strong><span>Indexstatus</span></div>',
      '</div>',
      '<div class="meta">Workspace: ' + escapeHtml(manifest.workspacePath) + '</div>',
      '<div class="meta">Indexiert: ' + escapeHtml(manifest.indexedAt) + '</div>'
    ].join("");

    if (verification.state === "stale") {
      renderRebuildAction("Stalen Index neu aufbauen");
    }

    rootListNode.innerHTML = manifest.roots.map((root) => {
      const verificationRoot = verification.roots.find((item) => item.id === root.id);
      const rootOk = !verificationRoot || verificationRoot.ok;
      const badgeClass = rootOk ? "ok" : "warn";
      const badgeText = rootOk ? "ok" : "stale";
      return [
        '<div class="root-item">',
        '<div><strong>' + escapeHtml(root.id) + '</strong> <span class="badge ' + badgeClass + '">' + badgeText + '</span></div>',
        '<div class="meta">' + escapeHtml(root.path) + '</div>',
        '<div class="meta">' + escapeHtml(root.fileCount) + ' Dateien, letzter mtime: ' + escapeHtml(root.latestMtimeMs) + '</div>',
        '</div>'
      ].join("");
    }).join("");
  }

  async function rebuildCurrentIndex() {
    actionsNode.innerHTML = '<div class="meta">Index wird neu aufgebaut ...</div>';
    const response = await fetch("/api/rebuild", { method: "POST" });
    const payload = await response.json();
    if (!payload.ok) {
      actionsNode.innerHTML = '<pre>' + JSON.stringify(payload, null, 2) + '</pre>';
      return;
    }
    await loadStatus();
  }

  function renderRebuildAction(label) {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", rebuildCurrentIndex);
    actionsNode.innerHTML = "";
    actionsNode.appendChild(button);
  }

  async function runSearch() {
    const query = queryInput.value.trim();
    if (!query) {
      return;
    }
    const response = await fetch("/api/route?q=" + encodeURIComponent(query));
      const payload = await response.json();
      resultsNode.innerHTML = "";
      if (!payload.ok) {
        resultsNode.innerHTML = "<pre>" + JSON.stringify(payload, null, 2) + "</pre>";
        if (payload.error && (payload.error.code === "INDEX_MISSING" || payload.error.code === "INDEX_STALE")) {
          renderRebuildAction("Index neu aufbauen");
        }
        return;
      }
    for (const item of payload.data.groups) {
      const wrapper = document.createElement("div");
      wrapper.className = "result";
      wrapper.innerHTML = [
        "<strong>" + item.title + "</strong>",
        '<div class="meta">' + item.bestHeading + "</div>",
        "<div>" + item.bestSnippet + "</div>"
      ].join("");
      const button = document.createElement("button");
      button.textContent = "Open document";
      button.addEventListener("click", () => loadDocument(item.docId));
      wrapper.appendChild(button);
      resultsNode.appendChild(wrapper);
    }
  }

  async function loadDocument(docId) {
    const response = await fetch("/api/document?docId=" + encodeURIComponent(docId));
    const payload = await response.json();
    documentNode.innerHTML = payload.ok ? payload.data.renderedHtml : "<pre>" + JSON.stringify(payload, null, 2) + "</pre>";
    historyNode.textContent = "";
    diffNode.textContent = "";

    if (!payload.ok) {
      if (payload.error && (payload.error.code === "INDEX_MISSING" || payload.error.code === "INDEX_STALE")) {
        renderRebuildAction("Index neu aufbauen");
      }
      return;
    }

    const historyResponse = await fetch("/api/history?docId=" + encodeURIComponent(docId));
    const historyPayload = await historyResponse.json();
    historyNode.textContent = JSON.stringify(historyPayload, null, 2);

    const diffResponse = await fetch("/api/diff?docId=" + encodeURIComponent(docId));
    const diffPayload = await diffResponse.json();
    diffNode.textContent = diffPayload.ok ? diffPayload.data.diff || "No diff against HEAD." : JSON.stringify(diffPayload, null, 2);
  }

  document.getElementById("run-search").addEventListener("click", runSearch);
  queryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      runSearch();
    }
  });

  loadStatus();
`;

function sendJson(response: http.ServerResponse, payload: unknown, statusCode = 200): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload, null, 2));
}

function getHttpStatusCode(error: unknown): number {
  const normalizedError = error instanceof CliError ? error : coerceCliError(error);
  if (!(normalizedError instanceof CliError)) {
    return 500;
  }

  switch (normalizedError.code) {
    case "INVALID_QUERY":
    case "WORKSPACE_REQUIRED":
    case "READ_TARGET_REQUIRED":
    case "ANSWERS_FILE_REQUIRED":
    case "FORCE_REQUIRES_EXECUTE":
      return 400;
    case "DOCUMENT_NOT_FOUND":
    case "ROOT_NOT_FOUND":
      return 404;
    case "INDEX_MISSING":
    case "INDEX_STALE":
      return 409;
    case "SQLITE_LOCKED":
      return 423;
    default:
      return 500;
  }
}

function sendHtml(response: http.ServerResponse, html: string): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(html);
}

export function startServer(workspaceRoot: string, port: number, options?: { autoRebuild?: boolean }): http.Server {
  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      sendJson(response, errorEnvelope("serve", new Error("Missing request URL")), 400);
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");
    try {
      if (url.pathname === "/") {
        sendHtml(
          response,
          `<!doctype html>
            <html lang="en">
              <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>${CLI_NAME}</title>
                <style>${CSS}</style>
              </head>
              <body>
                <aside>
                  <div class="panel">
                    <h1>Company Agent Wiki</h1>
                    <p>Read-only Index, Quelldokumente und Git-Historie. Diese Ansicht wird vom installierten CLI ausgeliefert.</p>
                    <input id="query" placeholder="Search company knowledge" />
                    <button id="run-search">Search</button>
                  </div>
                  <div class="panel">
                    <h2>Index</h2>
                    <div id="index-summary" class="placeholder">Lade Indexübersicht ...</div>
                    <div id="actions"></div>
                    <div id="root-list"></div>
                  </div>
                  <div class="panel">
                    <h2>Results</h2>
                    <div id="results" class="placeholder">Suchbegriff eingeben, um geroutete Treffer zu sehen.</div>
                  </div>
                  <div class="panel">
                    <details>
                      <summary>Rohstatus JSON</summary>
                      <pre id="status"></pre>
                    </details>
                  </div>
                </aside>
                <main>
                  <div class="panel">
                    <h2>Document</h2>
                    <div id="document">Select a result.</div>
                  </div>
                  <div class="panel">
                    <h2>Git History</h2>
                    <pre id="history"></pre>
                  </div>
                  <div class="panel">
                    <h2>Git Diff</h2>
                    <pre id="diff"></pre>
                  </div>
                </main>
                <script>${CLIENT_SCRIPT}</script>
              </body>
            </html>`
        );
        return;
      }

      if (url.pathname === "/api/status") {
        const verification = verifyIndex(workspaceRoot);
        sendJson(response, {
          ok: true,
          data: {
            verification
          }
        });
        return;
      }

      if (url.pathname === "/api/rebuild" && request.method === "POST") {
        const manifest = rebuildIndex(workspaceRoot);
        sendJson(response, { ok: true, data: manifest });
        return;
      }

      if (url.pathname === "/api/search") {
        const query = url.searchParams.get("q") || "";
        sendJson(response, { ok: true, data: search(workspaceRoot, query, 10, { autoRebuild: options?.autoRebuild }) });
        return;
      }

      if (url.pathname === "/api/route") {
        const query = url.searchParams.get("q") || "";
        sendJson(response, { ok: true, data: route(workspaceRoot, query, 10, { autoRebuild: options?.autoRebuild }) });
        return;
      }

      if (url.pathname === "/api/document") {
        const docId = url.searchParams.get("docId");
        if (!docId) {
          sendJson(response, errorEnvelope("document", new Error("Missing docId")), 400);
          return;
        }
        const resolved = resolveDocumentById(workspaceRoot, docId, { autoRebuild: options?.autoRebuild });
        const rawMarkdown = fs.readFileSync(resolved.absPath, "utf8");
        sendJson(response, {
          ok: true,
          data: {
            ...resolved,
            rawMarkdown,
            renderedHtml: marked.parse(rawMarkdown)
          }
        });
        return;
      }

      if (url.pathname === "/api/history") {
        const docId = url.searchParams.get("docId");
        if (!docId) {
          sendJson(response, errorEnvelope("history", new Error("Missing docId")), 400);
          return;
        }
        const resolved = resolveDocumentById(workspaceRoot, docId, { autoRebuild: options?.autoRebuild });
        sendJson(response, {
          ok: true,
          data: {
            docId,
            history: getGitHistory(resolved.absPath, 20)
          }
        });
        return;
      }

      if (url.pathname === "/api/diff") {
        const docId = url.searchParams.get("docId");
        if (!docId) {
          sendJson(response, errorEnvelope("diff", new Error("Missing docId")), 400);
          return;
        }
        const resolved = resolveDocumentById(workspaceRoot, docId, { autoRebuild: options?.autoRebuild });
        sendJson(response, {
          ok: true,
          data: {
            docId,
            diff: getGitDiff(resolved.absPath, "HEAD")
          }
        });
        return;
      }

      response.statusCode = 404;
      response.end("Not found");
    } catch (error) {
      sendJson(response, errorEnvelope("serve", error), getHttpStatusCode(error));
    }
  });

  server.listen(port, "127.0.0.1");
  return server;
}
