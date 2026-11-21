import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { build, preview } from "vite";

const configFile = fileURLToPath(
  new URL("../compare/vite.config.ts", import.meta.url)
);
const knownBrowsers = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const executablePath = knownBrowsers.find((path) => existsSync(path));

if (!executablePath) {
  throw new Error("Chrome or Chromium was not found. Set CHROME_PATH to its executable.");
}

const count = Number(process.env.NEXUS_DOM_HEAP_ROWS ?? 10_000);
const samplingInterval = Number(process.env.NEXUS_DOM_HEAP_INTERVAL ?? 512);
if (!Number.isInteger(count) || count < 1) {
  throw new Error("NEXUS_DOM_HEAP_ROWS must be a positive integer.");
}
if (!Number.isInteger(samplingInterval) || samplingInterval < 1) {
  throw new Error("NEXUS_DOM_HEAP_INTERVAL must be a positive integer.");
}

const variants = [
  "static JSX",
  "keyed static fields",
  "reactive keyed (1 field)",
  "reactive keyed (2 fields)",
];
const outputDirectory = await mkdtemp(join(tmpdir(), "nexus-dom-heap-"));
let server;
let browser;

const aggregateProfile = (profile) => {
  const allocations = new Map();
  const visit = (node) => {
    if (node.selfSize > 0) {
      const frame = node.callFrame;
      const source = frame.url
        ? `${frame.url.split("/").at(-1)}:${frame.lineNumber + 1}`
        : "native";
      const name = frame.functionName || "(anonymous)";
      const key = `${name} (${source})`;
      allocations.set(key, (allocations.get(key) ?? 0) + node.selfSize);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(profile.head);
  return [...allocations]
    .map(([allocation, bytes]) => ({
      allocation,
      kib: (bytes / 1024).toFixed(1),
      bytes_per_row: (bytes / count).toFixed(1),
    }))
    .sort((left, right) => Number(right.kib) - Number(left.kib))
    .slice(0, 20);
};

try {
  await build({
    configFile,
    logLevel: "error",
    build: { outDir: outputDirectory, minify: false, sourcemap: true },
  });
  server = await preview({
    configFile,
    logLevel: "error",
    build: { outDir: outputDirectory },
    preview: { port: 0 },
  });
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite did not expose a heap benchmark URL.");

  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  const cdp = await page.context().newCDPSession(page);

  for (const variant of variants) {
    await page.evaluate(() => window.disposeMemoryFixture());
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.startSampling", { samplingInterval });
    await page.evaluate(
      ({ variant, count }) => window.mountMemoryFixture(variant, count),
      { variant, count }
    );
    await cdp.send("HeapProfiler.collectGarbage");
    const { profile } = await cdp.send("HeapProfiler.stopSampling");
    console.log(`\n${variant}, ${count.toLocaleString()} rows:`);
    console.table(aggregateProfile(profile));
  }
} finally {
  await browser?.close();
  server?.httpServer.close();
  await rm(outputDirectory, { recursive: true, force: true });
}
