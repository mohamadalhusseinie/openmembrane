import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { extension: "src/extension.ts" },
    format: ["cjs"],
    outExtension: () => ({ js: ".cjs" }),
    target: "node22",
    external: ["vscode"],
    noExternal: [/^@openmembrane\//, /^zod(?:\/|$)/],
  },
  {
    entry: { cli: "../../apps/mcp-server/src/index.ts" },
    format: ["esm"],
    outExtension: () => ({ js: ".mjs" }),
    target: "node22",
    external: ["better-sqlite3"],
    noExternal: [/^(?!better-sqlite3(?:\/|$))/],
    banner: {
      js: 'import { createRequire as createNodeRequire } from "node:module";\nconst require = createNodeRequire(import.meta.url);',
    },
  },
]);
