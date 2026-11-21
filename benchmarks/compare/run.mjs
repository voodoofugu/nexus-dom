import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { build, preview } from "vite";

const configFile = fileURLToPath(new URL("./vite.config.ts", import.meta.url));
const knownBrowsers = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const executablePath = knownBrowsers.find((path) => existsSync(path));

if (!executablePath) {
  throw new Error(
    "Chrome or Chromium was not found. Set CHROME_PATH to its executable."
  );
}

const outputDirectory = await mkdtemp(join(tmpdir(), "nexus-dom-compare-"));
let server;
let browser;

try {
  await build({ configFile, logLevel: "error", build: { outDir: outputDirectory } });
  server = await preview({
    configFile,
    logLevel: "error",
    build: { outDir: outputDirectory },
    preview: { port: 0 },
  });
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite did not expose a comparison URL.");

  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  page.on("console", (message) => console.error(`[browser] ${message.text()}`));
  page.on("pageerror", (error) => console.error(`[browser] ${error.message}`));
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  const report = await page.evaluate(() => window.runRendererComparison());

  console.log(`Browser: ${report.userAgent}`);
  console.log(`Rows: ${report.rows}`);
  console.table(
    report.measurements.map((measurement) => ({
      framework: measurement.framework,
      scenario: measurement.scenario,
      iterations: measurement.iterations,
      median_ms: measurement.medianMs.toFixed(3),
      p95_ms: measurement.p95Ms.toFixed(3),
    }))
  );
  console.log("Mount diagnostics:");
  console.table(
    report.mountDiagnostics.map((measurement) => ({
      variant: measurement.scenario,
      iterations: measurement.iterations,
      median_ms: measurement.medianMs.toFixed(3),
      p95_ms: measurement.p95Ms.toFixed(3),
    }))
  );
} finally {
  await browser?.close();
  server?.httpServer.close();
  await rm(outputDirectory, { recursive: true, force: true });
}
