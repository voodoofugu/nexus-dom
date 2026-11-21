import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const source = (file: string) =>
  fileURLToPath(new URL(`./src/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "nexus-dom/jsx-dev-runtime": source("jsx-dev-runtime.ts"),
      "nexus-dom/jsx-runtime": source("jsx-runtime.ts"),
      "nexus-dom": source("index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
