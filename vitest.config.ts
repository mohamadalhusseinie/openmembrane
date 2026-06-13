import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@openmembrane/core": fromRoot("./packages/core/src/index.ts"),
      "@openmembrane/exporters": fromRoot("./packages/exporters/src/index.ts"),
      "@openmembrane/shared": fromRoot("./packages/shared/src/index.ts"),
      "@openmembrane/storage": fromRoot("./packages/storage/src/index.ts"),
      "@openmembrane/extractor-llm": fromRoot("./packages/extractor-llm/src/index.ts")
    }
  },
  test: {
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts"]
  }
});
