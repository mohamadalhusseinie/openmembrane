import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as createNodeRequire } from "node:module";\nconst require = createNodeRequire(import.meta.url);',
  },
  external: ["better-sqlite3"],
  noExternal: [/^@openmembrane\//],
});
