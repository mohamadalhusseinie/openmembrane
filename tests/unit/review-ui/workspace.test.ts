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

  it.each([
    { oldLoader: "loadOverview()", newLoader: "loadCandidates()", oldError: false },
    { oldLoader: "loadOverview()", newLoader: "loadCandidates()", oldError: true },
    { oldLoader: "loadCandidates()", newLoader: "loadOverview()", oldError: false },
    { oldLoader: "loadCandidates()", newLoader: "loadOverview()", oldError: true },
  ])("keeps the newest badge across $oldLoader and $newLoader (old error: $oldError)", async ({ oldLoader, newLoader, oldError }) => {
    const { context, api, element } = await setupWorkspace();
    let complete!: (value: unknown) => void;
    let fail!: (error: Error) => void;
    let queueFetches = 0;
    api.mockImplementation(async path => {
      if (path !== "/api/candidates") return [];
      if (++queueFetches === 1) return new Promise((resolve, reject) => { complete = resolve; fail = reject; });
      if (!oldError) throw new Error("Latest queue unavailable");
      return [candidate(), candidate({ id: "cand_2" })];
    });
    const oldRequest = runInContext(oldLoader, context) as Promise<void>;
    await runInContext(newLoader, context);
    const badge = element("pending-tab-btn").innerHTML;
    expect(badge).toContain(oldError ? 'aria-label="2 proposals"' : 'aria-label="Queue unavailable"');
    if (oldError) fail(new Error("Obsolete queue failure"));
    else complete([candidate()]);
    await oldRequest;
    expect(element("pending-tab-btn").innerHTML).toBe(badge);
  });

  it("does not let an overview started during approval overwrite the post-approval badge", async () => {
    const { context, api, element } = await setupWorkspace();
    let completeApproval!: (value: unknown) => void;
    let completeOverview!: (value: unknown) => void;
    let queueFetches = 0;
    runInContext("currentTab = 'pending'", context);
    api.mockImplementation(async (path, options) => {
      if (options) return new Promise(resolve => { completeApproval = resolve; });
      if (path === "/api/candidates" && ++queueFetches === 1) {
        return new Promise(resolve => { completeOverview = resolve; });
      }
      return [];
    });
    const approval = runInContext("approveCandidate('cand_1')", context) as Promise<void>;
    const overview = runInContext("loadOverview()", context) as Promise<void>;
    completeApproval({ ok: true, memory: entry() });
    await approval;
    expect(element("pending-tab-btn").innerHTML).toBe("Review queue");
    completeOverview([candidate()]);
    await overview;
    expect(element("pending-tab-btn").innerHTML).toBe("Review queue");
    expect(element("pending-content").innerHTML).toContain("You are all caught up");
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
    complete({ ok: true, memory: entry() });
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

  it.each([
    { publication: {}, type: "success", message: "Memory approved and saved." },
    { publication: { kind: "published" }, type: "success", message: "A team proposal was published for review." },
    {
      publication: { kind: "rejected", message: "The accepted memory cannot be published safely." },
      type: "error", message: "Team publication failed: The accepted memory cannot be published safely. No retry is scheduled.",
    },
    {
      publication: { kind: "retry_scheduled", nextAttemptAt: "2030-01-01T12:00:00Z" },
      type: "error", message: "Team publication failed; a retry is scheduled",
    },
    {
      publication: { kind: "retry_deferred", nextAttemptAt: "2030-01-01T12:00:00Z" },
      type: "error", message: "Team publication is deferred",
    },
  ])("reports the actual single approval outcome ($publication.kind)", async ({ publication, type, message }) => {
    const { context, api, element } = await setupWorkspace();
    runInContext("currentTab = 'pending'", context);
    api.mockImplementation(async (_path, options) => options ? { ok: true, memory: { ...entry(), ...publication } } : []);
    await runInContext("approveCandidate('cand_1')", context);
    expect(context.showToast).toHaveBeenCalledWith(expect.stringContaining(message), type);
    if (type === "error") {
      expect(context.showToast).not.toHaveBeenCalledWith(expect.anything(), "success");
    }
    if ("nextAttemptAt" in publication) {
      expect(context.showToast).toHaveBeenCalledWith(expect.stringContaining("2030"), "error");
    }
    expect(element("pending-content").innerHTML).toContain("You are all caught up");
  });

  it("reports mixed bulk publication outcomes separately and retains escaped failure details", async () => {
    const { context, api, element } = await setupWorkspace();
    runInContext("currentTab = 'pending'", context);
    api.mockImplementation(async (_path, options) => options ? {
      approved: 4,
      outcomes: [
        entry({ id: "local" }),
        { ...entry({ id: "team" }), kind: "published" },
        { ...entry({ id: "retry" }), kind: "retry_scheduled", nextAttemptAt: "2030-01-01T12:00:00Z" },
        { ...entry({ id: "deferred" }), kind: "retry_deferred", nextAttemptAt: "2030-01-02T12:00:00Z" },
        { ...entry({ id: "failed" }), kind: "rejected", message: "Invalid <memory>" },
      ],
      skipped: [{ candidateId: "secret", reason: "Secret <proposal>" }],
    } : []);
    await runInContext("approveAllCandidates()", context);
    expect(context.showToast).toHaveBeenCalledWith(
      expect.stringContaining("Saved: 1; team proposals published: 1; retries scheduled: 1; retries deferred: 1; publication failures: 1; skipped: 1."),
      "error",
    );
    const result = element("review-result").innerHTML;
    expect(result).toContain("Bulk review result");
    expect(result).toContain("failed: Team publication failed: Invalid &lt;memory&gt; No retry is scheduled.");
    expect(result).toContain("secret: Skipped. Secret &lt;proposal&gt;");
    expect(result).toContain("deferred: Team publication is deferred");
    expect(result).not.toContain("Invalid <memory>");
  });

  it("reports a fully rejected bulk publication as failure, not approval", async () => {
    const { context, api } = await setupWorkspace();
    runInContext("currentTab = 'pending'", context);
    api.mockImplementation(async (_path, options) => options ? {
      approved: 0, skipped: [],
      outcomes: [{ ...entry(), kind: "rejected", message: "Not configured." }],
    } : []);
    await runInContext("approveAllCandidates()", context);
    expect(context.showToast).toHaveBeenCalledWith(expect.stringContaining("publication failures: 1"), "error");
    expect(context.showToast).not.toHaveBeenCalledWith(expect.anything(), "success");
  });

  const refreshedViews = [
    { loader: "loadAudit()", target: "audit-content", input: null, response: [{ entityId: "fresh-result", type: "memory_saved" }] },
    { loader: "loadDiagnostics()", target: "diagnostics-content", input: "diag-severity", response: [{ code: "fresh-result", severity: "error" }] },
    { loader: "loadStaleMemories()", target: "stale-content", input: "stale-months", response: [entry({ content: "fresh-result" })] },
  ];

  it.each(refreshedViews.flatMap(view => [false, true].map(oldError => ({ ...view, oldError }))))(
    "ignores outdated $loader responses (old error: $oldError)",
    async ({ loader, target, input, response, oldError }) => {
      const { context, api, element } = await setupWorkspace();
      let complete!: (value: unknown) => void;
      let fail!: (error: Error) => void;
      api.mockImplementationOnce(() => new Promise((resolve, reject) => { complete = resolve; fail = reject; }));
      if (input) element(input).value = input === "stale-months" ? "6" : "warning";
      const oldRequest = runInContext(loader, context) as Promise<void>;
      if (input) element(input).value = input === "stale-months" ? "3" : "error";
      if (oldError) api.mockResolvedValueOnce(response);
      else api.mockRejectedValueOnce(new Error("fresh-error"));
      await runInContext(loader, context);
      const latest = element(target).innerHTML;
      expect(latest).toContain(oldError ? "fresh-result" : "fresh-error");
      if (oldError) fail(new Error("obsolete-error"));
      else complete(response);
      await oldRequest;
      expect(element(target).innerHTML).toBe(latest);
      expect(element(target).innerHTML).not.toContain("obsolete-error");
      if (input) {
        expect(api.mock.calls[0]?.[0]).toContain(input === "stale-months" ? "staleAfterMonths=6" : "severity=warning");
        expect(api.mock.calls[1]?.[0]).toContain(input === "stale-months" ? "staleAfterMonths=3" : "severity=error");
      }
    },
  );

  it("updates navigation and focus without discarding existing views", async () => {
    const { context, element, nav } = await setupWorkspace();
    runInContext("tabsLoaded.memories = true; switchTab('memories')", context);
    expect(nav.setAttribute).toHaveBeenCalledWith("aria-current", "page");
    expect(element("page-title").textContent).toBe("Saved memories");
    expect(element("page-title").focus).toHaveBeenCalledOnce();
    expect(element("tab-memories").classList.add).toHaveBeenCalledWith("active");
  });
});
