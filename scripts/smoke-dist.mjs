import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const require = createRequire(import.meta.url);

const esm = await import(pathToFileURL(path.join(root, "dist/esm/index.js")).href);
const esmRuntime = await import(
  pathToFileURL(path.join(root, "dist/esm/jsx-runtime.js")).href
);
const esmDevRuntime = await import(
  pathToFileURL(path.join(root, "dist/esm/jsx-dev-runtime.js")).href
);
const esmServer = await import(
  pathToFileURL(path.join(root, "dist/esm/server.js")).href
);
const cjs = require(path.join(root, "dist/cjs/index.js"));
const cjsRuntime = require(path.join(root, "dist/cjs/jsx-runtime.js"));
const cjsDevRuntime = require(path.join(root, "dist/cjs/jsx-dev-runtime.js"));
const cjsServer = require(path.join(root, "dist/cjs/server.js"));

for (const [name, entry] of [
  ["esm", esm],
  ["cjs", cjs],
]) {
  for (const exported of [
    "createApp",
    "createDOMRenderer",
    "bind",
    "hydrate",
    "render",
  ]) {
    if (typeof entry[exported] !== "function") {
      throw new Error(`${name}: missing function export ${exported}`);
    }
  }
}

for (const [name, server] of [
  ["esm server", esmServer],
  ["cjs server", cjsServer],
]) {
  if (typeof server.renderToString !== "function") {
    throw new Error(`${name}: missing renderToString export`);
  }
}

for (const [name, runtime] of [
  ["esm jsx-runtime", esmRuntime],
  ["esm jsx-dev-runtime", esmDevRuntime],
  ["cjs jsx-runtime", cjsRuntime],
  ["cjs jsx-dev-runtime", cjsDevRuntime],
]) {
  const jsx = runtime.jsx ?? runtime.jsxDEV;
  if (typeof jsx !== "function" || typeof runtime.Fragment === "undefined") {
    throw new Error(`${name}: invalid JSX runtime exports`);
  }
}

console.log("smoke: ESM, CJS and JSX runtime entries loaded successfully");
