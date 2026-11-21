import { bench, describe } from "vitest";
import { bind, createDOMRenderer, createNexus } from "nexus-dom";
import { jsx } from "nexus-dom/jsx-runtime";

describe("single binding update", () => {
  const directText = document.createTextNode("0");
  let directValue = 0;

  const store = createNexus({ state: { value: 0 } });
  const $ = bind(store);
  const renderer = createDOMRenderer({ schedule: "manual" });
  const host = document.createElement("div");
  renderer.mount(jsx("span", { children: $.value }), host);
  let nexusValue = 0;

  const rerenderHost = document.createElement("div");
  let rerenderValue = 0;

  bench("direct text node", () => {
    directText.data = String(++directValue);
  });

  bench("nexus-dom live binding", () => {
    store.set({ value: ++nexusValue });
    renderer.flush();
  });

  bench("naive full subtree rebuild", () => {
    rerenderHost.replaceChildren();
    const span = document.createElement("span");
    span.textContent = String(++rerenderValue);
    rerenderHost.appendChild(span);
  });
});

describe("one update in 1,000 text nodes", () => {
  const initial = Object.fromEntries(
    Array.from({ length: 1_000 }, (_, index) => [`key${index}`, index])
  ) as Record<string, number>;
  const store = createNexus({ state: initial });
  const $ = bind(store);
  const renderer = createDOMRenderer({ schedule: "manual" });
  const host = document.createElement("div");
  const view = Object.keys(initial).map((key) =>
    jsx("span", { children: $[key] })
  );
  renderer.mount(view, host);
  let value = 1_000;

  const rebuildHost = document.createElement("div");
  let rebuildValue = 1_000;

  bench("nexus-dom targeted update", () => {
    store.set({ key500: ++value });
    renderer.flush();
  });

  bench("naive rebuild of 1,000 nodes", () => {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 1_000; index++) {
      const span = document.createElement("span");
      span.textContent = String(index === 500 ? ++rebuildValue : index);
      fragment.appendChild(span);
    }
    rebuildHost.replaceChildren(fragment);
  });
});

describe("reverse 1,000 keyed rows", () => {
  const initial = Array.from({ length: 1_000 }, (_, id) => ({
    id,
    label: `Row ${id}`,
  }));
  const store = createNexus({ state: { items: initial } });
  const $ = bind(store);
  const renderer = createDOMRenderer({ schedule: "manual" });
  const host = document.createElement("div");
  renderer.mount(
    $.items.each(
      (item) => item.id,
      (item) => jsx("span", { children: item.label })
    ),
    host
  );

  const forward = [...store.get("items")];
  const backward = [...forward].reverse();
  let reversed = false;

  const rebuildHost = document.createElement("div");
  let rebuildReversed = false;

  bench("nexus-dom keyed reorder", () => {
    reversed = !reversed;
    store.set({ items: reversed ? backward : forward });
    renderer.flush();
  });

  bench("naive rebuild of 1,000 rows", () => {
    rebuildReversed = !rebuildReversed;
    const source = rebuildReversed ? backward : forward;
    const fragment = document.createDocumentFragment();
    for (const item of source) {
      const span = document.createElement("span");
      span.textContent = item.label;
      fragment.appendChild(span);
    }
    rebuildHost.replaceChildren(fragment);
  });
});

describe("replace one keyed row among 1,000", () => {
  const initial = Array.from({ length: 1_000 }, (_, id) => ({
    id,
    label: `Row ${id}`,
  }));
  const store = createNexus({ state: { items: initial } });
  const $ = bind(store);
  const renderer = createDOMRenderer({ schedule: "manual" });
  const host = document.createElement("div");
  renderer.mount(
    $.items.each(
      (item) => item.id,
      (item) => jsx("span", { children: item.label })
    ),
    host
  );
  let version = 0;

  const rebuildHost = document.createElement("div");
  let rebuildVersion = 0;

  bench("nexus-dom keyed row update", () => {
    const items = [...store.get("items")];
    items[500] = { ...items[500]!, label: `Updated ${++version}` };
    store.set({ items });
    renderer.flush();
  });

  bench("naive rebuild after one row update", () => {
    const fragment = document.createDocumentFragment();
    for (const item of store.get("items")) {
      const span = document.createElement("span");
      span.textContent =
        item.id === 500 ? `Updated ${++rebuildVersion}` : item.label;
      fragment.appendChild(span);
    }
    rebuildHost.replaceChildren(fragment);
  });
});
