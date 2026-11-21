import { readdir, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const outputRoot = fileURLToPath(
  new URL("../../benchmark-dist/bundle/", import.meta.url)
);
const entries = ["core", "app", "full"];
const results = [];

for (const name of entries) {
  const outDir = `${outputRoot}${name}`;
  await build({
    configFile: false,
    logLevel: "silent",
    root: projectRoot,
    build: {
      outDir,
      emptyOutDir: true,
      lib: {
        entry: fileURLToPath(new URL(`./${name}.ts`, import.meta.url)),
        formats: ["es"],
        fileName: () => `${name}.js`,
      },
      rollupOptions: {
        external: ["nexus-state"],
      },
    },
  });

  const files = (await readdir(outDir)).filter((file) => file.endsWith(".js"));
  const contents = await Promise.all(
    files.map((file) => readFile(`${outDir}/${file}`))
  );
  const bytes = contents.reduce((total, content) => total + content.byteLength, 0);
  const gzipBytes = contents.reduce(
    (total, content) => total + gzipSync(content).byteLength,
    0
  );
  results.push({
    entry: name,
    bytes,
    gzip_bytes: gzipBytes,
    gzip_kb: (gzipBytes / 1024).toFixed(2),
  });
}

console.table(results);
