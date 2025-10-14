import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  splitting: false,
  sourcemap: true,
  clean: true,
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  minify: false,
});
