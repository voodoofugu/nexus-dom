import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const source = (file: string) =>
  fileURLToPath(new URL(`../src/${file}`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  resolve: {
    alias: {
      "nexus-dom/jsx-dev-runtime": source("jsx-dev-runtime.ts"),
      "nexus-dom/jsx-runtime": source("jsx-runtime.ts"),
      "nexus-dom/server": source("server.ts"),
      "nexus-dom": source("index.ts"),
    },
  },
  server: {
    fs: {
      allow: [
        projectRoot,
        fileURLToPath(new URL("../../nexus-state", import.meta.url)),
      ],
    },
  },
  build: {
    outDir: fileURLToPath(new URL("../example-dist", import.meta.url)),
    emptyOutDir: true,
  },
});
