import type { ClientRequest } from "@openmembrane/client";
import type { OpenMembraneMcpContext } from "../context";

export function createToolHandlers({ client }: OpenMembraneMcpContext) {
  return {
    remember: (input: ClientRequest<"remember">) => client.remember(input),
    getProjectRules: (input: ClientRequest<"getProjectRules">) => client.getProjectRules(input),
    getRelevantContext: (input: ClientRequest<"getRelevantContext">) => client.getRelevantContext(input),
    searchMemory: (input: ClientRequest<"searchMemory">) => client.searchMemory(input),
    listMemoryCandidates: (input: ClientRequest<"listMemoryCandidates">) => client.listMemoryCandidates(input),
    approveMemoryCandidate: (input: ClientRequest<"approveMemoryCandidate">) => client.approveMemoryCandidate(input),
    rejectMemoryCandidate: (input: ClientRequest<"rejectMemoryCandidate">) => client.rejectMemoryCandidate(input),
  };
}
