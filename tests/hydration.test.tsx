/** @jsxImportSource nexus-dom */
import { describe, expect, it, vi } from "vitest";
import {
  bind,
  createApp,
  createNexus,
  ErrorBoundary,
  hydrate,
  NexusDOMError,
  store,
  view,
  when,
} from "nexus-dom";
import { renderToString } from "nexus-dom/server";

describe("nexus-dom hydration", () => {
  it("reuses elements and attaches live text, properties, events and refs", () => {
    const store = createNexus({ state: { count: 0 } });
    const $ = bind(store);
    const ref: { current: HTMLButtonElement | null } = { current: null };
    const click = vi.fn();
    const App = () => (
      <button ref={ref} data-count={$.count} onClick={click}>
        {$.count}
      </button>
    );
    const host = document.createElement("div");
    host.innerHTML = renderToString(<App />, {
      hydration: true,
      idPrefix: "counter",
    });
    const button = host.querySelector("button")!;

    const root = hydrate(<App />, host, {
      schedule: "manual",
      idPrefix: "counter",
    });

    expect(host.querySelector("button")).toBe(button);
    expect(ref.current).toBe(button);
    expect(host.innerHTML).toBe('<button data-count="0">0</button>');

    store.set({ count: 1 });
    root.flush();
    button.click();

    expect(button.dataset.count).toBe("1");
    expect(button.textContent).toBe("1");
    expect(click).toHaveBeenCalledOnce();

    root.dispose();
    expect(ref.current).toBe(null);
    expect(host.childNodes).toHaveLength(0);
  });

  it("hydrates an initially empty live text node", () => {
    const store = createNexus({ state: { value: "" } });
    const $ = bind(store);
    const host = document.createElement("div");
    host.innerHTML = renderToString(<p>{$.value}</p>, { hydration: true });

    const root = hydrate(<p>{$.value}</p>, host, { schedule: "manual" });
    const paragraph = host.querySelector("p")!;

    expect(paragraph.childNodes).toHaveLength(1);
    expect(paragraph.firstChild?.nodeType).toBe(Node.TEXT_NODE);

    store.set({ value: "ready" });
    root.flush();

    expect(paragraph.textContent).toBe("ready");
  });

  it("hydrates standalone store views and keeps tracked reconciliation", () => {
    let setups = 0;
    const counter = store({
      state: { count: 0 },
      acts: ({ get, set }) => ({
        increment() {
          set({ count: get("count") + 1 });
        },
      }),
      setup() {
        setups++;
      },
    });
    const Counter = view(
      ({ id, state, acts }) => (
        <button id={id("button")} onClick={acts.increment}>{state.count}</button>
      ),
      [counter]
    );
    const host = document.createElement("div");
    host.innerHTML = renderToString(<Counter />, {
      hydration: true,
      idPrefix: "app",
    });
    const button = host.querySelector("button")!;
    const app = createApp();

    const root = app.hydrate(<Counter />, host, {
      schedule: "manual",
      idPrefix: "app",
    });

    expect(setups).toBe(1);
    expect(host.querySelector("button")).toBe(button);
    button.click();
    root.flush();

    expect(host.querySelector("button")).toBe(button);
    expect(button.textContent).toBe("1");

    app.dispose();
    expect(host.childNodes).toHaveLength(0);
  });

  it("hydrates populated and empty dynamic regions", () => {
    const state = createNexus({
      state: { visible: true, deferred: false },
    });
    const $ = bind(state);
    const App = () => (
      <main>
        {$.visible.render((visible) => visible ? <input value="kept" /> : null)}
        {$.deferred.render((visible) => visible ? <strong>Ready</strong> : null)}
        {when($.visible, <em>Shown</em>, <b>Hidden</b>)}
        <span>After</span>
      </main>
    );
    const host = document.createElement("div");
    host.innerHTML = renderToString(<App />, { hydration: true });
    const input = host.querySelector("input")!;
    const after = host.querySelector("span")!;

    const root = hydrate(<App />, host, { schedule: "manual" });

    expect(host.querySelector("input")).toBe(input);
    expect(host.querySelector("em")?.textContent).toBe("Shown");
    expect(host.querySelector("span")).toBe(after);

    state.set({ visible: false, deferred: true });
    root.flush();

    expect(host.querySelector("input")).toBe(null);
    expect(host.querySelector("strong")?.textContent).toBe("Ready");
    expect(host.querySelector("em")).toBe(null);
    expect(host.querySelector("b")?.textContent).toBe("Hidden");
    expect(host.querySelector("span")).toBe(after);
  });

  it("hydrates keyed multi-node rows and preserves them through reconciliation", () => {
    const state = createNexus({
      state: {
        items: [
          { id: 1, label: "One" },
          { id: 2, label: "Two" },
          { id: 3, label: "Three" },
        ],
      },
    });
    const $ = bind(state);
    const App = () => (
      <ul>
        {$.items.each(
          (item) => item.id,
          ($item) => (
            <>
              <li data-item={$item.id.get()}>
                <input value={$item.label} />
                <span>{$item.label}</span>
              </li>
              <small data-tail={$item.id.get()}>tail</small>
            </>
          )
        )}
      </ul>
    );
    const host = document.createElement("div");
    host.innerHTML = renderToString(<App />, { hydration: true });
    const rows = new Map(
      Array.from(host.querySelectorAll("li"), (row) => [row.dataset.item, row])
    );
    const input = rows.get("2")!.querySelector("input")!;

    const root = hydrate(<App />, host, { schedule: "manual" });

    expect(host.querySelector('[data-item="2"]')).toBe(rows.get("2"));

    state.set({
      items: [
        { id: 3, label: "Third" },
        { id: 2, label: "Second" },
        { id: 1, label: "First" },
      ],
    });
    root.flush();

    expect(Array.from(host.querySelectorAll("li"), (row) => row.dataset.item)).toEqual([
      "3",
      "2",
      "1",
    ]);
    expect(host.querySelector('[data-item="2"]')).toBe(rows.get("2"));
    expect(rows.get("2")!.querySelector("input")).toBe(input);
    expect(rows.get("2")!.textContent).toBe("Second");
    expect(input.value).toBe("Second");
    expect(Array.from(host.querySelectorAll("small"), (tail) => tail.dataset.tail)).toEqual([
      "3",
      "2",
      "1",
    ]);
  });

  it("creates a client anchor for an empty keyed row", () => {
    const state = createNexus({
      state: { items: [{ id: 1, visible: false }, { id: 2, visible: true }] },
    });
    const $ = bind(state);
    const App = () => (
      <ul>
        {$.items.each(
          (item) => item.id,
          ($item) => $item.visible.get() ? <li>{$item.id}</li> : null
        )}
      </ul>
    );
    const host = document.createElement("div");
    host.innerHTML = renderToString(<App />, { hydration: true });

    const root = hydrate(<App />, host, { schedule: "manual" });
    const list = host.querySelector("ul")!;

    expect(list.childNodes).toHaveLength(3);
    expect(list.firstChild?.nodeType).toBe(Node.TEXT_NODE);

    state.set({ items: [{ id: 2, visible: true }] });
    root.flush();

    expect(list.childNodes).toHaveLength(2);
    expect(list.textContent).toBe("2");
  });

  it("hydrates an error fallback and supports client reset", () => {
    const state = createNexus({ state: { broken: true } });
    const $ = bind(state);
    const Broken = () => {
      if ($.broken.get()) throw new Error("broken");
      return <p>Recovered</p>;
    };
    const App = () => (
      <ErrorBoundary
        fallback={(_error, reset) => (
          <button onClick={() => {
            state.set({ broken: false });
            reset();
          }}>
            Retry
          </button>
        )}
      >
        <Broken />
      </ErrorBoundary>
    );
    const host = document.createElement("div");
    host.innerHTML = renderToString(<App />, { hydration: true });
    const fallback = host.querySelector("button")!;

    const root = hydrate(<App />, host, { schedule: "manual" });

    expect(host.querySelector("button")).toBe(fallback);
    fallback.click();

    expect(host.querySelector("button")).toBe(null);
    expect(host.querySelector("p")?.textContent).toBe("Recovered");
    root.dispose();
  });

  it("does not turn a boundary hydration mismatch into a render fallback", () => {
    const Broken = () => {
      throw new Error("broken");
    };
    const App = () => (
      <ErrorBoundary fallback={<button>Fallback</button>}>
        <Broken />
      </ErrorBoundary>
    );
    const host = document.createElement("div");
    host.innerHTML = renderToString(<App />);
    host.querySelector("button")!.outerHTML = "<section>Mismatch</section>";
    const mismatch = host.querySelector("section")!;
    const errors = vi.fn();

    hydrate(<App />, host, { onError: errors });

    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({ code: "HYDRATION_MISMATCH" })
    );
    expect(host.querySelector("section")).toBe(null);
    expect(mismatch.isConnected).toBe(false);
    expect(host.querySelector("button")?.textContent).toBe("Fallback");
  });

  it("disposes partial behavior and replaces the root after a mismatch", () => {
    const click = vi.fn();
    const App = () => (
      <>
        <button onClick={click}>Action</button>
        <p>Expected</p>
      </>
    );
    const host = document.createElement("div");
    host.innerHTML = renderToString(<App />);
    host.querySelector("p")!.outerHTML = "<section>Unexpected</section>";
    const button = host.querySelector("button")!;
    const errors = vi.fn();

    hydrate(<App />, host, { onError: errors });

    expect(errors).toHaveBeenCalledWith(expect.any(NexusDOMError));
    expect((errors.mock.calls[0]![0] as NexusDOMError).code).toBe(
      "HYDRATION_MISMATCH"
    );
    button.click();
    expect(click).not.toHaveBeenCalled();
    expect(host.querySelector("section")).toBe(null);
    expect(host.querySelector("p")?.textContent).toBe("Expected");
    host.querySelector("button")!.click();
    expect(click).toHaveBeenCalledOnce();
  });
});
