/** @jsxImportSource nexus-dom */
import { expect, it, vi } from "vitest";
import { createApp, defineViews, store } from "nexus-dom";
import { renderToString } from "nexus-dom/server";

it("opens only stores accessed by the component and adds local namespaces", () => {
  const idle = vi.fn();
  const mount = vi.fn();
  const preferences = store({ state: { theme: "light" }, mount });
  const issues = store({ state: { items: [{ id: 1, title: "First issue" }] } });
  const session = store({ state: { user: "Ada" }, setup: idle, mount: idle });
  const draft = store({ state: { theme: "local" } });
  const view = defineViews({ preferences, issues, session });
  const Title = view(({ state }, { issueId }: { issueId: number }) => (
    <p class={state.preferences.theme}>
      {state.issues.items.find((issue) => issue.id === issueId)?.title}
      {state.draft.theme}
    </p>
  ), { draft });
  const Plain = view(({ state }) => <p>{Object.keys(state).length}</p>);
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
  const view = defineViews({ panel, details });
  const visited = vi.fn();
  const Title = view(({ state }) => {
    visited();
    return <p>{state.panel.showDetails ? state.details.title : "Hidden"}</p>;
  });
  const Toggle = view(({ $ }) => (
    <button onClick={() => $.panel.showDetails.set((value) => !value)}>
      {$.panel.showDetails.map(String)}
    </button>
  ));
  const Rename = view(({ $ }) => <button onClick={() => $.details.title.set("New")}>Rename</button>);
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
  const view = defineViews({ a, b });
  const Output = view(({ state, $ }) => <p>{state.b.value}: {$.a.value}</p>);
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

it("rejects a local namespace that conflicts with a shared one", () => {
  const model = store({ state: { value: 1 } });
  const view = defineViews({ model });
  // @ts-expect-error Shared namespace names cannot be redefined.
  expect(() => view(() => null, { model })).toThrowError(
    expect.objectContaining({ code: "STORE_DEPENDENCY_CONFLICT" })
  );
});
