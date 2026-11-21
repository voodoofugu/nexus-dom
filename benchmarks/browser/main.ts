import { createApp } from "nexus-dom";
import { jsx } from "nexus-dom/jsx-runtime";

interface Item {
  id: number;
  label: string;
}

interface Measurement {
  name: string;
  iterations: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
}

interface BenchmarkReport {
  userAgent: string;
  size: number;
  measurements: Measurement[];
  commentsInsideKeyedList: number;
}

declare global {
  interface Window {
    runNexusDOMBenchmarks(): Promise<BenchmarkReport>;
  }
}

const size = 1_000;
const initial = Array.from({ length: size }, (_, id) => ({
  id,
  label: `Row ${id}`,
}));

const fixtures = document.querySelector("#fixtures")!;
const output = document.querySelector("#results")!;
const runButton = document.querySelector<HTMLButtonElement>("#run")!;

const forceLayout = (host: HTMLElement) => {
  void host.offsetHeight;
};

function summarize(name: string, samples: number[]): Measurement {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (value: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] ?? 0;

  return {
    name,
    iterations: samples.length,
    meanMs: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
  };
}

function measure(
  name: string,
  iterations: number,
  run: () => void
): Measurement {
  for (let index = 0; index < 5; index++) run();
  const samples: number[] = [];
  for (let index = 0; index < iterations; index++) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  return summarize(name, samples);
}

function createKeyedFixture() {
  const app = createApp({ state: { items: initial } });
  const host = document.createElement("div");
  fixtures.appendChild(host);
  const root = app.render(
    app.$.items.each(
      (item) => item.id,
      (item) => jsx("span", { "data-id": item.id, children: item.label })
    ),
    host,
    { schedule: "manual" }
  );

  return {
    app,
    host,
    update(items: Item[]) {
      app.nexus.set({ items });
      root.flush();
      forceLayout(host);
    },
    dispose() {
      root.dispose();
      host.remove();
    },
  };
}

function createRebuildFixture() {
  const host = document.createElement("div");
  fixtures.appendChild(host);
  return {
    host,
    update(items: readonly Item[]) {
      const fragment = document.createDocumentFragment();
      for (const item of items) {
        const span = document.createElement("span");
        span.dataset.id = String(item.id);
        span.textContent = item.label;
        fragment.appendChild(span);
      }
      host.replaceChildren(fragment);
      forceLayout(host);
    },
    dispose() {
      host.remove();
    },
  };
}

function benchmarkPermutation(
  name: string,
  iterations: number,
  createOrders: (items: Item[]) => [Item[], Item[]]
) {
  const keyed = createKeyedFixture();
  const current = [...keyed.app.nexus.get("items")];
  const [first, second] = createOrders(current);
  let keyedToggle = false;
  const keyedMeasurement = measure(`${name}: keyed`, iterations, () => {
    keyedToggle = !keyedToggle;
    keyed.update(keyedToggle ? first : second);
  });

  const rebuild = createRebuildFixture();
  let rebuildToggle = false;
  const rebuildMeasurement = measure(`${name}: rebuild`, iterations, () => {
    rebuildToggle = !rebuildToggle;
    rebuild.update(rebuildToggle ? first : second);
  });

  keyed.dispose();
  rebuild.dispose();
  return [keyedMeasurement, rebuildMeasurement];
}

function benchmarkRowUpdate() {
  const keyed = createKeyedFixture();
  let keyedVersion = 0;
  const keyedMeasurement = measure("one row update: keyed", 80, () => {
    const items = [...keyed.app.nexus.get("items")];
    items[500] = { ...items[500]!, label: `Keyed ${++keyedVersion}` };
    keyed.update(items);
  });

  const rebuild = createRebuildFixture();
  let rebuildVersion = 0;
  const rebuildMeasurement = measure("one row update: rebuild", 80, () => {
    const items = [...keyed.app.nexus.get("items")];
    items[500] = { ...items[500]!, label: `Rebuild ${++rebuildVersion}` };
    rebuild.update(items);
  });

  const walker = document.createTreeWalker(keyed.host, NodeFilter.SHOW_COMMENT);
  let comments = 0;
  while (walker.nextNode()) comments++;

  keyed.dispose();
  rebuild.dispose();
  return { measurements: [keyedMeasurement, rebuildMeasurement], comments };
}

window.runNexusDOMBenchmarks = async () => {
  const rowUpdate = benchmarkRowUpdate();
  const adjacent = benchmarkPermutation("adjacent swap", 60, (items) => {
    const swapped = [...items];
    [swapped[499], swapped[500]] = [swapped[500]!, swapped[499]!];
    return [items, swapped];
  });
  const moveToFront = benchmarkPermutation("last to first", 40, (items) => [
    items,
    [items.at(-1)!, ...items.slice(0, -1)],
  ]);
  const reverse = benchmarkPermutation("full reverse", 20, (items) => [
    items,
    [...items].reverse(),
  ]);

  return {
    userAgent: navigator.userAgent,
    size,
    measurements: [
      ...rowUpdate.measurements,
      ...adjacent,
      ...moveToFront,
      ...reverse,
    ],
    commentsInsideKeyedList: rowUpdate.comments,
  };
};

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  output.textContent = "Running…";
  try {
    output.textContent = JSON.stringify(
      await window.runNexusDOMBenchmarks(),
      null,
      2
    );
  } finally {
    runButton.disabled = false;
  }
});
