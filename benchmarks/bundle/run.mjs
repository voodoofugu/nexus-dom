import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { rollup } from "rollup";
import { createPlugins, external } from "../../rollup.config.mjs";

const outputRoot = fileURLToPath(
  new URL("../../benchmark-dist/bundle/", import.meta.url)
);
const entries = ["core", "app", "full"];
const results = [];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const name of entries) {
  const outDir = `${outputRoot}${name}`;
  const bundle = await rollup({
    input: fileURLToPath(new URL(`./${name}.ts`, import.meta.url)),
    plugins: createPlugins(),
    external,
  });
  await bundle.write({
    file: `${outDir}/${name}.js`,
    format: "esm",
    generatedCode: "es2015",
  });
  await bundle.close();

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
