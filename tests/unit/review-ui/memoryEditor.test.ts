import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { entry } from "../helpers";

async function setupUi() {
  const html = await readFile(resolve("apps", "review-ui", "public", "index.html"), "utf8");
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (script === undefined) throw new Error("Expected the review UI script.");
  const elements = new Map<string, {
    value: string; options: Array<{ value: string; text: string }>; innerHTML: string; hidden: boolean; querySelectorAll: () => [];
  }>();
  for (const id of ["mem-search", "mem-type", "mem-scope", "memories-content", "memory-editor-0"]) {
    elements.set(id, { value: "", options: [], innerHTML: "", hidden: true, querySelectorAll: () => [] });
  }
  const getElementById = (id: string) => {
    const element = elements.get(id);
    if (element === undefined) throw new Error(`Unexpected element: ${id}`);
    return element;
  };
  const context = createContext({
    document: { getElementById }, URLSearchParams,
    fetch: async () => ({ ok: true, json: async () => [entry({ content: 'Use "strict" TypeScript settings.' })] }),
  });
  runInContext(script, context);
  await runInContext("loadMemories()", context);
  return { context, getElementById };
}

describe("review UI memory editor", () => {
  it.each([
    { supersede: false, outcome: "success" },
    { supersede: true, outcome: "success" },
    { supersede: false, outcome: "rejected" },
    { supersede: false, outcome: "retry_deferred" },
    { supersede: false, outcome: "failed" },
  ])("preserves drafts when lists refresh during a pending mutation ($outcome, supersede: $supersede)", async ({ supersede, outcome }) => {
    const { context } = await setupUi();
    function form(id: string, view: string, content: string, dirty: boolean, expanded = true) {
      const fieldValues = {
        content, type: "coding_rule", scope: "frontend", tags: "draft",
        reason: "Unsaved reason", replacementId: "replacement",
      };
      const controls = new Map(Object.entries(fieldValues).map(([name, value]) => [name, { name, value, disabled: false }]));
      const row = { hidden: !expanded, previousElementSibling: { querySelector: () => ({ setAttribute: vi.fn() }) } };
      const details = { open: expanded };
      const dataset: Record<string, string> = { memoryId: id, view, ...(dirty ? { dirty: "true" } : {}) };
      return {
        dataset,
        controls, elements: Object.assign([...controls.values()], { namedItem: (name: string) => controls.get(name) }),
        closest: (selector: string) => selector === "tr" ? (view === "memories-content" ? row : null) : details,
        querySelectorAll: () => [...controls.values()],
      };
    }
    const saving = form("saved", "memories-content", "Saved edit", true);
    const other = form("other", "memories-content", "Unsaved other edit", true);
    const stale = form("saved", "stale-content", "Unsaved stale edit", true);
    const savedAfter = form("saved", "memories-content", "Saved edit", false, false);
    const otherAfter = form("other", "memories-content", "Old other content", false, false);
    const staleAfter = form("saved", "stale-content", "Old stale content", false, false);
    function target(oldForms: typeof saving[], newForms: typeof saving[]) {
      let forms = oldForms;
      return {
        querySelectorAll: (selector: string) => selector.includes("data-dirty") ? forms.filter(item => item.dataset.dirty === "true") : forms,
        set innerHTML(_value: string) { forms = newForms; },
      };
    }
    context.memoryTarget = target([saving, other], [savedAfter, otherAfter]);
    context.staleTarget = target([stale], [staleAfter]);
    context.form = saving;
    context.crossTabForm = stale;
    class FormData {
      private readonly fields: Map<string, string>;
      constructor(source: typeof saving) {
        this.fields = new Map([...source.controls].filter(([, control]) => !control.disabled).map(([name, control]) => [name, control.value]));
      }
      get(name: string) { return this.fields.get(name); }
      entries() { return this.fields.entries(); }
    }
    context.FormData = FormData;
    context.showToast = vi.fn();
    context.window = { confirm: () => true };
    context.supersede = supersede;
    context.loadMemories = () => runInContext("renderMemoryList(memoryTarget, '')", context);
    context.loadStaleMemories = () => runInContext("renderMemoryList(staleTarget, '')", context);
    context.apiRequest = vi.fn(async () => {
      expect([...new FormData(saving).entries()]).toEqual([]);
      await runInContext("mutateMemory(crossTabForm, false)", context);
      await runInContext("mutateMemory(crossTabForm, true)", context);
      expect(context.apiRequest).toHaveBeenCalledTimes(1);
      await context.loadMemories();
      await context.loadStaleMemories();
      expect(savedAfter.querySelectorAll().every(control => control.disabled)).toBe(true);
      expect(savedAfter.controls.get("content")?.value).toBe("Saved edit");
      context.rebuiltForm = savedAfter;
      await runInContext("mutateMemory(rebuiltForm, false)", context);
      if (outcome === "failed") throw new Error("Request failed");
      if (outcome === "rejected") return { kind: "rejected", message: "Publication rejected" };
      if (outcome === "retry_deferred") return { kind: "retry_deferred", nextAttemptAt: "2026-10-17T16:00:00Z" };
      return entry();
    });
    await runInContext("mutateMemory(form, supersede)", context);
    expect(otherAfter.controls.get("content")?.value).toBe("Unsaved other edit");
    expect(staleAfter.controls.get("content")?.value).toBe("Unsaved stale edit");
    expect(otherAfter.controls.get("reason")?.value).toBe("Unsaved reason");
    expect(otherAfter.controls.get("replacementId")?.value).toBe("replacement");
    expect(otherAfter.dataset.dirty).toBe("true");
    expect(staleAfter.dataset.dirty).toBe("true");
    expect(otherAfter.closest("tr")).toMatchObject({ hidden: false });
    expect(staleAfter.closest("details")).toMatchObject({ open: true });
    expect(savedAfter.dataset.dirty).toBe(outcome === "success" ? undefined : "true");
    expect(context.apiRequest).toHaveBeenCalledTimes(1);
    expect(context.showToast).toHaveBeenCalledWith(expect.stringContaining("This memory already has a pending request"), "error");
    expect(savedAfter.querySelectorAll().every(control => !control.disabled)).toBe(true);
    expect(saving.querySelectorAll().every(control => !control.disabled)).toBe(true);
  });

  it("renders native expansion buttons and keeps visibility and expanded state in sync", async () => {
    const { context, getElementById } = await setupUi();
    const rendered = getElementById("memories-content").innerHTML;
    expect(rendered).toMatch(/<button type="button"[^>]*aria-expanded="false"[^>]*aria-controls="memory-editor-0"/);
    expect(rendered).toContain('aria-label="Review or edit memory: Use &quot;strict&quot; TypeScript settings."');
    expect(rendered).toContain('<tr id="memory-editor-0" hidden>');
    expect(rendered).toContain("Save changes");
    expect(rendered).toContain("Supersede memory");

    const attributes = new Map([["aria-controls", "memory-editor-0"], ["aria-expanded", "false"]]);
    context.button = {
      getAttribute: (name: string) => attributes.get(name),
      setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    };
    runInContext("toggleMemoryEditor(button)", context);
    expect(getElementById("memory-editor-0").hidden).toBe(false);
    expect(attributes.get("aria-expanded")).toBe("true");
    runInContext("toggleMemoryEditor(button)", context);
    expect(getElementById("memory-editor-0").hidden).toBe(true);
    expect(attributes.get("aria-expanded")).toBe("false");
  });

  it.each([
    { kind: "retry_deferred", nextAttemptAt: "2026-10-17T16:00:00Z" },
    { kind: "rejected", message: "The memory cannot be published safely." },
  ])("preserves unsaved form fields when publication is $kind", async (result) => {
    const { context } = await setupUi();
    const fields = { content: "Unsaved edits", type: "coding_rule", scope: "frontend", tags: "new" };
    const buttons = [{ disabled: false }, { disabled: false }];
    context.form = { dataset: { memoryId: "memory" }, querySelectorAll: () => buttons };
    context.FormData = class {
      get(name: keyof typeof fields) { return fields[name]; }
    };
    context.apiRequest = vi.fn().mockResolvedValue(result);
    const loadMemories = vi.fn();
    const loadStaleMemories = vi.fn();
    const showToast = vi.fn();
    context.loadMemories = loadMemories;
    context.loadStaleMemories = loadStaleMemories;
    context.showToast = showToast;
    await runInContext("mutateMemory(form, false)", context);
    expect(loadMemories).not.toHaveBeenCalled();
    expect(loadStaleMemories).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("These changes were not saved"), "error");
    expect(fields.content).toBe("Unsaved edits");
    expect(buttons.every(button => !button.disabled)).toBe(true);
  });
});
