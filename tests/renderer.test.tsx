/** @jsxImportSource nexus-dom */
import { describe, expect, it, vi } from "vitest";
import {
  bind,
  createApp,
  createNexus,
  createDOMRenderer,
  ErrorBoundary,
  NexusDOMError,
  onCleanup,
  render,
  Show,
  store,
  view,
  when,
  type CommitEvent,
  type LiveItem,
} from "nexus-dom";

describe("nexus-dom rendering model", () => {
  it("lazily resolves typed store views once per app", () => {
    let initializations = 0;
    const counter = store({
      state: { count: 1 },
      acts: (get, set) => {
        initializations++;
        return {
          increment() {
            set({ count: get("count") + 1 });
          },
        };
      },
    });
    const labels = store({ state: { label: "Count" } });
    const Counter = view(
      ({ state, acts }, { suffix }: { suffix?: string }) => (
        <button onClick={acts.increment}>
          {state.label}: {state.count}{suffix}
        </button>
      ),
      [counter, labels]
    );
    const Mirror = view(({ state }) => <output>{state.count}</output>, [counter]);
    const App = view(() => (
      <main><Counter suffix="!" /><Mirror /></main>
    ));
    const app = createApp();
    const host = document.createElement("div");

    expect(initializations).toBe(0);
    const root = app.render(<App />, host, { schedule: "manual" });
    expect(initializations).toBe(1);
    expect(host.textContent).toBe("Count: 1!1");

    host.querySelector("button")?.click();
    root.flush();
    expect(host.textContent).toBe("Count: 2!2");
    expect(initializations).toBe(1);

    const secondApp = createApp();
    const secondHost = document.createElement("div");
    secondApp.render(<Mirror />, secondHost);
    expect(secondHost.textContent).toBe("1");
    expect(initializations).toBe(2);
  });

  it("rejects store views outside an app and runtime key conflicts", () => {
    const left = store({ state: { value: 1 } });
    const right = store({ state: { value: 2 } });
    const Conflicted = (view as any)(
      ({ state }: any) => <p>{state.value}</p>,
      [left, right]
    );
    const Standalone = view(({ state }) => <p>{state.value}</p>, [left]);

    expect(() => render(<Standalone />, document.createElement("div"))).toThrowError(
      expect.objectContaining({ code: "STORE_VIEW_OUTSIDE_APP" })
    );
    expect(() =>
      createApp().render(<Conflicted />, document.createElement("div"))
    ).toThrowError(
      expect.objectContaining({ code: "STORE_DEPENDENCY_CONFLICT" })
    );
  });

  it("creates a complete app with reactive state and non-reactive refs", () => {
    const app = createApp({
      state: { count: 0 },
      refs: { runtimeCount: 0 },
      acts: (get, set, refs) => ({
        increment() {
          refs.runtimeCount.current++;
          set({ count: get("count") + 1 });
        },
      }),
    });
    const host = document.createElement("div");
    const commits = vi.fn();
    const root = app.render(<p>{app.$.count}</p>, host, {
      schedule: "manual",
      onCommit: commits,
    });

    app.refs.runtimeCount.current = 10;
    root.flush();
    expect(host.textContent).toBe("0");
    expect(commits).not.toHaveBeenCalled();

    app.acts.increment();
    root.flush();

    expect(host.textContent).toBe("1");
    expect(app.refs.runtimeCount.current).toBe(11);
    expect(app.nexus.get("count")).toBe(1);
  });

  it("renders tracked views with plain state and the complete app scope", () => {
    const app = createApp({
      state: {
        useCount: true,
        count: 1,
        label: "Ready",
        unrelated: 0,
      },
      refs: { marker: "runtime" },
      acts: (get, set) => ({
        increment() {
          set({ count: get("count") + 1 });
        },
      }),
    });
    const host = document.createElement("div");
    let runs = 0;
    const root = app.render(
      app.view(({ state, $, acts, refs }) => {
        runs++;
        expect($).toBe(app.$);
        expect(acts).toBe(app.acts);
        expect(refs).toBe(app.refs);
        return (
          <button onClick={acts.increment} data-marker={refs.marker.current}>
            {state.useCount ? state.count : state.label}
          </button>
        );
      }),
      host,
      { schedule: "manual" }
    );

    expect(runs).toBe(1);
    expect(host.textContent).toBe("1");
    expect(host.querySelector("button")?.dataset.marker).toBe("runtime");

    app.nexus.set({ unrelated: 1 });
    root.flush();
    expect(runs).toBe(1);

    host.querySelector("button")?.click();
    root.flush();
    expect(runs).toBe(2);
    expect(host.textContent).toBe("2");

    app.nexus.set({ useCount: false });
    app.nexus.set({ label: "Latest" });
    root.flush();
    expect(runs).toBe(3);
    expect(host.textContent).toBe("Latest");

    app.nexus.set({ count: 3 });
    root.flush();
    expect(runs).toBe(3);

    app.nexus.set({ label: "Updated" });
    root.flush();
    expect(runs).toBe(4);
    expect(host.textContent).toBe("Updated");
  });

  it("routes tracked view update errors through the surrounding boundary", () => {
    const app = createApp({ state: { broken: false } });
    const host = document.createElement("div");
    const root = app.render(
      <ErrorBoundary fallback={<p role="alert">View failed</p>}>
        {app.view(({ state }) => {
          if (state.broken) throw new Error("broken view");
          return <strong>Working</strong>;
        })}
      </ErrorBoundary>,
      host,
      { schedule: "manual" }
    );

    app.nexus.set({ broken: true });
    root.flush();

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "View failed"
    );
    expect(host.querySelector("strong")).toBeNull();
  });

  it("locally reconciles stable view elements, events and refs", () => {
    const app = createApp({
      state: { selected: 1, active: false },
      refs: {
        button: null as HTMLButtonElement | null,
        input: null as HTMLInputElement | null,
      },
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const selections: number[] = [];
    const root = app.render(
      app.view(({ state, refs }) => (
        <section class={state.active ? "active" : "idle"}>
          <input ref={refs.input} value={`Value ${state.selected}`} />
          <button
            data-selected={state.selected}
            ref={(node) => (refs.button.current = node as HTMLButtonElement | null)}
            onClick={() => selections.push(state.selected)}
          >
            {state.selected}
          </button>
        </section>
      )),
      host,
      { schedule: "manual" }
    );
    const section = host.querySelector("section");
    const input = host.querySelector("input");
    const first = host.querySelector("button");

    expect(app.refs.button.current).toBe(first);
    expect(app.refs.input.current).toBe(input);
    input?.focus();

    app.nexus.set({ selected: 2, active: true });
    root.flush();

    const second = host.querySelector("button");
    expect(host.querySelector("section")).toBe(section);
    expect(host.querySelector("input")).toBe(input);
    expect(second).toBe(first);
    expect(app.refs.button.current).toBe(second);
    expect(app.refs.input.current).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input?.value).toBe("Value 2");
    expect(section?.className).toBe("active");
    expect(second?.dataset.selected).toBe("2");
    expect(second?.textContent).toBe("2");

    second?.click();
    expect(selections).toEqual([2]);
    root.dispose();
    expect(app.refs.button.current).toBeNull();
    expect(app.refs.input.current).toBeNull();
    host.remove();
  });

  it("replaces a tracked view when its local shape or key changes", () => {
    const app = createApp({
      state: { expanded: false, version: 1 },
    });
    const host = document.createElement("div");
    const root = app.render(
      app.view(({ state }) => (
        <section key={state.version}>
          <strong>Stable root</strong>
          {state.expanded ? <span>Extra</span> : null}
        </section>
      )),
      host,
      { schedule: "manual" }
    );
    const collapsed = host.querySelector("section");

    app.nexus.set({ expanded: true });
    root.flush();
    const expanded = host.querySelector("section");

    expect(expanded).not.toBe(collapsed);
    expect(expanded?.textContent).toBe("Stable rootExtra");

    app.nexus.set({ version: 2 });
    root.flush();

    expect(host.querySelector("section")).not.toBe(expanded);
  });

  it("disposes every app root and setup resource", () => {
    const cleanup = vi.fn();
    const app = createApp({
      state: { count: 0 },
      setup({ onCleanup }) {
        onCleanup(cleanup);
      },
    });
    const firstHost = document.createElement("div");
    const secondHost = document.createElement("div");
    app.render(<p>{app.$.count}</p>, firstHost);
    app.render(<p>{app.$.count}</p>, secondHost);

    app.dispose();

    expect(firstHost.childNodes).toHaveLength(0);
    expect(secondHost.childNodes).toHaveLength(0);
    expect(cleanup).toHaveBeenCalledOnce();
    let thrown: unknown;
    try {
      app.render(<p />, firstHost);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NexusDOMError);
    expect(thrown).toMatchObject({ code: "APP_DISPOSED", name: "nexus-dom" });
    expect(String(thrown)).toBe(
      "nexus-dom: [APP_DISPOSED]\n" +
        "Cannot render a disposed app. app.dispose() has already run."
    );
  });

  it("applies typed list operations without rescanning every key", () => {
    const app = createApp({
      state: {
        items: [
          { id: 1, label: "First" },
          { id: 2, label: "Second" },
          { id: 3, label: "Third" },
        ],
      },
    });
    const host = document.createElement("div");
    const commits: CommitEvent<{ source: string }>[] = [];
    let keyCalls = 0;
    const root = app.render(
      <ul>
        {app.$.items.each(
          (item) => {
            keyCalls++;
            return item.id;
          },
          ($item) => <li data-id={$item.id}>{$item.label}</li>
        )}
      </ul>,
      host,
      {
        schedule: "manual",
        onCommit: (event) => commits.push(event),
      }
    );
    const thirdNode = host.querySelector('[data-id="3"]');
    keyCalls = 0;

    app.list("items").move(2, 0);
    root.flush();

    expect(keyCalls).toBe(1);
    expect(host.querySelector("li")).toBe(thirdNode);
    expect(commits.at(-1)?.contexts.at(-1)?.source).toBe("list.move");

    keyCalls = 0;
    app.list("items").append({ id: 4, label: "Fourth" });
    root.flush();
    expect(keyCalls).toBe(1);
    expect(host.querySelector('[data-id="4"]')?.textContent).toBe("Fourth");

    const firstNode = host.querySelector('[data-id="1"]');
    keyCalls = 0;
    app.list("items").batch((items) => {
      items.move(3, 0);
      items.replace(2, { id: 1, label: "First updated" });
      items.remove(3);
    });
    root.flush();

    expect(keyCalls).toBe(1);
    expect(host.querySelector('[data-id="1"]')).toBe(firstNode);
    expect(firstNode?.textContent).toBe("First updated");
    expect(
      Array.from(host.querySelectorAll("li"), (item) => item.dataset.id)
    ).toEqual(["4", "3", "1"]);
    const batchContext = commits.at(-1)?.contexts.at(-1) as
      | { source: string; meta?: Record<string, any> }
      | undefined;
    expect(batchContext?.source).toBe("list.batch");
    expect(batchContext?.meta?.nexusDOM.list.id).toEqual(expect.any(Number));
    expect(batchContext?.meta?.nexusDOM.list.operations).toHaveLength(3);
  });

  it("dispatches row and changed-field subscriptions independently", () => {
    const app = createApp({
      state: { items: [{ id: 1, label: "First" }] },
    });
    const host = document.createElement("div");
    const rowListener = vi.fn();
    const idListener = vi.fn();
    const labelListener = vi.fn();

    function Subscribed({ item }: { item: LiveItem<{ id: number; label: string }> }) {
      onCleanup(item.subscribe(rowListener));
      onCleanup(item.id.subscribe(idListener));
      onCleanup(item.label.subscribe(labelListener));
      return <span>{item.label}</span>;
    }

    const root = app.render(
      app.$.items.each(
        (item) => item.id,
        ($item) => <Subscribed item={$item} />
      ),
      host,
      { schedule: "manual" }
    );

    app.list("items").replace(0, { id: 1, label: "Updated" });
    root.flush();

    expect(rowListener).toHaveBeenCalledOnce();
    expect(idListener).not.toHaveBeenCalled();
    expect(labelListener).toHaveBeenCalledOnce();
    expect(host.textContent).toBe("Updated");
  });

  it("uses a longest increasing subsequence to minimize keyed moves", () => {
    const store = createNexus({
      state: {
        items: [
          { id: 1 },
          { id: 2 },
          { id: 3 },
          { id: 4 },
        ],
      },
    });
    const $ = bind(store);
    const renderer = createDOMRenderer({ schedule: "manual" });
    const host = document.createElement("div");
    renderer.mount(
      <ul>
        {$.items.each(
          (item) => item.id,
          ($item) => <li data-id={$item.id}>{$item.id}</li>
        )}
      </ul>,
      host
    );
    const list = host.querySelector("ul")!;
    const insertBefore = vi.spyOn(list, "insertBefore");
    const current = store.get("items");

    store.set({ items: [current[3]!, ...current.slice(0, 3)] });
    renderer.flush();

    expect(insertBefore).toHaveBeenCalledOnce();
    expect(
      Array.from(list.querySelectorAll("li"), (item) => item.dataset.id)
    ).toEqual(["4", "1", "2", "3"]);
  });

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

  it("creates SVG descendants in the SVG namespace", () => {
    const host = document.createElement("div");
    const renderer = createDOMRenderer();

    renderer.mount(
      <svg viewBox="0 0 10 10">
        <circle cx="5" cy="5" r="4" style={{ fill: "red" }} />
        <foreignObject>
          <div>HTML</div>
        </foreignObject>
      </svg>,
      host
    );

    expect(host.querySelector("svg")?.namespaceURI).toBe(
      "http://www.w3.org/2000/svg"
    );
    expect(host.querySelector("circle")?.namespaceURI).toBe(
      "http://www.w3.org/2000/svg"
    );
    expect(host.querySelector("circle")?.getAttribute("style")).toContain(
      "fill: red"
    );
    expect(host.querySelector("foreignObject div")?.namespaceURI).toBe(
      "http://www.w3.org/1999/xhtml"
    );
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

  it("can align a deduplicated commit to an animation frame", () => {
    const store = createNexus({ state: { value: 0 } });
    const $ = bind(store);
    const host = document.createElement("div");
    let frame: FrameRequestCallback | undefined;
    const requestFrame = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frame = callback;
        return 1;
      });
    const renderer = createDOMRenderer({ schedule: "animationFrame" });
    renderer.mount(<p>{$.value}</p>, host);

    store.set({ value: 1 });
    store.set({ value: 2 });
    expect(host.textContent).toBe("0");
    expect(requestFrame).toHaveBeenCalledOnce();

    frame?.(performance.now());
    expect(host.textContent).toBe("2");
    requestFrame.mockRestore();
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

  it("cleans an owner when initial component mounting throws", () => {
    const cleanup = vi.fn();
    const renderer = createDOMRenderer();
    const host = document.createElement("div");

    function Broken(): never {
      onCleanup(cleanup);
      throw new Error("mount failed");
    }

    expect(() => renderer.mount(<Broken />, host)).toThrow("mount failed");
    expect(cleanup).toHaveBeenCalledOnce();
    expect(host.childNodes).toHaveLength(0);
  });

  it("cleans completed keyed rows when a later initial row throws", () => {
    const firstCleanup = vi.fn();
    const app = createApp({
      state: {
        items: [
          { id: 1, broken: false },
          { id: 2, broken: true },
        ],
      },
    });
    const host = document.createElement("div");

    function Row({ id, broken }: { id: number; broken: boolean }) {
      if (id === 1) onCleanup(firstCleanup);
      if (broken) throw new Error("keyed mount failed");
      return <span>{id}</span>;
    }

    expect(() =>
      app.render(
        app.$.items.each(
          (item) => item.id,
          ($item) => (
            <Row id={$item.id.get()} broken={$item.broken.get()} />
          )
        ),
        host
      )
    ).toThrow("keyed mount failed");
    expect(firstCleanup).toHaveBeenCalledOnce();
    expect(host.childNodes).toHaveLength(0);
  });

  it("renders a local fallback and cleans a failed initial subtree", () => {
    const cleanup = vi.fn();
    const onError = vi.fn();
    const renderer = createDOMRenderer({ onError });
    const host = document.createElement("div");

    function Broken(): never {
      onCleanup(cleanup);
      throw new Error("initial boundary failure");
    }

    renderer.mount(
      <ErrorBoundary
        fallback={(error) => <p role="alert">{(error as Error).message}</p>}
      >
        <Broken />
      </ErrorBoundary>,
      host
    );

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "initial boundary failure"
    );
    expect(cleanup).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("recovers a failed reactive subtree through the boundary reset", () => {
    const store = createNexus({ state: { value: 1, sibling: "before" } });
    const $ = bind(store);
    const onError = vi.fn();
    const renderer = createDOMRenderer({ schedule: "manual", onError });
    const host = document.createElement("div");

    renderer.mount(
      [
        <ErrorBoundary
          fallback={(error, reset) => (
            <button onClick={reset}>{(error as Error).message}</button>
          )}
        >
          {$.value.render((value) => {
            if (value < 0) throw new Error("reactive boundary failure");
            return <strong>{value}</strong>;
          })}
        </ErrorBoundary>,
        <span>{$.sibling}</span>,
      ],
      host
    );

    store.set({ value: -1, sibling: "after" });
    renderer.flush();

    expect(host.querySelector("strong")).toBeNull();
    expect(host.querySelector("button")?.textContent).toBe(
      "reactive boundary failure"
    );
    expect(host.querySelector("span")?.textContent).toBe("after");
    expect(onError).not.toHaveBeenCalled();

    store.set({ value: 2 });
    renderer.flush();
    host.querySelector("button")?.click();

    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("strong")?.textContent).toBe("2");
  });

  it("propagates a failed fallback to the next boundary", () => {
    const renderer = createDOMRenderer();
    const host = document.createElement("div");

    function Broken(): never {
      throw new Error("child failed");
    }

    renderer.mount(
      <ErrorBoundary
        fallback={(error) => <p>Outer: {(error as Error).message}</p>}
      >
        <ErrorBoundary
          fallback={() => {
            throw new Error("fallback failed");
          }}
        >
          <Broken />
        </ErrorBoundary>
      </ErrorBoundary>,
      host
    );

    expect(host.textContent).toBe("Outer: fallback failed");
  });

  it("routes keyed row update errors through the surrounding boundary", () => {
    const app = createApp({
      state: { items: [{ id: 1, value: 1 }] },
    });
    const host = document.createElement("div");
    const root = app.render(
      <ErrorBoundary fallback={<p>List failed</p>}>
        {app.$.items.each(
          (item) => item.id,
          (item) =>
            item.render((value) => {
              if (value.value < 0) throw new Error("row failed");
              return <strong>{value.value}</strong>;
            })
        )}
      </ErrorBoundary>,
      host,
      { schedule: "manual" }
    );

    app.list("items").replace(0, { id: 1, value: -1 });
    root.flush();

    expect(host.textContent).toBe("List failed");
  });

  it("keeps the previous branch and continues a commit after an update error", () => {
    const store = createNexus({ state: { branch: 1, sibling: "before" } });
    const $ = bind(store);
    const onError = vi.fn();
    const renderer = createDOMRenderer({ schedule: "manual", onError });
    const host = document.createElement("div");

    renderer.mount(
      [
        $.branch.render((value) => {
          if (value < 0) throw new Error("branch failed");
          return <strong>{value}</strong>;
        }),
        <span>{$.sibling}</span>,
      ],
      host
    );
    const previousBranch = host.querySelector("strong");

    store.set({ branch: -1, sibling: "after" });
    renderer.flush();

    expect(onError).toHaveBeenCalledOnce();
    expect(host.querySelector("strong")).toBe(previousBranch);
    expect(previousBranch?.textContent).toBe("1");
    expect(host.querySelector("span")?.textContent).toBe("after");
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
    const comments = document.createTreeWalker(host, NodeFilter.SHOW_COMMENT);
    expect(comments.nextNode()).toBeNull();

    store.set({ authorized: true }, "login");
    renderer.flush();

    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("h2")?.textContent).toBe("Profile");
    expect(loginCleanup).toHaveBeenCalledOnce();
    const updatedComments = document.createTreeWalker(
      host,
      NodeFilter.SHOW_COMMENT
    );
    expect(updatedComments.nextNode()).toBeNull();
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

  it("keeps a dynamic branch while its structural key is equal", () => {
    const store = createNexus({ state: { count: 1 } });
    const $ = bind(store);
    const renderer = createDOMRenderer({ schedule: "manual" });
    const host = document.createElement("div");
    const cleanup = vi.fn();

    function Positive() {
      onCleanup(cleanup);
      return <strong>Positive</strong>;
    }

    renderer.mount(
      $.count.render(
        (count) => (count >= 0 ? <Positive /> : <em>Negative</em>),
        { key: (count) => count >= 0 }
      ),
      host
    );
    const branch = host.querySelector("strong");

    store.set({ count: 2 });
    renderer.flush();
    expect(host.querySelector("strong")).toBe(branch);
    expect(cleanup).not.toHaveBeenCalled();

    store.set({ count: -1 });
    renderer.flush();
    expect(host.querySelector("strong")).toBeNull();
    expect(host.querySelector("em")?.textContent).toBe("Negative");
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("switches a when branch only when source truthiness changes", () => {
    const app = createApp({ state: { count: 1 } });
    const host = document.createElement("div");
    const positiveCleanup = vi.fn();

    function Positive() {
      onCleanup(positiveCleanup);
      return <strong>Positive</strong>;
    }

    const root = app.render(
      when(app.$.count, <Positive />, <em>Not positive</em>),
      host,
      { schedule: "manual" }
    );
    const positive = host.querySelector("strong");

    app.nexus.set({ count: 2 });
    root.flush();
    expect(host.querySelector("strong")).toBe(positive);
    expect(positiveCleanup).not.toHaveBeenCalled();

    app.nexus.set({ count: 0 });
    root.flush();
    expect(host.textContent).toBe("Not positive");
    expect(positiveCleanup).toHaveBeenCalledOnce();
  });

  it("preserves keyed rows while reordering and removes owned rows", () => {
    const first = { id: 1, label: "First" };
    const second = { id: 2, label: "Second" };
    const store = createNexus({ state: { items: [first, second] } });
    const $ = bind(store);
    const renderer = createDOMRenderer({ schedule: "manual" });
    const host = document.createElement("div");
    const cleanups = new Map<number, ReturnType<typeof vi.fn>>();

    function Row({ item }: { item: LiveItem<{ id: number; label: string }> }) {
      const cleanup = vi.fn();
      cleanups.set(item.id.get(), cleanup);
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
    const comments = document.createTreeWalker(host, NodeFilter.SHOW_COMMENT);
    expect(comments.nextNode()).toBeNull();
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

  it("updates a keyed row without replacing its DOM or focus", () => {
    const first = { id: 1, label: "First" };
    const second = { id: 2, label: "Second" };
    const store = createNexus({ state: { items: [first, second] } });
    const $ = bind(store);
    const renderer = createDOMRenderer({ schedule: "manual" });
    const host = document.createElement("div");
    document.body.appendChild(host);

    renderer.mount(
      $.items.each(
        (item) => item.id,
        (item) => (
          <label data-id={item.id}>
            <input value={item.label} />
            <span>{item.label}</span>
          </label>
        )
      ),
      host
    );

    const firstNode = host.querySelector('[data-id="1"]');
    const secondNode = host.querySelector('[data-id="2"]');
    const secondInput = secondNode?.querySelector("input");
    secondInput?.focus();
    const [storedFirst, storedSecond] = store.get("items");
    store.set({
      items: [storedFirst!, { ...storedSecond!, label: "Updated" }],
    });
    renderer.flush();

    expect(host.querySelector('[data-id="1"]')).toBe(firstNode);
    expect(host.querySelector('[data-id="2"]')).toBe(secondNode);
    expect(host.querySelector('[data-id="2"]')?.textContent).toBe("Updated");
    expect(secondInput?.value).toBe("Updated");
    expect(document.activeElement).toBe(secondInput);
    host.remove();
  });

  it("moves and removes keyed rows with multiple root nodes", () => {
    const app = createApp({
      state: {
        items: [
          { id: 1, label: "First" },
          { id: 2, label: "Second" },
        ],
      },
    });
    const host = document.createElement("div");
    const root = app.render(
      app.$.items.each(
        (item) => item.id,
        ($item) => (
          <>
            <span data-id={$item.id}>{$item.label}</span>
            <i data-tail={$item.id}>tail</i>
          </>
        )
      ),
      host,
      { schedule: "manual" }
    );
    const secondHead = host.querySelector('[data-id="2"]');
    const secondTail = host.querySelector('[data-tail="2"]');

    app.list("items").move(1, 0);
    root.flush();

    expect(Array.from(host.children)).toEqual([
      secondHead,
      secondTail,
      host.querySelector('[data-id="1"]'),
      host.querySelector('[data-tail="1"]'),
    ]);

    app.list("items").remove(0);
    root.flush();

    expect(secondHead?.isConnected).toBe(false);
    expect(secondTail?.isConnected).toBe(false);
    expect(host.children).toHaveLength(2);
  });

  it("reads item fields that collide with LiveValue methods", () => {
    const app = createApp({
      state: { items: [{ id: 1, get: "Initial" }] },
    });
    const host = document.createElement("div");
    const root = app.render(
      app.$.items.each(
        (item) => item.id,
        ($item) => <span>{$item.$field("get")}</span>
      ),
      host,
      { schedule: "manual" }
    );
    const span = host.querySelector("span");

    app.list("items").replace(0, { id: 1, get: "Updated" });
    root.flush();

    expect(host.querySelector("span")).toBe(span);
    expect(span?.textContent).toBe("Updated");
  });
});
