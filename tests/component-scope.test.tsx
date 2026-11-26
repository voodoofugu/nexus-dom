/** @jsxImportSource nexus-dom */
import { expect, it, vi } from "vitest";
import { component, createApp, componentScope, store } from "nexus-dom";
import { renderToString } from "nexus-dom/server";

it("opens only stores accessed by the component and adds local namespaces", () => {
  const idle = vi.fn();
  const mount = vi.fn();
  const preferences = store({ state: { theme: "light" }, mount });
  const issues = store({ state: { items: [{ id: 1, title: "First issue" }] } });
  const session = store({ state: { user: "Ada" }, setup: idle, mount: idle });
  const draft = store({ state: { theme: "local" } });
  const workspaceComponent = componentScope({ preferences, issues, session });
  const Title = workspaceComponent(({ state }, { issueId }: { issueId: number }) => (
    <p class={state.preferences.theme}>
      {state.issues.items.find((issue) => issue.id === issueId)?.title}
      {state.draft.theme}
    </p>
  ), { draft });
  const Plain = workspaceComponent(({ state }) => <p>{Object.keys(state).length}</p>);
  expect(renderToString(<Plain />, { hydration: true })).toBe("<p>3</p>");
  const app = createApp();
  const host = document.createElement("div");
  app.render(<Title issueId={1} />, host);
  expect(host.querySelector("p")?.className).toBe("light");
  expect(host.textContent).toBe("First issuelocal");
  expect(idle).not.toHaveBeenCalled();
  expect(mount).toHaveBeenCalledOnce();
  app.dispose();
});

it("updates tracked views and bindings only from the namespaces they read", () => {
  const opened = vi.fn();
  const panel = store({ state: { showDetails: false } });
  const details = store({ state: { title: "Details" }, mount: opened });
  const workspaceComponent = componentScope({ panel, details });
  const visited = vi.fn();
  const Title = workspaceComponent(({ state }) => {
    visited();
    return <p>{state.panel.showDetails ? state.details.title : "Hidden"}</p>;
  });
  const Toggle = workspaceComponent(({ $ }) => (
    <button onClick={() => $.panel.showDetails.set((value) => !value)}>
      {$.panel.showDetails.map(String)}
    </button>
  ));
  const Rename = workspaceComponent(({ $ }) => <button onClick={() => $.details.title.set("New")}>Rename</button>);
  const host = document.createElement("div");
  const app = createApp();
  const root = app.render(<><Title /><Toggle /><Rename /></>, host, { schedule: "manual" });
  const [toggle, rename] = Array.from(host.querySelectorAll("button"));
  expect(opened).not.toHaveBeenCalled();
  toggle!.click();
  root.flush();
  expect(toggle!.textContent).toBe("true");
  expect(host.querySelector("p")?.textContent).toBe("Details");
  expect(opened).toHaveBeenCalledOnce();
  rename!.click();
  root.flush();
  expect(host.querySelector("p")?.textContent).toBe("New");
  toggle!.click();
  root.flush();
  rename!.click();
  root.flush();
  expect(visited).toHaveBeenCalledTimes(4);
  app.dispose();
});

it("hydrates snapshots in namespace access order", () => {
  const first = { value: "first" };
  const second = { value: "second" };
  const a = store({ state: first });
  const b = store({ state: second });
  const workspaceComponent = componentScope({ a, b });
  const Output = workspaceComponent(({ state, $ }) => <p>{state.b.value}: {$.a.value}</p>);
  const host = document.createElement("div");
  host.innerHTML = renderToString(<Output />, { hydration: true });
  const node = host.firstChild;
  first.value = "client a";
  second.value = "client b";
  const app = createApp();
  app.hydrate(<Output />, host);
  expect(host.firstChild).toBe(node);
  expect(host.textContent).toBe("second: first");
  app.dispose();
});

it("tracks conditional namespaces in a cross-store live selector", () => {
  const openDetails = vi.fn();
  const filters = store({ state: { show: false } });
  const details = store({ state: { title: "Details", selected: false }, mount: openDetails });
  const workspaceComponent = componentScope({ filters, details });
  const project = vi.fn();
  const commits = vi.fn();
  let rename = (_title: string) => {};
  let select = () => {};
  const Panel = workspaceComponent(({ $ }) => {
    const title = $.$select((state) => {
      project();
      return state.filters.show ? state.details.title : "Hidden";
    });
    rename = (title) => $.details.title.set(title, "rename");
    select = () => $.details.selected.set(true);
    return <><p>{title}</p><button onClick={() => $.filters.show.set((show) => !show)}>Toggle</button></>;
  });
  const host = document.createElement("div");
  const app = createApp();
  const root = app.render(<Panel />, host, { schedule: "manual", onCommit: commits });
  const toggle = host.querySelector("button")!;
  expect(openDetails).not.toHaveBeenCalled();
  toggle.click();
  root.flush();
  expect(host.querySelector("p")?.textContent).toBe("Details");
  expect(openDetails).toHaveBeenCalledOnce();
  project.mockClear();
  select();
  root.flush();
  expect(project).not.toHaveBeenCalled();
  rename("Edited");
  root.flush();
  expect(host.querySelector("p")?.textContent).toBe("Edited");
  expect(commits.mock.lastCall?.[0].contexts).toContainEqual({ source: "rename" });
  toggle.click();
  root.flush();
  project.mockClear();
  rename("While hidden");
  root.flush();
  expect(project).not.toHaveBeenCalled();
  expect(host.querySelector("p")?.textContent).toBe("Hidden");
  toggle.click();
  root.flush();
  expect(host.querySelector("p")?.textContent).toBe("While hidden");
  app.dispose();
  project.mockClear();
  rename("After disposal");
  expect(project).not.toHaveBeenCalled();
});

it("keeps whole-store subscriptions for bare and enumerated selector reads", () => {
  const model = store({ state: { count: 0 } });
  const scope = componentScope({ model });
  const enumerated = vi.fn();
  const Panel = scope(({ $ }) => (
    <>
      <p>{$.$select(({ model }) => model).map(({ count }) => count)}</p>
      <output>{$.$select(({ model }) => {
        enumerated();
        return Object.entries(model).map(([key, value]) => `${key}=${value}`).join();
      })}</output>
      <button onClick={() => $.model.count.set(1)}>Update</button>
    </>
  ));
  const host = document.createElement("div");
  const app = createApp();
  const root = app.render(<Panel />, host, { schedule: "manual" });
  enumerated.mockClear();
  host.querySelector("button")!.click();
  root.flush();
  expect(host.querySelector("p")?.textContent).toBe("1");
  expect(host.querySelector("output")?.textContent).toBe("count=1");
  expect(enumerated).toHaveBeenCalledOnce();
  app.dispose();
});

it("rejects a local namespace that conflicts with a shared one", () => {
  const model = store({ state: { value: 1 } });
  const workspaceComponent = componentScope({ model });
  // @ts-expect-error Shared namespace names cannot be redefined.
  expect(() => workspaceComponent(() => null, { model })).toThrowError(
    expect.objectContaining({ code: "STORE_DEPENDENCY_CONFLICT" })
  );
});

it("shares stores between direct and scoped dependency maps", () => {
  const titleStates = store({ state: { text: "Title" } });
  const subTitleStates = store({ state: { text: "Subtitle" } });
  const titleComponent = componentScope({ title: titleStates });
  const SubTitle = titleComponent(
    ({ state }) => <p>{state.title.text} · {state.subtitle.text}</p>,
    { subtitle: subTitleStates }
  );
  const Title = component(({ state, $ }) => (
    <>
      <h1>{state.title.text}</h1>
      <button onClick={() => $.title.text.set("Updated")}>Rename</button>
      <SubTitle />
    </>
  ), { title: titleStates });
  const app = createApp();
  const host = document.createElement("div");
  const root = app.render(<Title />, host, { schedule: "manual" });
  expect(host.querySelector("p")?.textContent).toBe("Title · Subtitle");
  host.querySelector("button")!.click();
  root.flush();
  expect(host.querySelector("h1")?.textContent).toBe("Updated");
  expect(host.querySelector("p")?.textContent).toBe("Updated · Subtitle");
  app.dispose();
});

it("rejects reserved keys in direct dependency maps", () => {
  const title = store({ state: { text: "Title" } });
  // @ts-expect-error $select is reserved for the cross-store selector.
  expect(() => component(() => null, { $select: title })).toThrowError(
    expect.objectContaining({ code: "STORE_DEPENDENCY_CONFLICT" })
  );
});
