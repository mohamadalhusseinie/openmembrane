import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { OpenMembraneClient } from "@openmembrane/client";

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

export async function openReview(
  client: OpenMembraneClient,
  projectName: string,
  report: (error: unknown) => void,
  subscriptions: vscode.Disposable[],
): Promise<void> {
  const candidates = await client.listMemoryCandidates({ limit: null });
  const panel = vscode.window.createWebviewPanel(
    "openmembrane.review", `OpenMembrane: ${projectName}`, vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] },
  );
  let disposed = false;
  let busy = false;
  let ids = new Set(candidates.map((candidate) => candidate.id));
  const render = (items: typeof candidates): void => {
    if (disposed) return;
    ids = new Set(items.map((candidate) => candidate.id));
    const nonce = randomBytes(16).toString("hex");
    panel.webview.html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px;max-width:900px}article{border-bottom:1px solid var(--vscode-panel-border);padding:16px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{margin-right:8px;padding:6px 12px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;cursor:pointer}button:focus-visible{outline:2px solid var(--vscode-focusBorder)}</style>
</head><body><h1>Pending candidates</h1><p>${escape(projectName)}</p>
${items.length === 0 ? "<p>No pending candidates.</p>" : items.map((item) => `<article>
<h2>${escape(item.type)}</h2><pre>${escape(item.content)}</pre>
<p>${escape(item.sensitivity)} / ${escape(item.recommendedAction)}: ${escape(item.reason)}</p>
<button data-action="approve" data-id="${escape(item.id)}">Approve</button>
<button data-action="reject" data-id="${escape(item.id)}">Reject</button></article>`).join("")}
<script nonce="${nonce}">const api=acquireVsCodeApi();document.addEventListener('click',event=>{const button=event.target.closest('button');if(button){document.querySelectorAll('button').forEach(b=>b.disabled=true);api.postMessage({action:button.dataset.action,id:button.dataset.id});}});</script>
</body></html>`;
  };
  render(candidates);
  const listener = panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (disposed || busy || typeof message !== "object" || message === null ||
      !("action" in message) || !("id" in message) || typeof message.id !== "string" ||
      !ids.has(message.id) || (message.action !== "approve" && message.action !== "reject")) return;
    busy = true;
    try {
      if (message.action === "approve") {
        const result = await client.approveMemoryCandidate({ candidateId: message.id });
        if ("kind" in result && result.kind !== "published") {
          void vscode.window.showWarningMessage("Memory approved locally, but team publication is pending or rejected. See diagnostics.");
        }
      } else {
        await client.rejectMemoryCandidate({ candidateId: message.id });
      }
    } catch (error) {
      report(error);
    } finally {
      busy = false;
      if (!disposed) {
        try {
          render(await client.listMemoryCandidates({ limit: null }));
        } catch (error) {
          report(error);
          panel.dispose();
        }
      }
    }
  });
  panel.onDidDispose(() => { disposed = true; listener.dispose(); });
  subscriptions.push(panel);
}
