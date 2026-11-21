import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const dist = path.join(process.cwd(), "dist");

await mkdir(path.join(dist, "esm"), { recursive: true });
await mkdir(path.join(dist, "cjs"), { recursive: true });

await writeFile(
  path.join(dist, "esm", "package.json"),
  `${JSON.stringify({ type: "module" }, null, 2)}\n`
);
await writeFile(
  path.join(dist, "cjs", "package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`
);
