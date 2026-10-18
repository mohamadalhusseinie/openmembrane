import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/capture.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  splitting: false,
  noExternal: [/^@openmembrane\//],
});
