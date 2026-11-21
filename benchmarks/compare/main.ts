import { signal, type Signal } from "@preact/signals";
import { For, createSignal, flush as flushSolid } from "solid-js";
import { insert, render as renderSolid } from "@solidjs/web";
import { createApp } from "nexus-dom";
import { jsx } from "nexus-dom/jsx-runtime";
import { createElement, Fragment, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { h, options, render as renderPreact } from "preact";

interface Item {
  id: number;
  label: string;
}

interface Fixture {
  readonly host: HTMLElement;
  replaceMiddle(version: number): void;
  moveAdjacent(): void;
  moveLastToFirst(): void;
  reverse(): void;
  dispose(): void;
}

interface Framework {
  readonly name: string;
  create(): Fixture;
}

interface Measurement {
  framework: string;
  scenario: string;
  iterations: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
}

interface ComparisonReport {
  userAgent: string;
  rows: number;
  measurements: Measurement[];
}

declare global {
  interface Window {
    runRendererComparison(): ComparisonReport;
  }
}

const rows = 1_000;
const initial = Array.from({ length: rows }, (_, id) => ({
  id,
  label: `Row ${id}`,
}));
const fixtures = document.querySelector("#fixtures")!;
const output = document.querySelector("#results")!;

const createHost = () => {
  const host = document.createElement("div");
  fixtures.appendChild(host);
  return host;
};

const forceLayout = (host: HTMLElement) => {
  void host.offsetHeight;
};

const move = <T,>(items: readonly T[], from: number, to: number) => {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
};

const createNexusFixture = (): Fixture => {
  const app = createApp({ state: { items: initial } });
  const host = createHost();
  const root = app.render(
    app.$.items.each(
      (item) => item.id,
      ($item) =>
        jsx("span", {
          "data-id": $item.id,
          tabIndex: $item.id.get() === 500 ? 0 : undefined,
          children: $item.label,
        })
    ),
    host,
    { schedule: "manual" }
  );

  const flush = () => {
    root.flush();
    forceLayout(host);
  };

  return {
    host,
    replaceMiddle(version) {
      const item = app.nexus.get("items")[500]!;
      app.list("items").replace(500, { ...item, label: `Row ${version}` });
      flush();
    },
    moveAdjacent() {
      app.list("items").move(499, 500);
      flush();
    },
    moveLastToFirst() {
      app.list("items").move(rows - 1, 0);
      flush();
    },
    reverse() {
      app.list("items").reverse();
      flush();
    },
    dispose() {
      app.dispose();
      host.remove();
    },
  };
};

const createReactFixture = (): Fixture => {
  const host = createHost();
  const root = createRoot(host);
  let current = initial.map((item) => ({ ...item }));
  let setItems!: (items: Item[]) => void;

  function Rows() {
    const [items, updateItems] = useState(current);
    setItems = updateItems;
    return createElement(
      Fragment,
      null,
      items.map((item) =>
        createElement(
          "span",
          {
            key: item.id,
            "data-id": item.id,
            tabIndex: item.id === 500 ? 0 : undefined,
          },
          item.label
        )
      )
    );
  }

  flushSync(() => root.render(createElement(Rows)));
  forceLayout(host);
  const update = (next: Item[]) => {
    current = next;
    flushSync(() => setItems(next));
    forceLayout(host);
  };

  return {
    host,
    replaceMiddle(version) {
      const next = [...current];
      next[500] = { ...next[500]!, label: `Row ${version}` };
      update(next);
    },
    moveAdjacent() {
      update(move(current, 499, 500));
    },
    moveLastToFirst() {
      update(move(current, rows - 1, 0));
    },
    reverse() {
      update([...current].reverse());
    },
    dispose() {
      flushSync(() => root.unmount());
      host.remove();
    },
  };
};

interface SignalItem {
  id: number;
  label: Signal<string>;
}

const createPreactFixture = (): Fixture => {
  const previousDebounce = options.debounceRendering;
  options.debounceRendering = (callback) => callback();
  const host = createHost();
  const order = signal<SignalItem[]>(
    initial.map((item) => ({ id: item.id, label: signal(item.label) }))
  );

  function Row({ item }: { item: SignalItem }) {
    return h(
      "span",
      { "data-id": item.id, tabIndex: item.id === 500 ? 0 : undefined },
      item.label.value
    );
  }

  function Rows() {
    return order.value.map((item) =>
      h(Row, { key: item.id, item })
    );
  }

  renderPreact(h(Rows, {}), host);
  forceLayout(host);
  const updateOrder = (next: SignalItem[]) => {
    order.value = next;
    forceLayout(host);
  };

  return {
    host,
    replaceMiddle(version) {
      order.value[500]!.label.value = `Row ${version}`;
      forceLayout(host);
    },
    moveAdjacent() {
      updateOrder(move(order.value, 499, 500));
    },
    moveLastToFirst() {
      updateOrder(move(order.value, rows - 1, 0));
    },
    reverse() {
      updateOrder([...order.value].reverse());
    },
    dispose() {
      renderPreact(null, host);
      if (previousDebounce) options.debounceRendering = previousDebounce;
      else delete options.debounceRendering;
      host.remove();
    },
  };
};

interface SolidItem {
  id: number;
  label: () => string;
  setLabel(value: string): void;
}

const createSolidFixture = (): Fixture => {
  const host = createHost();
  const solidItems: SolidItem[] = initial.map((item) => {
    const [label, setLabel] = createSignal(item.label);
    return { id: item.id, label, setLabel };
  });
  const [order, setOrder] = createSignal(solidItems);
  const dispose = renderSolid(
    () =>
      For({
        get each() {
          return order();
        },
        children: (item) => {
          const span = document.createElement("span");
          span.dataset.id = String(item.id);
          if (item.id === 500) span.tabIndex = 0;
          insert(span, item.label);
          return span;
        },
      }),
    host
  );
  flushSolid();
  forceLayout(host);
  const updateOrder = (next: SolidItem[]) => {
    setOrder(next);
    flushSolid();
    forceLayout(host);
  };

  return {
    host,
    replaceMiddle(version) {
      order()[500]!.setLabel(`Row ${version}`);
      flushSolid();
      forceLayout(host);
    },
    moveAdjacent() {
      updateOrder(move(order(), 499, 500));
    },
    moveLastToFirst() {
      updateOrder(move(order(), rows - 1, 0));
    },
    reverse() {
      updateOrder([...order()].reverse());
    },
    dispose() {
      dispose();
      host.remove();
    },
  };
};

const frameworks: Framework[] = [
  { name: "nexus-dom", create: createNexusFixture },
  { name: "React", create: createReactFixture },
  { name: "Solid", create: createSolidFixture },
  { name: "Preact Signals", create: createPreactFixture },
];

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function validateFramework(framework: Framework) {
  const fixture = framework.create();
  try {
    assertEqual(
      fixture.host.children.length,
      rows,
      `${framework.name} initial row count`
    );
    const middle = fixture.host.children[500];
    if (!(middle instanceof HTMLElement)) {
      throw new Error(`${framework.name} middle row is not an HTMLElement.`);
    }
    middle.focus();
    assertEqual(
      document.activeElement,
      middle,
      `${framework.name} initial row focus`
    );
    fixture.replaceMiddle(10_001);
    assertEqual(
      fixture.host.children[500],
      middle,
      `${framework.name} row identity after replacement`
    );
    assertEqual(
      fixture.host.children[500]?.textContent,
      "Row 10001",
      `${framework.name} replaced row text`
    );
    fixture.moveAdjacent();
    assertEqual(
      (fixture.host.children[499] as HTMLElement | undefined)?.dataset.id,
      "500",
      `${framework.name} adjacent move`
    );
    fixture.moveLastToFirst();
    assertEqual(
      (fixture.host.firstElementChild as HTMLElement | null)?.dataset.id,
      "999",
      `${framework.name} last-to-first move`
    );
    const firstBeforeReverse = fixture.host.firstElementChild;
    fixture.reverse();
    assertEqual(
      fixture.host.lastElementChild,
      firstBeforeReverse,
      `${framework.name} reverse identity`
    );
    assertEqual(
      document.activeElement,
      middle,
      `${framework.name} focus after keyed updates`
    );
  } finally {
    fixture.dispose();
  }
}

function summarize(
  framework: string,
  scenario: string,
  samples: number[]
): Measurement {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (value: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] ?? 0;
  return {
    framework,
    scenario,
    iterations: samples.length,
    meanMs: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
  };
}

function measureMount(framework: Framework): Measurement {
  for (let index = 0; index < 3; index++) framework.create().dispose();
  const samples: number[] = [];
  for (let index = 0; index < 20; index++) {
    const start = performance.now();
    const fixture = framework.create();
    samples.push(performance.now() - start);
    fixture.dispose();
  }
  return summarize(framework.name, "mount 1,000 rows", samples);
}

function measureUpdate(
  framework: Framework,
  scenario: string,
  iterations: number,
  update: (fixture: Fixture, version: number) => void
): Measurement {
  const fixture = framework.create();
  for (let index = 0; index < 5; index++) update(fixture, index);
  const samples: number[] = [];
  for (let index = 0; index < iterations; index++) {
    const start = performance.now();
    update(fixture, index + 5);
    samples.push(performance.now() - start);
  }
  fixture.dispose();
  return summarize(framework.name, scenario, samples);
}

window.runRendererComparison = () => {
  const measurements: Measurement[] = [];
  for (const framework of frameworks) {
    validateFramework(framework);
    measurements.push(
      measureMount(framework),
      measureUpdate(framework, "replace one row", 80, (fixture, version) =>
        fixture.replaceMiddle(version)
      ),
      measureUpdate(framework, "adjacent move", 60, (fixture) =>
        fixture.moveAdjacent()
      ),
      measureUpdate(framework, "last to first", 40, (fixture) =>
        fixture.moveLastToFirst()
      ),
      measureUpdate(framework, "full reverse", 20, (fixture) =>
        fixture.reverse()
      )
    );
  }
  return { userAgent: navigator.userAgent, rows, measurements };
};

output.textContent = "Ready. Run with npm run benchmark:compare.";
