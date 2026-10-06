import { tokenize } from "@openmembrane/core";
import type { MemoryEntry, MemorySearchOptions } from "@openmembrane/core";

export function searchEntries(
  entries: readonly MemoryEntry[],
  query: string,
  options: MemorySearchOptions,
): MemoryEntry[] {
  const queryTokens = tokenize(query);
  return entries.filter((memory) => {
    if (options.scopes !== undefined && !options.scopes.includes(memory.scope)) return false;
    if (options.types !== undefined && !options.types.includes(memory.type)) return false;
    if (options.tags !== undefined && !options.tags.some((tag) => memory.tags.includes(tag))) return false;
    if (queryTokens.length === 0) return true;
    const haystack = tokenize([memory.content, memory.type, memory.scope, ...memory.tags].join(" "));
    return queryTokens.some((token) => haystack.includes(token));
  });
}
