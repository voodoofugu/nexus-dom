/** @jsxImportSource nexus-dom */
import { bind } from "../src/live.js";
import { createDOMRenderer } from "../src/renderer.js";
import { render } from "../src/render.js";
import { createNexus } from "nexus-state";
import { createListHelpers } from "../src/list.js";
import { describe, expect, it, vi } from "vitest";
import {
  createApp,
  ErrorBoundary,
  NexusDOMError,
  onCleanup,
  store,
  component,
  type CommitEvent,
  type LiveItem,
  type ListController,
} from "nexus-dom";

describe("nexus-dom rendering model", () => {
  it("mounts an application in one call and disposes its root and stores", async () => {
    const cleanup = vi.fn();
    const counter = store({ state: { visible: false }, setup: () => cleanup });
    const Counter = component(({ $ }) => (
      <button onClick={() => $.visible.set(true)}>
        {$.visible.if(<strong>Ready</strong>, "Start")}
      </button>
    ), [counter]);
    const host = document.createElement("div");

    const app = createApp(<Counter />, host);
    const button = host.querySelector("button")!;
    expect(button.textContent).toBe("Start");
    button.click();
    await Promise.resolve();
    expect(button.querySelector("strong")?.textContent).toBe("Ready");

    app.dispose();
    expect(host.childNodes).toHaveLength(0);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("disposes resolved stores when the first mount fails", () => {
    const cleanup = vi.fn();
    const failure = new Error("first mount failed");
    const data = store({ state: { label: "Ready" }, setup: () => cleanup });
    const Label = component(({ state }) => <p>{state.label}</p>, [data]);
    const Broken = () => { throw failure; };
    const host = document.createElement("div");

    expect(() => createApp(<><Label /><Broken /></>, host)).toThrow(failure);
    expect(host.childNodes).toHaveLength(0);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("keeps declared store scope independent of JSX ancestry", () => {
    const titleStates = store({ state: { title: "Title" } });
    const subTitleStates = store({ state: { subtitle: "Subtitle" } });
    const SubTitle = component(({ state }) => {
      // @ts-expect-error A parent's descriptor does not widen this scope.
      const inherited = state.title;
      return <p>{state.subtitle}: {inherited ?? "missing"}</p>;
    }, [subTitleStates]);
    const SharedSubTitle = component(
      ({ state }) => <p>{state.subtitle}: {state.title}</p>,
      [subTitleStates, titleStates]
    );
    const Title = component(({ $, state }) => (
      <div>
        <h1>{state.title}</h1>
        <SubTitle />
        <SharedSubTitle />
        <button onClick={() => $.title.set("Updated")}>Rename</button>
      </div>
    ), [titleStates]);
    const app = createApp();
    const host = document.createElement("div");
    const root = app.render(<Title />, host, { schedule: "manual" });
    const subtitles = () => Array.from(host.querySelectorAll("p"), (node) => node.textContent);
    expect(subtitles()).toEqual(["Subtitle: missing", "Subtitle: Title"]);
    host.querySelector("button")!.click();
    root.flush();
    expect(subtitles()).toEqual(["Subtitle: missing", "Subtitle: Updated"]);
    app.dispose();
  });

  it("lazily resolves typed store views once per app", () => {
    let initializations = 0;
    const counter = store({
      state: { count: 1 },
      acts: ({ get, set, reset }) => {
        initializations++;
        return {
          increment() {
            set({ count: get("count") + 1 });
          },
          resetCount() {
            reset("count");
          },
        };
      },
    });
    const labels = store({ state: { label: "Count" } });
    let counterRuns = 0;
    const Counter = component(
      ({ state, $, acts }, { suffix }: { suffix?: string }) => {
        counterRuns++;
        return (
          <section>
            <button onClick={acts.increment}>
              {state.label}: {$.count}{suffix}
            </button>
            <button
              aria-label="Direct increment"
              onClick={() => $.count.set((count) => count + 1)}
            />
          </section>
        );
      },
      [counter, labels]
    );
    const Mirror = component(({ state }) => <output>{state.count}</output>, [counter]);
    const Reset = component(
      ({ acts }) => <button aria-label="Reset" onClick={acts.resetCount} />,
      [counter]
    );
    const App = component(() => (
      <main><Counter suffix="!" /><Mirror /><Reset /></main>
    ));
    const app = createApp();
    const host = document.createElement("div");

    expect(initializations).toBe(0);
    const root = app.render(<App />, host, { schedule: "manual" });
    expect(initializations).toBe(1);
    expect(host.textContent).toBe("Count: 1!1");
    expect(counterRuns).toBe(1);

    host.querySelector<HTMLButtonElement>('[aria-label="Direct increment"]')?.click();
    root.flush();
    expect(host.textContent).toBe("Count: 2!2");
    expect(counterRuns).toBe(1);

    host.querySelector("button")?.click();
    root.flush();
    expect(host.textContent).toBe("Count: 3!3");
    expect(initializations).toBe(1);
    expect(counterRuns).toBe(1);

    host.querySelector<HTMLButtonElement>('[aria-label="Reset"]')?.click();
    root.flush();
    expect(host.textContent).toBe("Count: 1!1");
    expect(counterRuns).toBe(1);

    const secondApp = createApp();
    const secondHost = document.createElement("div");
    secondApp.render(<Mirror />, secondHost);
    expect(secondHost.textContent).toBe("1");
    expect(initializations).toBe(2);
  });

  it("rejects store views outside an app and runtime key conflicts", () => {
    const left = store({ state: { value: 1 } });
    const right = store({ state: { value: 2 } });
    const Conflicted = (component as any)(
      ({ state }: any) => <p>{state.value}</p>,
      [left, right]
    );
    const Standalone = component(({ state }) => <p>{state.value}</p>, [left]);

    expect(() => render(<Standalone />, document.createElement("div"))).toThrowError(
      expect.objectContaining({ code: "STORE_VIEW_OUTSIDE_APP" })
    );
    expect(() =>
      createApp().render(<Conflicted />, document.createElement("div"))
    ).toThrowError(
      expect.objectContaining({ code: "STORE_DEPENDENCY_CONFLICT" })
    );
  });

  it("supports store action dependencies and disposes lazy setup", () => {
    const cleanup = vi.fn();
    const session = store({
      state: { currentUser: "Georg" },
      acts: ({ set }) => ({
        renameUser(currentUser: string) {
          set({ currentUser });
        },
      }),
    });
    const issues = store(
      {
        state: { assignee: "Unassigned" },
        acts: ({ set, dependencies }) => ({
          assignCurrentUser() {
            set({ assignee: dependencies.get("currentUser") });
          },
        }),
        setup() {
          return cleanup;
        },
      },
      [session]
    );
    const Panel = component(
      ({ state, acts }) => (
        <button onClick={acts.assignCurrentUser}>
          {state.currentUser}: {state.assignee}
        </button>
      ),
      [session, issues]
    );
    const app = createApp();
    const host = document.createElement("div");
    const root = app.render(<Panel />, host, { schedule: "manual" });

    expect(host.textContent).toBe("Georg: Unassigned");
    host.querySelector("button")?.click();
    root.flush();
    expect(host.textContent).toBe("Georg: Georg");
    expect(cleanup).not.toHaveBeenCalled();

    app.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("coalesces synchronous cross-store actions into one view pass", () => {
    const profile = store({
      state: { name: "Georg" },
      acts: ({ set }) => ({
        rename(name: string) {
          set({ name });
        },
      }),
    });
    const task = store(
      {
        state: { done: false },
        acts: ({ set, dependencies }) => ({
          completeAs(name: string) {
            dependencies.acts.rename(name);
            set({ done: true });
          },
        }),
      },
      [profile]
    );
    let runs = 0;
    const Panel = component(
      ({ state, acts }) => {
        runs++;
        return (
          <button onClick={() => acts.completeAs("Ada")}>
            {state.name}: {String(state.done)}
          </button>
        );
      },
      [profile, task]
    );
    const commits = vi.fn();
    const host = document.createElement("div");
    const root = createApp().render(<Panel />, host, {
      schedule: "manual",
      onCommit: commits,
    });

    host.querySelector("button")!.click();
    expect(host.textContent).toBe("Georg: false");
    root.flush();

    expect(host.textContent).toBe("Ada: true");
    expect(runs).toBe(2);
    expect(commits).toHaveBeenCalledOnce();
    expect(commits.mock.calls[0]![0]).toMatchObject({
      updates: 1,
      contexts: [{ source: "completeAs" }],
    });
  });

  it("rejects cyclic store dependencies", () => {
    const leftDependencies: any[] = [];
    const left = store({ state: { left: true } }, leftDependencies);
    const right = store({ state: { right: true } }, [left]);
    leftDependencies.push(right);
    const Cyclic = component(({ state }) => <p>{String(state.left)}</p>, [left]);

    expect(() =>
      createApp().render(<Cyclic />, document.createElement("div"))
    ).toThrowError(
      expect.objectContaining({ code: "STORE_DEPENDENCY_CYCLE" })
    );
  });

  it("cleans partial store setup when initialization fails", () => {
    const cleanup = vi.fn();
    const broken = store({
      state: { ready: false },
      setup({ onCleanup }) {
        onCleanup(cleanup);
        throw new Error("setup failed");
      },
    });
    const Broken = component(({ state }) => <p>{String(state.ready)}</p>, [broken]);

    expect(() =>
      createApp().render(<Broken />, document.createElement("div"))
    ).toThrow("setup failed");
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("creates stable prefixed ids for component instances", () => {
    const values = store({
      state: { value: 1 },
      acts: ({ set }) => ({ setValue(value: number) { set({ value }); } }),
    });
    const Field = component(
      ({ id, state }, { name }: { name: string }) => {
        const inputId = id("input");
        expect(id("input")).toBe(inputId);
        return <label for={inputId}>{name}<input id={inputId} value={state.value} /></label>;
      },
      [values]
    );
    const App = component(() => <main><Field name="First" /><Field name="Second" /></main>);
    const app = createApp();
    const host = document.createElement("div");
    const root = app.render(<App />, host, { schedule: "manual", idPrefix: "account" });
    const before = Array.from(host.querySelectorAll("input"), (input) => input.id);

    expect(before).toHaveLength(2);
    expect(new Set(before).size).toBe(2);
    expect(before.every((id) => /^nxs-[A-Za-z0-9]{7}$/.test(id))).toBe(true);
    // Update through the writable binding path used by the public component scope.
    const Increment = component(({ $ }) => <button onClick={() => $.value.set(2)} />, [values]);
    const controlHost = document.createElement("div");
    const control = app.render(<Increment />, controlHost, { schedule: "manual" });
    controlHost.querySelector("button")?.click();
    control.flush();
    root.flush();

    expect(Array.from(host.querySelectorAll("input"), (input) => input.id)).toEqual(before);
  });

  it("preserves component ids through keyed moves", () => {
    const items = store({
      state: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      acts: ({ list }) => ({ reverse() { list("items").reverse(); } }),
    });
    const Row = component(
      ({ id }, { itemId }: { itemId: number }) =>
        <li id={id("row")} data-item={itemId}>{itemId}</li>
    );
    const List = component(
      ({ $, acts }) => (
        <section>
          <button onClick={acts.reverse}>Reverse</button>
          <ul>{$.items.each((item) => item.id, ($item) => <Row itemId={$item.id.get()} />)}</ul>
        </section>
      ),
      [items]
    );
    const app = createApp();
    const host = document.createElement("div");
    const root = app.render(<List />, host, { schedule: "manual", idPrefix: "list" });
    const before = new Map(
      Array.from(host.querySelectorAll("li"), (row) => [row.dataset.item, row.id])
    );

    host.querySelector("button")?.click();
    root.flush();

    expect(Array.from(host.querySelectorAll("li"), (row) => row.dataset.item)).toEqual(["3", "2", "1"]);
    expect(Array.from(host.querySelectorAll("li"), (row) => row.id)).toEqual([
      before.get("3"), before.get("2"), before.get("1"),
    ]);
  });

  it("shares reactive state and non-reactive refs through a store", () => {
    const reportRef = vi.fn();
    const model = store({
      state: { count: 0 },
      refs: { runtimeCount: 0 },
      acts: ({ get, set, refs }) => ({
        increment() {
          refs.runtimeCount.current++;
          reportRef(refs.runtimeCount.current);
          set({ count: get("count") + 1 });
        },
      }),
    });
    const Counter = component(({ $, acts, refs }) => (
      <p>
        <button onClick={() => { refs.runtimeCount.current = 10; }}>Set ref</button>
        <button onClick={acts.increment}>Increment</button>
        <output>{$.count}</output>
      </p>
    ), [model]);
    const host = document.createElement("div");
    const commits = vi.fn();
    const app = createApp();
    const root = app.render(<Counter />, host, {
      schedule: "manual",
      onCommit: commits,
    });
    const [setRef, increment] = host.querySelectorAll("button");

    setRef!.click();
    root.flush();
    expect(host.querySelector("output")?.textContent).toBe("0");
    expect(commits).not.toHaveBeenCalled();

    increment!.click();
    root.flush();
    expect(host.querySelector("output")?.textContent).toBe("1");
    expect(reportRef).toHaveBeenCalledWith(11);
    app.dispose();
  });

  it("tracks ordinary component reads and updates its subscriptions", () => {
    const initial = { useCount: true, count: 1, label: "Ready", unrelated: 0 };
    let update = (_value: Partial<typeof initial>) => {};
    const model = store({
      state: initial,
      refs: { marker: "runtime" },
      acts: ({ get, set }) => ({
        increment() {
          set({ count: get("count") + 1 });
        },
      }),
      setup({ nexus }) {
        update = (value) => nexus.set(value);
      },
    });
    const app = createApp();
    const host = document.createElement("div");
    let runs = 0;
    const scopes = vi.fn();
    const Panel = component(({ state, $, acts, refs }) => {
      runs++;
      scopes($, acts, refs);
      return (
        <button onClick={acts.increment} data-marker={refs.marker.current}>
          {state.useCount ? state.count : state.label}
        </button>
      );
    }, [model]);
    const root = app.render(<Panel />, host, { schedule: "manual" });

    expect(runs).toBe(1);
    expect(host.textContent).toBe("1");
    expect(host.querySelector("button")?.dataset.marker).toBe("runtime");

    update({ unrelated: 1 });
    root.flush();
    expect(runs).toBe(1);

    host.querySelector("button")?.click();
    root.flush();
    expect(runs).toBe(2);
    expect(host.textContent).toBe("2");
    for (const [index, value] of scopes.mock.calls[0]!.entries()) {
      expect(scopes.mock.calls[1]![index]).toBe(value);
    }

    update({ useCount: false });
    update({ label: "Latest" });
    root.flush();
    expect(runs).toBe(3);
    expect(host.textContent).toBe("Latest");

    update({ count: 3 });
    root.flush();
    expect(runs).toBe(3);

    update({ label: "Updated" });
    root.flush();
    expect(runs).toBe(4);
    expect(host.textContent).toBe("Updated");
  });

  it("routes tracked view update errors through the surrounding boundary", () => {
    let fail = () => {};
    const model = store({
      state: { broken: false },
      setup({ nexus }) { fail = () => nexus.set({ broken: true }); },
    });
    const Panel = component(({ state }) => {
      if (state.broken) throw new Error("broken view");
      return <strong>Working</strong>;
    }, [model]);
    const app = createApp();
    const host = document.createElement("div");
    const root = app.render(
      <ErrorBoundary fallback={<p role="alert">View failed</p>}>
        <Panel />
      </ErrorBoundary>,
      host,
      { schedule: "manual" }
    );

    fail();
    root.flush();

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "View failed"
    );
    expect(host.querySelector("strong")).toBeNull();
  });

  it("locally reconciles stable view elements, events and refs", () => {
    const initialRefs = {
      button: null as HTMLButtonElement | null,
      input: null as HTMLInputElement | null,
    };
    let readRefs = () => initialRefs;
    let activate = () => {};
    const model = store({
      state: { selected: 1, active: false },
      refs: initialRefs,
      setup({ nexus, refs }) {
        readRefs = () => ({ button: refs.button.current, input: refs.input.current });
        activate = () => nexus.set({ selected: 2, active: true });
      },
    });
    const app = createApp();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const selections: number[] = [];
    const Panel = component(({ state, refs }) => (
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
    ), [model]);
    const root = app.render(<Panel />, host, { schedule: "manual" });
    const section = host.querySelector("section");
    const input = host.querySelector("input");
    const first = host.querySelector("button");

    expect(readRefs().button).toBe(first);
    expect(readRefs().input).toBe(input);
    input?.focus();

    activate();
    root.flush();

    const second = host.querySelector("button");
    expect(host.querySelector("section")).toBe(section);
    expect(host.querySelector("input")).toBe(input);
    expect(second).toBe(first);
    expect(readRefs().button).toBe(second);
    expect(readRefs().input).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input?.value).toBe("Value 2");
    expect(section?.className).toBe("active");
    expect(second?.dataset.selected).toBe("2");
    expect(second?.textContent).toBe("2");

    second?.click();
    expect(selections).toEqual([2]);
    root.dispose();
    expect(readRefs()).toEqual(initialRefs);
    host.remove();
  });

  it("replaces a tracked view when its local shape or key changes", () => {
    const initial = { expanded: false, version: 1 };
    let update = (_value: Partial<typeof initial>) => {};
    const model = store({
      state: initial,
      setup({ nexus }) { update = (value) => nexus.set(value); },
    });
    const app = createApp();
    const host = document.createElement("div");
    const Panel = component(({ state }) => (
      <section key={state.version}>
        <strong>Stable root</strong>
        {state.expanded ? <span>Extra</span> : null}
      </section>
    ), [model]);
    const root = app.render(<Panel />, host, { schedule: "manual" });
    const collapsed = host.querySelector("section");

    update({ expanded: true });
    root.flush();
    const expanded = host.querySelector("section");

    expect(expanded).not.toBe(collapsed);
    expect(expanded?.textContent).toBe("Stable rootExtra");

    update({ version: 2 });
    root.flush();

    expect(host.querySelector("section")).not.toBe(expanded);
  });

  it("disposes every app root and setup resource", () => {
    const cleanup = vi.fn();
    const app = createApp();
    app.onCleanup(cleanup);
    const firstHost = document.createElement("div");
    const secondHost = document.createElement("div");
    app.render(<p>First</p>, firstHost);
    app.render(<p>Second</p>, secondHost);

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
    const app = createApp();
    const items = [
      { id: 1, label: "First" },
      { id: 2, label: "Second" },
      { id: 3, label: "Third" },
    ];
    let tasks!: ListController<(typeof items)[number]>;
    const model = store({
      state: { items },
      acts: ({ list }) => ({ tasks: list("items") }),
      setup({ acts }) {
        tasks = acts.tasks;
      },
    });
    const host = document.createElement("div");
    const commits: CommitEvent<{ source: string }>[] = [];
    let keyCalls = 0;
    const List = component(({ $ }) => (
      <ul>
        {$.items.each(
          (item) => {
            keyCalls++;
            return item.id;
          },
          ($item) => <li data-id={$item.id}>{$item.label}</li>
        )}
      </ul>
    ), [model]);
    const root = app.render(
      <List />,
      host,
      {
        schedule: "manual",
        onCommit: (event) => commits.push(event),
      }
    );
    const thirdNode = host.querySelector('[data-id="3"]');
    keyCalls = 0;

    tasks.move(2, 0);
    root.flush();

    expect(keyCalls).toBe(1);
    expect(host.querySelector("li")).toBe(thirdNode);
    expect(commits.at(-1)?.contexts.at(-1)?.source).toBe("list.move");

    keyCalls = 0;
    tasks.append({ id: 4, label: "Fourth" });
    root.flush();
    expect(keyCalls).toBe(1);
    expect(host.querySelector('[data-id="4"]')?.textContent).toBe("Fourth");

    const firstNode = host.querySelector('[data-id="1"]');
    keyCalls = 0;
    tasks.batch((items) => {
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
    const app = createApp();
    const nexus = createNexus({
      state: { items: [{ id: 1, label: "First" }] },
    });
    const $ = bind(nexus);
    const { list } = createListHelpers(nexus.get, nexus.set);
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
      $.items.each(
        (item) => item.id,
        ($item) => <Subscribed item={$item} />
      ),
      host,
      { schedule: "manual" }
    );

    list("items").replace(0, { id: 1, label: "Updated" });
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
    const app = createApp();
    const nexus = createNexus({
      state: {
        items: [
          { id: 1, broken: false },
          { id: 2, broken: true },
        ],
      },
    });
    const $ = bind(nexus);
    const host = document.createElement("div");

    function Row({ id, broken }: { id: number; broken: boolean }) {
      if (id === 1) onCleanup(firstCleanup);
      if (broken) throw new Error("keyed mount failed");
      return <span>{id}</span>;
    }

    expect(() =>
      app.render(
        $.items.each(
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
    const app = createApp();
    const nexus = createNexus({
      state: { items: [{ id: 1, value: 1 }] },
    });
    const $ = bind(nexus);
    const { list } = createListHelpers(nexus.get, nexus.set);
    const host = document.createElement("div");
    const root = app.render(
      <ErrorBoundary fallback={<p>List failed</p>}>
        {$.items.each(
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

    list("items").replace(0, { id: 1, value: -1 });
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

  it("replaces an owned if branch and cleans up the removed component", () => {
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

    renderer.mount($.visible.if(<Visible />, <em>Hidden branch</em>), host);

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

  it("switches an if branch only when source truthiness changes", () => {
    const app = createApp();
    const nexus = createNexus({ state: { count: 1 } });
    const $ = bind(nexus);
    const host = document.createElement("div");
    const positiveCleanup = vi.fn();

    function Positive() {
      onCleanup(positiveCleanup);
      return <strong>Positive</strong>;
    }

    const root = app.render(
      $.count.if(<Positive />, <em>Not positive</em>),
      host,
      { schedule: "manual" }
    );
    const positive = host.querySelector("strong");

    nexus.set({ count: 2 });
    root.flush();
    expect(host.querySelector("strong")).toBe(positive);
    expect(positiveCleanup).not.toHaveBeenCalled();

    nexus.set({ count: 0 });
    root.flush();
    expect(host.textContent).toBe("Not positive");
    expect(positiveCleanup).toHaveBeenCalledOnce();
  });

  it("binds if to a live row field even when its name overlaps the method", () => {
    const data = createNexus({ state: { rows: [{ id: 1, if: false }] } });
    const $ = bind(data);
    const host = document.createElement("div");
    const root = render($.rows.each((row) => row.id, ($row) => (
      <p>{$row.$field("if").if("Ready", "Waiting")}</p>
    )), host, { schedule: "manual" });
    const row = host.querySelector("p");
    expect(row?.textContent).toBe("Waiting");

    data.set({ rows: [{ id: 1, if: true }] });
    root.flush();
    expect(host.querySelector("p")).toBe(row);
    expect(row?.textContent).toBe("Ready");
    root.dispose();
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
    const app = createApp();
    const nexus = createNexus({
      state: {
        items: [
          { id: 1, label: "First" },
          { id: 2, label: "Second" },
        ],
      },
    });
    const $ = bind(nexus);
    const { list } = createListHelpers(nexus.get, nexus.set);
    const host = document.createElement("div");
    const root = app.render(
      $.items.each(
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

    list("items").move(1, 0);
    root.flush();

    expect(Array.from(host.children)).toEqual([
      secondHead,
      secondTail,
      host.querySelector('[data-id="1"]'),
      host.querySelector('[data-tail="1"]'),
    ]);

    list("items").remove(0);
    root.flush();

    expect(secondHead?.isConnected).toBe(false);
    expect(secondTail?.isConnected).toBe(false);
    expect(host.children).toHaveLength(2);
  });

  it("reads item fields that collide with LiveValue methods", () => {
    const app = createApp();
    const nexus = createNexus({
      state: { items: [{ id: 1, get: "Initial" }] },
    });
    const $ = bind(nexus);
    const { list } = createListHelpers(nexus.get, nexus.set);
    const host = document.createElement("div");
    const root = app.render(
      $.items.each(
        (item) => item.id,
        ($item) => <span>{$item.$field("get")}</span>
      ),
      host,
      { schedule: "manual" }
    );
    const span = host.querySelector("span");

    list("items").replace(0, { id: 1, get: "Updated" });
    root.flush();

    expect(host.querySelector("span")).toBe(span);
    expect(span?.textContent).toBe("Updated");
  });
});
