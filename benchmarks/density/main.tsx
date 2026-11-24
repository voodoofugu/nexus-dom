/** @jsxImportSource nexus-dom */
import { createApp, store, component, componentScope, type RenderRoot } from "nexus-dom";

type Strategy = "fine" | "view";
type Mode = "one" | "all";
const keys = Array.from({ length: 16 }, (_, index) => `field${index}`);
let disposeFixture = () => {};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

function mountFixture(strategy: Strategy, density: number, components: number) {
  disposeFixture();
  const selectedKeys = keys.slice(0, density);
  const initial = Object.fromEntries(keys.map((key) => [key, 0]));
  let updateOne = () => {};
  let updateAll = () => {};
  const data = store({
    state: initial,
    acts: ({ get, set }) => {
      updateOne = () => set({ field0: get("field0") + 1 });
      updateAll = () =>
        set(Object.fromEntries(selectedKeys.map((key) => [key, get(key) + 1])));
      return {};
    },
  });
  const Fine = component(
    ({ $ }) => (
      <section>{selectedKeys.map((key) => <span>{$[key]}</span>)}</section>
    ),
    [data]
  );
  const Whole = component(
    ({ state }) => (
      <section>{selectedKeys.map((key) => <span>{state[key]}</span>)}</section>
    ),
    [data]
  );
  const Component = strategy === "fine" ? Fine : Whole;
  const app = createApp();
  const target = document.querySelector("#app")!;
  const root: RenderRoot = app.render(
    Array.from({ length: components }, () => <Component />),
    target,
    { schedule: "manual" }
  );
  disposeFixture = () => {
    app.dispose();
    target.replaceChildren();
  };
  return { root, updateOne, updateAll };
}

async function runDensityCase(
  strategy: Strategy,
  density: number,
  components: number,
  iterations: number,
  mode: Mode
) {
  const fixture = mountFixture(strategy, density, components);
  const update = mode === "one" ? fixture.updateOne : fixture.updateAll;
  for (let index = 0; index < 20; index++) {
    update();
    fixture.root.flush();
  }
  const samples: number[] = [];
  for (let index = 0; index < iterations; index++) {
    const start = performance.now();
    update();
    fixture.root.flush();
    samples.push(performance.now() - start);
  }
  return median(samples);
}

function runSelectorSelectionCase(strategy: "namespace" | "field", rows: number) {
  let selectNext = () => {};
  const issues = store({
    state: {
      items: Array.from({ length: rows }, (_, id) => ({ id, title: `Issue ${id}` })),
      selectedIssueId: 0,
    },
    acts: ({ set, get }) => {
      selectNext = () => set({ selectedIssueId: (get("selectedIssueId") + 1) % rows });
      return {};
    },
  });
  const filters = store({ state: { query: "Issue" } });
  let runs = 0;
  const filter = (items: { id: number; title: string }[], query: string) => {
    runs++;
    return items.filter((item) => item.title.includes(query));
  };
  const scope = componentScope({ issues, filters });
  const Scoped = scope(({ $ }) => (
    <>
      <output>{$.issues.selectedIssueId}</output>
      <ul>{$.$select(({ issues, filters }) => filter(issues.items, filters.query))
        .each((item) => item.id, ($item) => <li>{$item.title}</li>)}</ul>
    </>
  ));
  const Flat = component(({ $ }) => (
    <>
      <output>{$.selectedIssueId}</output>
      <ul>{$.$select(({ items, query }) => filter(items, query))
        .each((item) => item.id, ($item) => <li>{$item.title}</li>)}</ul>
    </>
  ), [issues, filters]);
  const app = createApp();
  const target = document.querySelector("#app")!;
  try {
    const root = app.render(strategy === "namespace" ? <Scoped /> : <Flat />, target, { schedule: "manual" });
    const first = target.querySelector("li");
    const update = () => {
      selectNext();
      root.flush();
    };
    for (let index = 0; index < 20; index++) update();
    runs = 0;
    const samples = [];
    const updatesPerSample = 10;
    for (let sample = 0; sample < 15; sample++) {
      const start = performance.now();
      for (let index = 0; index < updatesPerSample; index++) update();
      samples.push((performance.now() - start) / updatesPerSample);
    }
    if (
      target.querySelector("li") !== first ||
      target.querySelector("ul")?.children.length !== rows ||
      target.querySelector("output")?.textContent !== "170"
    ) {
      throw new Error("Selection fixture must update selection and preserve the keyed list.");
    }
    return { median_ms: median(samples), filter_runs: runs, updates: 15 * updatesPerSample };
  } finally {
    app.dispose();
  }
}

Object.assign(window, {
  runDensityCase,
  mountDensityFixture: mountFixture,
  runSelectorSelectionCase,
  disposeDensityFixture: () => disposeFixture(),
});
