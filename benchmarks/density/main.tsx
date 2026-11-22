/** @jsxImportSource nexus-dom */
import { createApp, store, view, type RenderRoot } from "nexus-dom";

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
  const Fine = view(
    ({ $ }) => (
      <section>{selectedKeys.map((key) => <span>{$[key]}</span>)}</section>
    ),
    [data]
  );
  const Whole = view(
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

Object.assign(window, {
  runDensityCase,
  mountDensityFixture: mountFixture,
  disposeDensityFixture: () => disposeFixture(),
});
