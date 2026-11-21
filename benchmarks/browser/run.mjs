import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

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

const server = await createServer({ configFile, logLevel: "error" });
let browser;

try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite did not expose a local benchmark URL.");

  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  const report = await page.evaluate(() => window.runNexusDOMBenchmarks());

  console.log(`Browser: ${report.userAgent}`);
  console.log(`Rows: ${report.size}`);
  console.log(`Keyed-list comments: ${report.commentsInsideKeyedList}`);
  console.table(
    report.measurements.map((measurement) => ({
      scenario: measurement.name,
      iterations: measurement.iterations,
      mean_ms: measurement.meanMs.toFixed(3),
      median_ms: measurement.medianMs.toFixed(3),
      p95_ms: measurement.p95Ms.toFixed(3),
    }))
  );
} finally {
  await browser?.close();
  await server.close();
}
