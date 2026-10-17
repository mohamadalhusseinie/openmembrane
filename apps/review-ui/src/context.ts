import { cwd } from "node:process";
import { basename, resolve } from "node:path";
import { OpenMembraneClient } from "@openmembrane/client";
import type { OpenMembraneClientOptions } from "@openmembrane/client";

export interface ReviewUiContext {
  projectId: string;
  storageDir: string;
  project: OpenMembraneClient;
  close: () => Promise<void>;
}

export interface ReviewUiOptions {
  port?: number;
  open?: boolean;
  home?: string;
  project?: string;
  clientOptions?: OpenMembraneClientOptions;
}

export async function createReviewUiContext(options: ReviewUiOptions = {}): Promise<ReviewUiContext> {
  const projectRoot = options.clientOptions?.projectRoot ?? cwd();
  const env = { ...(options.clientOptions?.env ?? process.env) };
  if (options.project !== undefined) env.OPENMEMBRANE_PROJECT_ID = options.project;
  if (options.home !== undefined) env.OPENMEMBRANE_HOME = options.home;
  return {
    projectId: env.OPENMEMBRANE_PROJECT_ID ?? basename(projectRoot),
    storageDir: resolve(projectRoot, env.OPENMEMBRANE_HOME ?? ".openmembrane"),
    project: new OpenMembraneClient({ ...options.clientOptions, projectRoot, env }),
    close: async () => {},
  };
}
