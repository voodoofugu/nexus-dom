/** @jsxImportSource nexus-dom */
import { describe, expect, it, vi } from "vitest";
import {
  bind,
  createApp,
  createNexus,
  hydrate,
  NexusDOMError,
  store,
  view,
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

  it("disposes partial client behavior after a hydration mismatch", () => {
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

    let error: unknown;
    try {
      hydrate(<App />, host);
    } catch (nextError) {
      error = nextError;
    }

    expect(error).toBeInstanceOf(NexusDOMError);
    expect((error as NexusDOMError).code).toBe("HYDRATION_MISMATCH");
    button.click();
    expect(click).not.toHaveBeenCalled();
    expect(host.querySelector("section")).not.toBe(null);
  });
});
