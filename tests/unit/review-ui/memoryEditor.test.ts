import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { entry } from "../helpers";

describe("review UI memory editor", () => {
  it("renders native expansion buttons and keeps visibility and expanded state in sync", async () => {
    const html = await readFile(resolve("apps", "review-ui", "public", "index.html"), "utf8");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
    if (script === undefined) throw new Error("Expected the review UI script.");
    const elements = new Map<string, {
      value: string; options: Array<{ value: string; text: string }>; innerHTML: string; hidden: boolean;
    }>();
    for (const id of ["mem-search", "mem-type", "mem-scope", "memories-content", "memory-editor-0"]) {
      elements.set(id, { value: "", options: [], innerHTML: "", hidden: true });
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
});
