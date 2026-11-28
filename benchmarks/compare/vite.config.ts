import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const source = (file: string) =>
  fileURLToPath(new URL(`../../src/${file}`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  resolve: {
    alias: {
      "nexus-dom/jsx-runtime": source("jsx-runtime.ts"),
      "nexus-dom/core": source("core.ts"),
      "nexus-dom": source("index.ts"),
    },
    conditions: ["browser", "production"],
  },
  build: {
    minify: true,
  },
});
