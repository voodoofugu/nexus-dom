import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = await mkdtemp(join(tmpdir(), "nexus-dom-package-"));
const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
const source = `
import { component, store } from "nexus-dom";
import { jsx } from "nexus-dom/jsx-runtime";
import { jsxDEV } from "nexus-dom/jsx-dev-runtime";
import { renderToString } from "nexus-dom/server";

const message = store({ state: { text: "ready" } });
const Title = component(({ state }) => jsx("p", { children: state.message.text }), { message });
const html = renderToString(jsxDEV(Title, {}));
if (html !== "<p>ready</p>") throw new Error("Unexpected SSR output: " + html);
`;

try {
  const packed = execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", directory], {
    encoding: "utf8",
  });
  const [{ filename }] = JSON.parse(packed);
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(directory, filename)], {
    cwd: directory,
    stdio: "inherit",
  });
  for (const [input, output, module] of [
    ["consumer.mts", "consumer.mjs", "NodeNext"],
    ["consumer.cts", "consumer.cjs", "Node16"],
  ]) {
    await writeFile(join(directory, input), source);
    execFileSync(process.execPath, [tsc, "--strict", "--target", "ES2022", "--module", module, input], {
      cwd: directory,
      stdio: "inherit",
    });
    execFileSync(process.execPath, [output], { cwd: directory, stdio: "inherit" });
  }
  console.log("smoke: packed ESM and CommonJS consumers compiled and rendered");
} finally {
  await rm(directory, { recursive: true, force: true });
}
