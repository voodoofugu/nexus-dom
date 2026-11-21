/** @jsxImportSource nexus-dom */
import { createNexus } from "nexus-state";
import { describe, expect, it, vi } from "vitest";
import {
  bind,
  createDOMRenderer,
  onCleanup,
  type CommitEvent,
} from "nexus-dom";

describe("nexus-dom rendering model", () => {
  it("updates one text binding without executing the component again", () => {
    const counter = createNexus({
      state: { count: 0 },
      acts: (get, set) => ({
        increment() {
          set({ count: get("count") + 1 });
        },
      }),
    });
    const $ = bind(counter);
    const renderer = createDOMRenderer({ schedule: "manual" });
    const host = document.createElement("div");
    let componentRuns = 0;

    function Counter() {
      componentRuns++;
      return (
        <button onClick={counter.acts.increment}>Clicks: {$.count}</button>
      );
    }

    renderer.mount(<Counter />, host);
    const button = host.querySelector("button")!;

    expect(button.textContent).toBe("Clicks: 0");
    button.click();
    renderer.flush();

    expect(button.textContent).toBe("Clicks: 1");
    expect(host.querySelector("button")).toBe(button);
    expect(componentRuns).toBe(1);
  });

  it("updates DOM properties from live values", () => {
    const store = createNexus({ state: { pending: false } });
    const $ = bind(store);
    const renderer = createDOMRenderer({ schedule: "manual" });
    const host = document.createElement("div");

    renderer.mount(<button disabled={$.pending}>Save</button>, host);
    const button = host.querySelector("button")!;
    expect(button.disabled).toBe(false);

    store.set({ pending: true });
    renderer.flush();
    expect(button.disabled).toBe(true);
  });

  it("tracks only keys read by a selector", () => {
    const store = createNexus({
      state: { first: "Ada", last: "Lovelace", unrelated: 0 },
    });
    const $ = bind(store);
    const commits = vi.fn();
    const renderer = createDOMRenderer({
      schedule: "manual",
      onCommit: commits,
    });
    const host = document.createElement("div");
    const fullName = $.$select((state) => `${state.first} ${state.last}`);

    renderer.mount(<p>{fullName}</p>, host);
    store.set({ unrelated: 1 });
    renderer.flush();

    expect(commits).not.toHaveBeenCalled();
    expect(host.textContent).toBe("Ada Lovelace");

    store.set({ last: "Byron" });
    renderer.flush();
    expect(host.textContent).toBe("Ada Byron");
    expect(commits).toHaveBeenCalledOnce();
  });

  it("changes selector dependencies when a conditional branch changes", () => {
    const store = createNexus({
      state: { useA: true, a: "A", b: "B" },
    });
    const $ = bind(store);
    const renderer = createDOMRenderer({ schedule: "manual" });
    const host = document.createElement("div");
    const selected = $.$select((state) => (state.useA ? state.a : state.b));

    renderer.mount(<p>{selected}</p>, host);
    store.set({ useA: false });
    renderer.flush();
    expect(host.textContent).toBe("B");

    store.set({ a: "ignored" });
    renderer.flush();
    expect(host.textContent).toBe("B");

    store.set({ b: "next" });
    renderer.flush();
    expect(host.textContent).toBe("next");
  });

  it("deduplicates repeated changes before a microtask commit", async () => {
    const store = createNexus({ state: { count: 0 } });
    const $ = bind(store);
    const commits = vi.fn();
    const renderer = createDOMRenderer({ onCommit: commits });
    const host = document.createElement("div");

    renderer.mount(<p>{$.count}</p>, host);
    store.set({ count: 1 });
    store.set({ count: 2 });
    store.set({ count: 3 });

    expect(host.textContent).toBe("0");
    await Promise.resolve();

    expect(host.textContent).toBe("3");
    expect(commits).toHaveBeenCalledTimes(1);
    expect(commits.mock.calls[0]?.[0].updates).toBe(1);
  });

  it("preserves update provenance in commit events", () => {
    type Context = { source: string; meta?: Record<string, unknown> };
    const store = createNexus({ state: { value: 0 } });
    const $ = bind(store);
    const events: CommitEvent<Context>[] = [];
    const renderer = createDOMRenderer<Context>({
      schedule: "manual",
      onCommit: (event) => events.push(event),
    });
    const host = document.createElement("div");

    renderer.mount(<p>{$.value}</p>, host);
    store.set(
      { value: 1 },
      { source: "server", meta: { requestId: 7 } }
    );
    renderer.flush();

    expect(events).toEqual([
      {
        updates: 1,
        contexts: [{ source: "server", meta: { requestId: 7 } }],
      },
    ]);
  });

  it("removes subscriptions, events, DOM and component cleanup on dispose", () => {
    const store = createNexus({ state: { count: 0 } });
    const $ = bind(store);
    const renderer = createDOMRenderer({ schedule: "manual" });
    const host = document.createElement("div");
    const event = vi.fn();
    const cleanup = vi.fn();

    function View() {
      onCleanup(cleanup);
      return <button onClick={event}>{$.count}</button>;
    }

    const root = renderer.mount(<View />, host);
    const button = host.querySelector("button")!;
    root.dispose();

    button.click();
    store.set({ count: 1 });
    renderer.flush();

    expect(host.childNodes).toHaveLength(0);
    expect(event).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
