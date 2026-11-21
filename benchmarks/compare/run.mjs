import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright-core";
import { build, preview } from "vite";

const configFile = fileURLToPath(new URL("./vite.config.ts", import.meta.url));
const browserName = process.env.NEXUS_DOM_BROWSER ?? "chromium";
const cpuThrottle = Number(process.env.NEXUS_DOM_CPU_THROTTLE ?? 1);
const skipMemory = process.env.NEXUS_DOM_SKIP_MEMORY === "1";
const browserTypes = { chromium, firefox, webkit };
const browserType = browserTypes[browserName];
if (!browserType) {
  throw new Error(
    `Unknown NEXUS_DOM_BROWSER "${browserName}". Use chromium, firefox or webkit.`
  );
}
if (!Number.isFinite(cpuThrottle) || cpuThrottle < 1) {
  throw new Error("NEXUS_DOM_CPU_THROTTLE must be a number greater than or equal to 1.");
}
if (cpuThrottle !== 1 && browserName !== "chromium") {
  throw new Error("CPU throttling is only available for Chromium benchmarks.");
}

const knownChromiumBrowsers = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const executablePath = knownChromiumBrowsers.find((path) => existsSync(path));

if (browserName === "chromium" && !executablePath) {
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

  browser = await browserType.launch({
    ...(browserName === "chromium" ? { executablePath } : {}),
    headless: true,
  });
  const configurePage = async (page) => {
    if (cpuThrottle === 1) return;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
  };
  const frameworkNames = ["nexus-dom", "React", "Solid", "Preact Signals"];
  const coldSamples = new Map(frameworkNames.map((name) => [name, []]));
  for (let round = 0; round < 8; round++) {
    const offset = round % frameworkNames.length;
    const order = [
      ...frameworkNames.slice(offset),
      ...frameworkNames.slice(0, offset),
    ];
    if (round >= frameworkNames.length) order.reverse();
    for (const frameworkName of order) {
      const coldPage = await browser.newPage();
      await configurePage(coldPage);
      await coldPage.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      const duration = await coldPage.evaluate(
        (name) => window.runFirstMount(name),
        frameworkName
      );
      coldSamples.get(frameworkName).push(duration);
      await coldPage.close();
    }
  }

  const summarize = (samples) => {
    const sorted = [...samples].sort((left, right) => left - right);
    return {
      median: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
      p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
    };
  };

  console.log("Fresh-page first mount:");
  console.table(
    frameworkNames.map((frameworkName) => {
      const result = summarize(coldSamples.get(frameworkName));
      return {
        framework: frameworkName,
        samples: coldSamples.get(frameworkName).length,
        median_ms: result.median.toFixed(3),
        p95_ms: result.p95.toFixed(3),
      };
    })
  );

  const page = await browser.newPage();
  await configurePage(page);
  page.on("console", (message) => console.error(`[browser] ${message.text()}`));
  page.on("pageerror", (error) => console.error(`[browser] ${error.message}`));
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  const report = await page.evaluate(() => window.runRendererComparison());

  console.log(`Browser: ${report.userAgent}`);
  console.log(`CPU throttle: ${cpuThrottle}x`);
  console.log(`Rows: ${report.rows}`);
  console.log(`ParentNode.moveBefore: ${report.supportsMoveBefore ? "yes" : "no"}`);
  console.table(report.correctness);
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

  if (browserName === "chromium" && !skipMemory) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const collectMemory = async () => {
      await cdp.send("HeapProfiler.collectGarbage");
      await cdp.send("HeapProfiler.collectGarbage");
      const [metrics, dom] = await Promise.all([
        cdp.send("Performance.getMetrics"),
        cdp.send("Memory.getDOMCounters"),
      ]);
      return {
        heap:
          metrics.metrics.find((metric) => metric.name === "JSHeapUsedSize")
            ?.value ?? 0,
        nodes: dom.nodes,
        listeners: dom.jsEventListeners,
      };
    };
    const memoryResults = [];
    for (const count of [1_000, 10_000]) {
      for (const variant of [
        "direct DOM",
        "static JSX",
        "keyed static fields",
        "reactive keyed (1 field)",
        "reactive keyed (2 fields)",
        "React",
        "Solid",
        "Preact Signals",
      ]) {
        await page.evaluate(() => window.disposeMemoryFixture());
        const before = await collectMemory();
        await page.evaluate(
          ({ variant, count }) => window.mountMemoryFixture(variant, count),
          { variant, count }
        );
        const mounted = await collectMemory();
        await page.evaluate(() => window.disposeMemoryFixture());
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            )
        );
        const disposed = await collectMemory();
        memoryResults.push({
          variant,
          rows: count,
          mounted_kib: ((mounted.heap - before.heap) / 1024).toFixed(1),
          bytes_per_row: ((mounted.heap - before.heap) / count).toFixed(1),
          retained_kib: ((disposed.heap - before.heap) / 1024).toFixed(1),
          dom_nodes: mounted.nodes - before.nodes,
          listeners: mounted.listeners - before.listeners,
        });
      }
    }
    console.log("Heap diagnostics after forced GC:");
    console.table(memoryResults);
  } else if (skipMemory) {
    console.log("Heap diagnostics: skipped by NEXUS_DOM_SKIP_MEMORY.");
  } else {
    console.log("Heap diagnostics: skipped (requires Chromium CDP).");
  }
} finally {
  await browser?.close();
  server?.httpServer.close();
  await rm(outputDirectory, { recursive: true, force: true });
}
