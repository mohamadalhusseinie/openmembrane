import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@openmembrain/core": fromRoot("./packages/core/src/index.ts"),
      "@openmembrain/exporters": fromRoot("./packages/exporters/src/index.ts"),
      "@openmembrain/shared": fromRoot("./packages/shared/src/index.ts"),
      "@openmembrain/storage": fromRoot("./packages/storage/src/index.ts"),
      "@openmembrain/extractor-llm": fromRoot("./packages/extractor-llm/src/index.ts")
    }
  },
  test: {
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts"]
  }
});
