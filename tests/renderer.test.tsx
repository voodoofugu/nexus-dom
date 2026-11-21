/** @jsxImportSource nexus-dom */
import { describe, expect, it, vi } from "vitest";
import {
  bind,
  createNexus,
  createDOMRenderer,
  onCleanup,
  render,
  Show,
  type CommitEvent,
} from "nexus-dom";

describe("nexus-dom rendering model", () => {
  it("returns one stable binding for the same Nexus store", () => {
    const store = createNexus({ state: { count: 0 } });

    const first = bind(store);
    const second = bind(store);

    expect(second).toBe(first);
    expect(second.count).toBe(first.count);
  });

  it("mounts through the public render facade", () => {
    const store = createNexus({ state: { count: 0 } });
    const $ = bind(store);
    const host = document.createElement("div");
    host.id = "render-facade-test";
    document.body.appendChild(host);

    const root = render(<p>{$.count}</p>, "#render-facade-test", {
      schedule: "manual",
    });
    store.set({ count: 1 });
    root.flush();

    expect(host.textContent).toBe("1");
    root.dispose();
    host.remove();
  });

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

  it("replaces an owned Show branch and cleans up the removed component", () => {
    const store = createNexus({ state: { visible: true } });
    const $ = bind(store);
    const renderer = createDOMRenderer({ schedule: "manual" });
    const host = document.createElement("div");
    const cleanup = vi.fn();
    let visibleRuns = 0;

    function Visible() {
      visibleRuns++;
      onCleanup(cleanup);
      return <strong>Visible branch</strong>;
    }

    renderer.mount(
      <Show when={$.visible} fallback={<em>Hidden branch</em>}>
        <Visible />
      </Show>,
      host
    );

    const visibleNode = host.querySelector("strong");
    expect(visibleNode?.textContent).toBe("Visible branch");

    store.set({ visible: false }, "hide");
    renderer.flush();

    expect(host.querySelector("strong")).toBeNull();
    expect(host.querySelector("em")?.textContent).toBe("Hidden branch");
    expect(cleanup).toHaveBeenCalledOnce();

    store.set({ visible: true }, "show");
    renderer.flush();

    expect(host.querySelector("strong")?.textContent).toBe("Visible branch");
    expect(host.querySelector("strong")).not.toBe(visibleNode);
    expect(visibleRuns).toBe(2);
  });

  it("renders an ordinary ternary inside a live structural region", () => {
    const store = createNexus({ state: { authorized: false } });
    const $ = bind(store);
    const renderer = createDOMRenderer({ schedule: "manual" });
    const host = document.createElement("div");
    const loginCleanup = vi.fn();

    function Login() {
      onCleanup(loginCleanup);
      return <button>Log in</button>;
    }

    function Profile() {
      return <h2>Profile</h2>;
    }

    renderer.mount(
      $.authorized.render((authorized) =>
        authorized ? <Profile /> : <Login />
      ),
      host
    );

    expect(host.querySelector("button")?.textContent).toBe("Log in");

    store.set({ authorized: true }, "login");
    renderer.flush();

    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("h2")?.textContent).toBe("Profile");
    expect(loginCleanup).toHaveBeenCalledOnce();
  });

  it("does not replace a rendered branch while a mapped condition is equal", () => {
    const store = createNexus({ state: { count: 1 } });
    const $ = bind(store);
    const positive = $.count.map((count) => count >= 0);
    const commits = vi.fn();
    const renderer = createDOMRenderer({
      schedule: "manual",
      onCommit: commits,
    });
    const host = document.createElement("div");

    renderer.mount(
      positive.render((isPositive) =>
        isPositive ? <strong>Positive</strong> : <em>Negative</em>
      ),
      host
    );

    const positiveNode = host.querySelector("strong");
    store.set({ count: 2 });
    renderer.flush();

    expect(host.querySelector("strong")).toBe(positiveNode);
    expect(commits).not.toHaveBeenCalled();

    store.set({ count: -1 });
    renderer.flush();

    expect(host.querySelector("strong")).toBeNull();
    expect(host.querySelector("em")?.textContent).toBe("Negative");
    expect(commits).toHaveBeenCalledOnce();
  });

  it("preserves keyed rows while reordering and removes owned rows", () => {
    const first = { id: 1, label: "First" };
    const second = { id: 2, label: "Second" };
    const store = createNexus({ state: { items: [first, second] } });
    const $ = bind(store);
    const renderer = createDOMRenderer({ schedule: "manual" });
    const host = document.createElement("div");
    const cleanups = new Map<number, ReturnType<typeof vi.fn>>();

    function Row({ item }: { item: { id: number; label: string } }) {
      const cleanup = vi.fn();
      cleanups.set(item.id, cleanup);
      onCleanup(cleanup);
      return <li data-id={item.id}>{item.label}</li>;
    }

    renderer.mount(
      <ul>
        {$.items.each(
          (item) => item.id,
          (item) => <Row item={item} />
        )}
      </ul>,
      host
    );

    const firstNode = host.querySelector('[data-id="1"]');
    const secondNode = host.querySelector('[data-id="2"]');
    const [storedFirst, storedSecond] = store.get("items");

    store.set({ items: [storedSecond!, storedFirst!] });
    renderer.flush();

    expect(Array.from(host.querySelectorAll("li"))).toEqual([
      secondNode,
      firstNode,
    ]);
    expect(cleanups.get(1)).not.toHaveBeenCalled();
    expect(cleanups.get(2)).not.toHaveBeenCalled();

    store.set({ items: [storedSecond!] });
    renderer.flush();

    expect(host.querySelector('[data-id="1"]')).toBeNull();
    expect(cleanups.get(1)).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-id="2"]')).toBe(secondNode);
  });

  it("rerenders only a keyed row whose item value changed", () => {
    const first = { id: 1, label: "First" };
    const second = { id: 2, label: "Second" };
    const store = createNexus({ state: { items: [first, second] } });
    const $ = bind(store);
    const renderer = createDOMRenderer({ schedule: "manual" });
    const host = document.createElement("div");

    renderer.mount(
      $.items.each(
        (item) => item.id,
        (item) => <p data-id={item.id}>{item.label}</p>
      ),
      host
    );

    const firstNode = host.querySelector('[data-id="1"]');
    const secondNode = host.querySelector('[data-id="2"]');
    const [storedFirst, storedSecond] = store.get("items");
    store.set({
      items: [storedFirst!, { ...storedSecond!, label: "Updated" }],
    });
    renderer.flush();

    expect(host.querySelector('[data-id="1"]')).toBe(firstNode);
    expect(host.querySelector('[data-id="2"]')).not.toBe(secondNode);
    expect(host.querySelector('[data-id="2"]')?.textContent).toBe("Updated");
  });
});
