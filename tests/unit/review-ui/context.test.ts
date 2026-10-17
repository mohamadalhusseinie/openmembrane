import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { OpenMembraneClient } from "@openmembrane/client";
import { createReviewUiContext } from "../../../apps/review-ui/src/context";

describe("review UI context", () => {
  it("creates a client with caller project and storage overrides without opening stores", async () => {
    const context = await createReviewUiContext({ home: "custom-home", project: "custom" });
    expect(context.project).toBeInstanceOf(OpenMembraneClient);
    expect(context).toMatchObject({ projectId: "custom", storageDir: resolve("custom-home") });
    await context.close();
  });

  it("uses the client project root and environment when embedded", async () => {
    const root = resolve("client-project");
    const context = await createReviewUiContext({
      clientOptions: { projectRoot: root, env: { OPENMEMBRANE_PROJECT_ID: "embedded", OPENMEMBRANE_HOME: "storage" } },
    });
    expect(context).toMatchObject({ projectId: "embedded", storageDir: resolve(root, "storage") });
  });
});
