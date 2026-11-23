import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { rollup } from "rollup";
import { createPlugins, external } from "../../rollup.config.mjs";

const outputRoot = fileURLToPath(
  new URL("../../benchmark-dist/bundle/", import.meta.url)
);
const entries = [
  { entry: "core", external: true },
  { entry: "app", external: true },
  { entry: "full", external: true },
  { entry: "full", external: false, label: "full + nexus-state" },
  { entry: "server", external: true },
  { entry: "server", external: false, label: "server + nexus-state" },
];
const results = [];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const scenario of entries) {
  const name = scenario.entry;
  const label = scenario.label ?? name;
  const outDir = `${outputRoot}${label.replaceAll(/[^a-z0-9]+/gi, "-")}`;
  const bundle = await rollup({
    input: fileURLToPath(new URL(`./${name}.ts`, import.meta.url)),
    plugins: createPlugins(),
    external: scenario.external ? external : undefined,
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
    entry: label,
    bytes,
    gzip_bytes: gzipBytes,
    gzip_kb: (gzipBytes / 1024).toFixed(2),
  });
}

console.table(results);
