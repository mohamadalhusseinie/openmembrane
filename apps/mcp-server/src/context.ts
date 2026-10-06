import { resolve } from "node:path";
import { cwd } from "node:process";
import { createOpenMembraneService } from "@openmembrane/service";
import type { CommandRunner, ProjectRef, ProjectService, ProjectState } from "@openmembrane/service";

export interface OpenMembraneMcpContext extends ProjectState {
  service: ReturnType<typeof createOpenMembraneService>;
  projectRef: ProjectRef;
  close: () => Promise<void>;
}

interface CreateOpenMembraneContextOptions {
  defaultProjectId?: string;
  projectRoot?: string;
  storageDir?: string;
  githubRunner?: CommandRunner;
}

export async function createOpenMembraneContext(
  options: CreateOpenMembraneContextOptions = {},
): Promise<OpenMembraneMcpContext> {
  const service = createOpenMembraneService(
    options.githubRunner ? { githubRunner: options.githubRunner } : {},
  );
  const projectRef: ProjectRef = {
    projectRoot: resolve(options.projectRoot ?? cwd()),
    ...(options.defaultProjectId ? { projectId: options.defaultProjectId } : {}),
    ...(options.storageDir ? { storageDir: options.storageDir } : {}),
  };
  try {
    const state = await service.projectState(projectRef);
    return { ...state, service, projectRef, close: () => service.close() };
  } catch (error) {
    await service.close();
    throw error;
  }
}

export function resolveProjectId(context: Pick<OpenMembraneMcpContext, "defaultProjectId">, projectId?: string): string {
  return projectId?.trim() || context.defaultProjectId;
}

export function projectService(context: OpenMembraneMcpContext, projectId?: string): Promise<ProjectService> {
  return context.service.forProject({ ...context.projectRef, projectId: resolveProjectId(context, projectId) });
}
