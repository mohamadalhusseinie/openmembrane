import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { candidate, entry } from "../helpers";

async function setupWorkspace() {
  const html = await readFile(resolve("apps", "review-ui", "public", "index.html"), "utf8");
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!script) throw new Error("Expected workspace script.");
  const makeElement = () => ({
    innerHTML: "", textContent: "", value: "", options: [], disabled: false, hidden: false,
    classList: { add: vi.fn(), remove: vi.fn() },
    setAttribute: vi.fn(), removeAttribute: vi.fn(), focus: vi.fn(),
    querySelectorAll: () => [],
  });
  const elements = new Map<string, ReturnType<typeof makeElement>>();
  function element(id: string) {
    let result = elements.get(id);
    if (!result) { result = makeElement(); elements.set(id, result); }
    return result;
  }
  const queueButtons = [makeElement(), makeElement()];
  const nav = makeElement();
  const context = createContext({
    document: {
      getElementById: element,
      querySelector: () => nav,
      querySelectorAll: (selector: string) => selector === "#tab-pending button" ? queueButtons : [],
    },
    URLSearchParams,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  runInContext(script, context);
  await runInContext("loadMemories()", context);
  const api = vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => []);
  context.apiRequest = api;
  context.showToast = vi.fn();
  context.window = {
    confirm: vi.fn(() => true), prompt: vi.fn<() => string | null>(() => ""),
    matchMedia: () => ({ matches: false }),
  };
  return { context, element, api, queueButtons, nav };
}

describe("review workspace", () => {
  it("shows unavailable queue data separately from a successful empty older-memory result", async () => {
    const { context, api, element } = await setupWorkspace();
    api.mockImplementation(async path => {
      if (path === "/api/candidates") throw new Error("Daemon unavailable (diagnostic: diag_42)");
      return [];
    });
    await runInContext("loadOverview()", context);
    expect(element("overview-pending").innerHTML).toContain("Daemon unavailable");
    expect(element("overview-pending").innerHTML).toContain("Try again");
    expect(element("overview-pending").innerHTML).not.toContain("No proposals waiting");
    expect(element("pending-tab-btn").innerHTML).toContain("Queue unavailable");
    expect(element("overview-stale").innerHTML).toContain("No active memories older than 6 months");
  });

  it("ignores superseded older memories and outdated overview responses", async () => {
    const { context, api, element } = await setupWorkspace();
    let complete!: (value: unknown) => void;
    api.mockImplementation(async path => path === "/api/candidates"
      ? new Promise(resolve => { complete = resolve; })
      : [entry(), entry({ status: "superseded" })]);
    const older = runInContext("loadOverview()", context) as Promise<void>;
    api.mockResolvedValue([]);
    await runInContext("loadOverview()", context);
    complete([candidate()]);
    await older;
    expect(element("overview-pending").innerHTML).toContain("No proposals waiting");
    expect(element("overview-stale").innerHTML).toContain("No active memories older than 6 months");
    api.mockImplementation(async path => path === "/api/candidates" ? [] : [entry(), entry({ status: "superseded" })]);
    await runInContext("loadOverview()", context);
    expect(element("overview-stale").innerHTML).toContain("1 active memory has");
  });

  it("explains secret blocking, escapes proposal data, and disables ineligible bulk approval", async () => {
    const { context, api, element } = await setupWorkspace();
    api.mockResolvedValue([candidate({
      id: "cand_'quoted", sensitivity: "secret", content: "<script>unsafe</script>", reason: "<evidence>",
    })]);
    await runInContext("loadCandidates()", context);
    const queue = element("pending-content").innerHTML;
    expect(queue).toContain("Approval blocked");
    expect(queue).toContain('onclick="approveCandidate(this.dataset.id)" disabled');
    expect(queue).toContain('data-id="cand_&#39;quoted"');
    expect(queue).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
    expect(queue).toContain("&lt;evidence&gt;");
    expect(queue).toContain("Coding rule");
    expect(element("approve-all").disabled).toBe(true);
    expect(element("reject-all").disabled).toBe(false);
  });

  it("prevents duplicate decisions and refreshes the queue and cached views after saving", async () => {
    const { context, api, queueButtons, element } = await setupWorkspace();
    let complete!: (value: unknown) => void;
    api.mockImplementation(async (_path, options) => options
      ? new Promise(resolve => { complete = resolve; })
      : []);
    runInContext("currentTab = 'pending'; tabsLoaded.overview = true; tabsLoaded.memories = true", context);
    const decision = runInContext("approveCandidate('cand_1')", context) as Promise<void>;
    expect(queueButtons.every(button => button.disabled)).toBe(true);
    await runInContext("approveCandidate('cand_1')", context);
    expect(api).toHaveBeenCalledTimes(1);
    complete({ ok: true });
    await decision;
    expect(api).toHaveBeenLastCalledWith("/api/candidates");
    expect(element("pending-content").innerHTML).toContain("You are all caught up");
    expect(element("approve-all").disabled).toBe(true);
    expect(element("page-title").focus).toHaveBeenCalled();
    expect(runInContext("tabsLoaded.overview || tabsLoaded.memories", context)).toBe(false);
  });

  it("does not submit canceled bulk approval or canceled rejection", async () => {
    const { context, api } = await setupWorkspace();
    context.window.confirm.mockReturnValue(false);
    context.window.prompt.mockReturnValue(null);
    await runInContext("approveAllCandidates()", context);
    await runInContext("rejectAllCandidates()", context);
    await runInContext("rejectCandidate('cand_1')", context);
    expect(api).not.toHaveBeenCalled();
  });

  it("keeps a failed decision visible as an error and recovers queue controls", async () => {
    const { context, api, element } = await setupWorkspace();
    api.mockImplementation(async (_path, options) => {
      if (options) throw new Error("Publication failed (diagnostic: diag_9)");
      return [candidate()];
    });
    runInContext("currentTab = 'pending'", context);
    await runInContext("approveCandidate('cand_1')", context);
    expect(context.showToast).toHaveBeenCalledWith("Publication failed (diagnostic: diag_9)", "error");
    expect(element("approve-all").disabled).toBe(false);
    expect(element("pending-content").innerHTML).not.toContain('onclick="approveCandidate(this.dataset.id)" disabled');
  });

  it("updates navigation and focus without discarding existing views", async () => {
    const { context, element, nav } = await setupWorkspace();
    runInContext("tabsLoaded.memories = true; switchTab('memories')", context);
    expect(nav.setAttribute).toHaveBeenCalledWith("aria-current", "page");
    expect(element("page-title").textContent).toBe("Saved memories");
    expect(element("page-title").focus).toHaveBeenCalledOnce();
    expect(element("tab-memories").classList.add).toHaveBeenCalledWith("active");
  });
});
