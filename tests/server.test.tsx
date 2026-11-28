/** @jsxImportSource nexus-dom */
import { bind } from "../src/live.js";
import { createNexus } from "nexus-state";
import { describe, expect, it } from "vitest";
import {
  createApp,
  NexusDOMError,
  onCleanup,
  store,
  component,
} from "nexus-dom";
import { renderToString } from "nexus-dom/server";

describe("nexus-dom server rendering", () => {
  it("renders escaped elements, store views, live bindings and stable ids", () => {
    let setups = 0;
    const model = store({
      state: {
        title: "A < B",
        items: [{ id: 1, label: "One" }, { id: 2, label: "Two" }],
      },
      setup() {
        setups++;
      },
    });
    const Row = component(
      ({ id }, { label }: { label: string }) =>
        <li id={id("row")} title={'say "hello"'}>{label}</li>
    );
    const App = component(
      ({ state, $ }) => (
        <main aria-label={state.title}>
          <h1>{$.title}</h1>
          <ul>{$.items.each((item) => item.id, ($item) => <Row label={$item.label.get()} />)}</ul>
        </main>
      ),
      [model]
    );

    const html = renderToString(<App />, { idPrefix: "account" });

    expect(html).toBe(
      '<main aria-label="A &lt; B"><h1>A &lt; B</h1><ul>' +
      '<li id="nxs-re1mZLO" title="say &quot;hello&quot;">One</li>' +
      '<li id="nxs-MWpvxI8" title="say &quot;hello&quot;">Two</li>' +
      "</ul></main>"
    );
    expect(setups).toBe(0);
  });

  it("matches browser component ids with the same prefix", () => {
    const Field = component(({ id }) => <input id={id("input")} />);
    const App = component(() => <section><Field /><Field /></section>);
    const server = renderToString(<App />, { idPrefix: "form" });
    const host = document.createElement("div");

    const app = createApp();
    app.render(<App />, host, { idPrefix: "form" });

    expect(server).toBe(host.innerHTML);
    expect(Array.from(host.querySelectorAll("input"), (input) => input.id)).toEqual([
      "nxs-ByvN82F",
      "nxs-0ZJnesR",
    ]);
    app.dispose();
  });

  it("matches nested tracked, keyed and dynamic owner paths", () => {
    const model = store({
      state: {
        visible: true,
        items: [{ id: 1 }, { id: 2 }],
      },
    });
    const Field = component(
      ({ id }, { name }: { name: string }) => <span id={id("field")}>{name}</span>
    );
    const App = component(
      ({ $ }) => (
        <main>
          <Field name="plain" />
          <ul>
            {$.items.each(
              (item) => item.id,
              ($item) => <li><Field name={`row-${$item.id.get()}`} /></li>
            )}
          </ul>
          {$.visible.render(() => <Field name="dynamic" />)}
        </main>
      ),
      [model]
    );
    const server = renderToString(<App />, { idPrefix: "nested" });
    const host = document.createElement("div");
    const app = createApp();

    app.render(<App />, host, { idPrefix: "nested" });

    expect(server).toBe(host.innerHTML);
    expect(new Set(Array.from(host.querySelectorAll("span"), (node) => node.id)).size).toBe(4);
    app.dispose();
  });

  it("derives keyed component ids from keys instead of list positions", () => {
    const Row = component(
      ({ id }, { itemId }: { itemId: number }) =>
        <li id={id("row")} data-item={itemId}>{itemId}</li>
    );
    const renderItems = (items: readonly { id: number }[]) => {
      const $ = bind(createNexus({ state: { items } }));
      const html = renderToString(
        <ul>{$.items.each((item) => item.id, ($item) => <Row itemId={$item.id.get()} />)}</ul>,
        { idPrefix: "keyed" }
      );
      const host = document.createElement("div");
      host.innerHTML = html;
      return new Map(
        Array.from(host.querySelectorAll("li"), (row) => [row.dataset.item, row.id])
      );
    };

    const forward = renderItems([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const reverse = renderItems([{ id: 3 }, { id: 2 }, { id: 1 }]);

    expect(reverse).toEqual(forward);
  });

  it("disposes keyed server owners and rejects unsafe markup names", () => {
    let cleanups = 0;
    const Row = () => {
      onCleanup(() => cleanups++);
      return <li>Row</li>;
    };
    const model = store({ state: { items: [{ id: 1 }, { id: 2 }] } });
    const List = component(
      ({ $ }) => <ul>{$.items.each((item) => item.id, () => <Row />)}</ul>,
      [model]
    );

    expect(renderToString(<List />)).toBe("<ul><li>Row</li><li>Row</li></ul>");
    expect(cleanups).toBe(2);

    const unsafe = { kind: "element", type: 'div><script', props: {} } as never;
    expect(() => renderToString(unsafe)).toThrowError(NexusDOMError);
  });
});
