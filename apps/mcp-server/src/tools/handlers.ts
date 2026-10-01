import type { OpenMembraneMcpContext } from "../context";
import { projectService } from "../context";
import type {
  ApproveAllCandidatesInput, ApproveMemoryCandidateInput, ConfigureGitHubTeamModeInput,
  ExportStaticMemoryFilesInput, GetCollaborationStatusInput, GetDiagnosticsInput,
  GetProjectRulesInput, GetRelevantContextInput, ListAuditLogInput,
  ListMemoryCandidatesInput, ProposeMemoryInput, RejectAllCandidatesInput,
  RejectMemoryCandidateInput, RememberInput, ReviewStaleMemoriesInput,
  SearchMemoryInput, SupersedeMemoryInput, UpdateMemoryInput,
} from "@openmembrane/service";

export type {
  ApproveAllCandidatesInput, ApproveMemoryCandidateInput, ConfigureGitHubTeamModeInput,
  ExportStaticMemoryFilesInput, GetCollaborationStatusInput, GetDiagnosticsInput,
  GetProjectRulesInput, GetRelevantContextInput, ListAuditLogInput,
  ListMemoryCandidatesInput, ProposeMemoryInput, RejectAllCandidatesInput,
  RejectMemoryCandidateInput, RememberInput, ReviewStaleMemoriesInput,
  SearchMemoryInput, SupersedeMemoryInput, UpdateMemoryInput,
} from "@openmembrane/service";

export function createToolHandlers(context: OpenMembraneMcpContext) {
  return {
    proposeMemoryFromSession: async (input: ProposeMemoryInput) => (await projectService(context, input.projectId)).proposeMemoryFromSession(input),
    getProjectRules: async (input: GetProjectRulesInput) => (await projectService(context, input.projectId)).getProjectRules(input),
    getRelevantContext: async (input: GetRelevantContextInput) => (await projectService(context, input.projectId)).getRelevantContext(input),
    searchMemory: async (input: SearchMemoryInput) => (await projectService(context, input.projectId)).searchMemory(input),
    configureGitHubTeamMode: async (input: ConfigureGitHubTeamModeInput) => (await projectService(context, input.projectId)).configureGitHubTeamMode(input),
    getCollaborationStatus: async (input: GetCollaborationStatusInput) => (await projectService(context, input.projectId)).getCollaborationStatus(input),
    listMemoryCandidates: async (input: ListMemoryCandidatesInput) => (await projectService(context, input.projectId)).listMemoryCandidates(input),
    approveMemoryCandidate: async (input: ApproveMemoryCandidateInput) => (await projectService(context, input.projectId)).approveMemoryCandidate(input),
    rejectMemoryCandidate: async (input: RejectMemoryCandidateInput) => (await projectService(context, input.projectId)).rejectMemoryCandidate(input),
    exportStaticMemoryFiles: async (input: ExportStaticMemoryFilesInput) => (await projectService(context, input.projectId)).exportStaticMemoryFiles(input),
    getDiagnostics: async (input: GetDiagnosticsInput) => (await projectService(context, input.projectId)).getDiagnostics(input),
    supersedeMemory: async (input: SupersedeMemoryInput) => (await projectService(context, input.projectId)).supersedeMemory(input),
    updateMemory: async (input: UpdateMemoryInput) => (await projectService(context, input.projectId)).updateMemory(input),
    listAuditLog: async (input: ListAuditLogInput) => (await projectService(context, input.projectId)).listAuditLog(input),
    approveAllCandidates: async (input: ApproveAllCandidatesInput) => (await projectService(context, input.projectId)).approveAllCandidates(input),
    rejectAllCandidates: async (input: RejectAllCandidatesInput) => (await projectService(context, input.projectId)).rejectAllCandidates(input),
    remember: async (input: RememberInput) => (await projectService(context, input.projectId)).remember(input),
    reviewStaleMemories: async (input: ReviewStaleMemoriesInput) => (await projectService(context, input.projectId)).reviewStaleMemories(input),
  };
}
