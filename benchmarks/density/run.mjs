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
if (!executablePath) throw new Error("Chrome or Chromium was not found.");

const densities = [1, 2, 4, 8, 16];
const strategies = ["fine", "view"];
const modes = ["one", "all"];
const components = Number(process.env.NEXUS_DOM_DENSITY_COMPONENTS ?? 500);
const iterations = Number(process.env.NEXUS_DOM_DENSITY_ITERATIONS ?? 100);
const server = await createServer({ configFile, logLevel: "error" });
let browser;

try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  if (process.argv.includes("--selector-selection")) {
    const results = [];
    for (const size of [1_000, 10_000]) {
      for (const strategy of ["namespace", "field"]) {
        const result = await page.evaluate(
          ({ strategy, size }) => window.runSelectorSelectionCase(strategy, size),
          { strategy, size }
        );
        results.push({ rows: size, strategy, ...result, median_ms: result.median_ms.toFixed(3) });
      }
    }
    console.table(results);
  } else {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const heap = async () => {
      await cdp.send("HeapProfiler.collectGarbage");
      const { metrics } = await cdp.send("Performance.getMetrics");
      return metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0;
    };
    const rows = [];
    for (const density of densities) {
      for (const strategy of strategies) {
        await page.evaluate(() => window.disposeDensityFixture());
        const baseline = await heap();
        await page.evaluate(
          ({ strategy, density, components }) =>
            window.mountDensityFixture(strategy, density, components),
          { strategy, density, components }
        );
        const mounted = await heap();
        for (const mode of modes) {
          const medianMs = await page.evaluate(
            ({ strategy, density, components, iterations, mode }) =>
              window.runDensityCase(strategy, density, components, iterations, mode),
            { strategy, density, components, iterations, mode }
          );
          rows.push({
            fields: density,
            strategy,
            update: mode,
            median_ms: medianMs.toFixed(3),
            heap_bytes_per_component: Math.round((mounted - baseline) / components),
          });
        }
      }
    }
    console.log(`Components: ${components}; iterations: ${iterations}`);
    console.table(rows);
  }
} finally {
  await browser?.close();
  await server.close();
}
