import { cwd } from "node:process";
import { createOpenMembraneService } from "@openmembrane/service";
import type { ProjectService } from "@openmembrane/service";

export interface ReviewUiContext {
  projectId: string;
  storageDir: string;
  project: ProjectService;
  close: () => Promise<void>;
}

export interface ReviewUiOptions {
  port?: number;
  open?: boolean;
  home?: string;
  project?: string;
}

export async function createReviewUiContext(options: ReviewUiOptions = {}): Promise<ReviewUiContext> {
  const service = createOpenMembraneService({ deferExtractionInitialization: true });
  try {
    const project = await service.forProject({
      projectRoot: cwd(),
      ...(options.project !== undefined ? { projectId: options.project } : {}),
      ...(options.home !== undefined ? { storageDir: options.home } : {}),
    });
    return { projectId: project.projectId, storageDir: project.storageDir, project, close: () => service.close() };
  } catch (error) {
    await service.close();
    throw error;
  }
}
