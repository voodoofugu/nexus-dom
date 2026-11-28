import { signal, type Signal } from "@preact/signals";
import { For, createSignal, flush as flushSolid } from "solid-js";
import { insert, render as renderSolid } from "@solidjs/web";
import { bind, render as renderNexus } from "nexus-dom/core";
import { createNexus } from "nexus-state";
import { createListHelpers } from "../../src/list.js";
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
  supportsMoveBefore: boolean;
  correctness: Array<{ framework: string; focusPreserved: boolean }>;
  measurements: Measurement[];
  mountDiagnostics: Measurement[];
}

declare global {
  interface Window {
    runRendererComparison(): ComparisonReport;
    runFirstMount(frameworkName: string): number;
    mountMemoryFixture(
      variant:
        | "direct DOM"
        | "static JSX"
        | "keyed static fields"
        | "reactive keyed (1 field)"
        | "reactive keyed (2 fields)"
        | "React"
        | "Solid"
        | "Preact Signals",
      count: number
    ): number;
    disposeMemoryFixture(): void;
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

const permutations = <T,>(values: readonly T[]): T[][] =>
  values.length < 2
    ? [[...values]]
    : values.flatMap((value, index) =>
        permutations([...values.slice(0, index), ...values.slice(index + 1)]).map(
          (rest) => [value, ...rest]
        )
      );

const createNexusFixture = (): Fixture => {
  const nexus = createNexus({ state: { items: initial } });
  const $ = bind(nexus);
  const { list } = createListHelpers(nexus.get, nexus.set);
  const host = createHost();
  const root = renderNexus(
    $.items.each(
      (item) => item.id,
      ($item) =>
        jsx("span", {
          "data-id": $item.id.get(),
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
      const item = nexus.get("items")[500]!;
      list("items").replace(500, { ...item, label: `Row ${version}` });
      flush();
    },
    moveAdjacent() {
      list("items").move(499, 500);
      flush();
    },
    moveLastToFirst() {
      list("items").move(rows - 1, 0);
      flush();
    },
    reverse() {
      list("items").reverse();
      flush();
    },
    dispose() {
      root.dispose();
      host.remove();
    },
  };
};

interface MountVariant {
  readonly name: string;
  mount(): () => void;
}

const mountVariants: MountVariant[] = [
  {
    name: "direct DOM",
    mount() {
      const host = createHost();
      const fragment = document.createDocumentFragment();
      for (const item of initial) {
        const span = document.createElement("span");
        span.dataset.id = String(item.id);
        if (item.id === 500) span.tabIndex = 0;
        span.textContent = item.label;
        fragment.appendChild(span);
      }
      host.appendChild(fragment);
      forceLayout(host);
      return () => host.remove();
    },
  },
  {
    name: "nexus static JSX",
    mount() {
      const host = createHost();
      const root = renderNexus(
        initial.map((item) =>
          jsx("span", {
            "data-id": item.id,
            tabIndex: item.id === 500 ? 0 : undefined,
            children: item.label,
          })
        ),
        host,
        { schedule: "manual" }
      );
      forceLayout(host);
      return () => {
        root.dispose();
        host.remove();
      };
    },
  },
  {
    name: "nexus keyed static fields",
    mount() {
      const $ = bind(createNexus({ state: { items: initial } }));
      const host = createHost();
      const root = renderNexus(
        $.items.each(
          (item) => item.id,
          ($item) => {
            const item = $item.get();
            return jsx("span", {
              "data-id": item.id,
              tabIndex: item.id === 500 ? 0 : undefined,
              children: item.label,
            });
          }
        ),
        host,
        { schedule: "manual" }
      );
      forceLayout(host);
      return () => {
        root.dispose();
        host.remove();
      };
    },
  },
  {
    name: "nexus keyed reactive fields",
    mount() {
      const fixture = createNexusFixture();
      return fixture.dispose;
    },
  },
];

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

window.runFirstMount = (frameworkName) => {
  const framework = frameworks.find(({ name }) => name === frameworkName);
  if (!framework) throw new Error(`Unknown framework "${frameworkName}".`);
  const start = performance.now();
  const fixture = framework.create();
  const duration = performance.now() - start;
  assertEqual(
    fixture.host.children.length,
    rows,
    `${framework.name} first-mount row count`
  );
  fixture.dispose();
  return duration;
};

let disposeMemoryFixture: (() => void) | undefined;

window.mountMemoryFixture = (variant, count) => {
  window.disposeMemoryFixture();
  const items = Array.from({ length: count }, (_, id) => ({
    id,
    label: `Row ${id}`,
  }));
  const host = createHost();

  if (variant === "direct DOM") {
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const span = document.createElement("span");
      span.dataset.id = String(item.id);
      span.textContent = item.label;
      fragment.appendChild(span);
    }
    host.appendChild(fragment);
    disposeMemoryFixture = () => host.remove();
  } else if (variant === "static JSX") {
    const root = renderNexus(
      items.map((item) =>
        jsx("span", { "data-id": item.id, children: item.label })
      ),
      host,
      { schedule: "manual" }
    );
    disposeMemoryFixture = () => {
      root.dispose();
      host.remove();
    };
  } else if (variant === "keyed static fields") {
    const $ = bind(createNexus({ state: { items } }));
    const root = renderNexus(
      $.items.each(
        (item) => item.id,
        ($item) => {
          const item = $item.get();
          return jsx("span", {
            "data-id": item.id,
            children: item.label,
          });
        }
      ),
      host,
      { schedule: "manual" }
    );
    disposeMemoryFixture = () => {
      root.dispose();
      host.remove();
    };
  } else if (
    variant === "reactive keyed (1 field)" ||
    variant === "reactive keyed (2 fields)"
  ) {
    const $ = bind(createNexus({ state: { items } }));
    const root = renderNexus(
      $.items.each(
        (item) => item.id,
        ($item) =>
          jsx("span", {
            "data-id":
              variant === "reactive keyed (2 fields)"
                ? $item.id
                : $item.id.get(),
            children: $item.label,
          })
      ),
      host,
      { schedule: "manual" }
    );
    disposeMemoryFixture = () => {
      root.dispose();
      host.remove();
    };
  } else if (variant === "React") {
    const root = createRoot(host);
    function Rows() {
      const [current] = useState(items);
      return createElement(
        Fragment,
        null,
        current.map((item) =>
          createElement(
            "span",
            { key: item.id, "data-id": item.id },
            item.label
          )
        )
      );
    }
    flushSync(() => root.render(createElement(Rows)));
    disposeMemoryFixture = () => {
      flushSync(() => root.unmount());
      host.remove();
    };
  } else if (variant === "Solid") {
    const solidItems = items.map((item) => {
      const [label] = createSignal(item.label);
      return { id: item.id, label };
    });
    const [order] = createSignal(solidItems);
    const dispose = renderSolid(
      () =>
        For({
          get each() {
            return order();
          },
          children: (item) => {
            const span = document.createElement("span");
            span.dataset.id = String(item.id);
            insert(span, item.label);
            return span;
          },
        }),
      host
    );
    flushSolid();
    disposeMemoryFixture = () => {
      dispose();
      host.remove();
    };
  } else {
    const previousDebounce = options.debounceRendering;
    options.debounceRendering = (callback) => callback();
    const signalItems = items.map((item) => ({
      id: item.id,
      label: signal(item.label),
    }));
    const order = signal(signalItems);
    function Row({ item }: { item: SignalItem }) {
      return h("span", { "data-id": item.id }, item.label.value);
    }
    function Rows() {
      return order.value.map((item) => h(Row, { key: item.id, item }));
    }
    renderPreact(h(Rows, {}), host);
    disposeMemoryFixture = () => {
      renderPreact(null, host);
      if (previousDebounce) options.debounceRendering = previousDebounce;
      else delete options.debounceRendering;
      host.remove();
    };
  }

  forceLayout(host);
  assertEqual(host.children.length, count, `${variant} memory row count`);
  return host.children.length;
};

window.disposeMemoryFixture = () => {
  disposeMemoryFixture?.();
  disposeMemoryFixture = undefined;
};

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
    return {
      framework: framework.name,
      focusPreserved: document.activeElement === middle,
    };
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

function measureFrameworkMounts(): Map<Framework, Measurement> {
  const samples = new Map(frameworks.map((framework) => [framework, [] as number[]]));
  for (const framework of frameworks) {
    for (let index = 0; index < 10; index++) framework.create().dispose();
  }
  const orders = permutations(frameworks);
  for (const order of [...orders, ...orders]) {
    for (const framework of order) {
      const start = performance.now();
      const fixture = framework.create();
      samples.get(framework)!.push(performance.now() - start);
      fixture.dispose();
    }
  }
  return new Map(
    frameworks.map((framework) => [
      framework,
      summarize(framework.name, "mount 1,000 rows", samples.get(framework)!),
    ])
  );
}

function measureMountVariants(): Measurement[] {
  const samples = new Map(mountVariants.map((variant) => [variant, [] as number[]]));
  for (const variant of mountVariants) {
    for (let index = 0; index < 40; index++) variant.mount()();
  }
  const orders = permutations(mountVariants);
  for (const order of [...orders, ...orders]) {
    for (const variant of order) {
      const start = performance.now();
      const dispose = variant.mount();
      samples.get(variant)!.push(performance.now() - start);
      dispose();
    }
  }
  return mountVariants.map((variant) =>
    summarize("mount diagnostic", variant.name, samples.get(variant)!)
  );
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
  const correctness = frameworks.map(validateFramework);
  const mountMeasurements = measureFrameworkMounts();
  for (const framework of frameworks) {
    measurements.push(
      mountMeasurements.get(framework)!,
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
  return {
    userAgent: navigator.userAgent,
    rows,
    supportsMoveBefore: "moveBefore" in Element.prototype,
    correctness,
    measurements,
    mountDiagnostics: measureMountVariants(),
  };
};

output.textContent = "Ready. Run with npm run benchmark:compare.";
