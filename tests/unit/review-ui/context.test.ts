import { afterEach, describe, expect, it, vi } from "vitest";
import { cwd } from "node:process";
import { createOpenMembraneService } from "@openmembrane/service";
import type { OpenMembraneService } from "@openmembrane/service";
import { createReviewUiContext } from "../../../apps/review-ui/src/context";

vi.mock("@openmembrane/service", () => ({ createOpenMembraneService: vi.fn() }));

describe("review UI context", () => {
  afterEach(() => vi.resetAllMocks());

  it("resolves a project through the service and closes the root service", async () => {
    const project = { projectId: "custom", storageDir: "custom-home" };
    const forProject = vi.fn().mockResolvedValue(project);
    const close = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createOpenMembraneService).mockReturnValue({ forProject, close } as unknown as OpenMembraneService);

    const context = await createReviewUiContext({ home: "custom-home", project: "custom" });
    expect(forProject).toHaveBeenCalledWith({ projectRoot: cwd(), projectId: "custom", storageDir: "custom-home" });
    expect(context).toMatchObject({ project, projectId: "custom", storageDir: "custom-home" });
    await context.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the root service if project initialization fails", async () => {
    const forProject = vi.fn().mockRejectedValue(new Error("initialization failed"));
    const close = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createOpenMembraneService).mockReturnValue({ forProject, close } as unknown as OpenMembraneService);

    await expect(createReviewUiContext()).rejects.toThrow("initialization failed");
    expect(forProject).toHaveBeenCalledWith({ projectRoot: cwd() });
    expect(close).toHaveBeenCalledOnce();
  });
});
