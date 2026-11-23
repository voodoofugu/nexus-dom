/** @jsxImportSource nexus-dom */
import { describe, expect, it } from "vitest";
import { createApp, NexusDOMError, onCleanup, store, view } from "nexus-dom";
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
    const Row = view(
      ({ id }, { label }: { label: string }) =>
        <li id={id("row")} title={'say "hello"'}>{label}</li>
    );
    const App = view(
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
      '<li id="nxs-account-c0-row" title="say &quot;hello&quot;">One</li>' +
      '<li id="nxs-account-c1-row" title="say &quot;hello&quot;">Two</li>' +
      "</ul></main>"
    );
    expect(setups).toBe(0);
  });

  it("matches browser component ids with the same prefix", () => {
    const Field = view(({ id }) => <input id={id("input")} />);
    const App = view(() => <section><Field /><Field /></section>);
    const server = renderToString(<App />, { idPrefix: "form" });
    const host = document.createElement("div");

    createApp().render(<App />, host, { idPrefix: "form" });

    expect(server).toBe(
      '<section><input id="nxs-form-c0-input"><input id="nxs-form-c1-input"></section>'
    );
    expect(Array.from(host.querySelectorAll("input"), (input) => input.id)).toEqual([
      "nxs-form-c0-input",
      "nxs-form-c1-input",
    ]);
  });

  it("disposes keyed server owners and rejects unsafe markup names", () => {
    let cleanups = 0;
    const Row = () => {
      onCleanup(() => cleanups++);
      return <li>Row</li>;
    };
    const model = store({ state: { items: [{ id: 1 }, { id: 2 }] } });
    const List = view(
      ({ $ }) => <ul>{$.items.each((item) => item.id, () => <Row />)}</ul>,
      [model]
    );

    expect(renderToString(<List />)).toBe("<ul><li>Row</li><li>Row</li></ul>");
    expect(cleanups).toBe(2);

    const unsafe = { kind: "element", type: 'div><script', props: {} } as never;
    expect(() => renderToString(unsafe)).toThrowError(NexusDOMError);
  });
});
