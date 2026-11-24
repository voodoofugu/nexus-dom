/** @jsxImportSource nexus-dom */
import { expect, it, vi } from "vitest";
import { createApp, defineView, store } from "nexus-dom";
import { renderToString } from "nexus-dom/server";

it("keeps an unread default store dormant and resolves only named stores", () => {
  const setup = vi.fn();
  const mount = vi.fn();
  const session = store({ state: { user: "Ada" }, setup, mount });
  const filters = store({ state: { query: "open" } });
  const view = defineView({ session, filters }, { default: "session" });
  const Static = view(({ state, $ }) => {
    // Taking the scope objects does not read their members.
    void state;
    void $;
    return <p>Welcome</p>;
  });
  const Filter = view(({ state }) => <p>{state.query}</p>, ["filters"]);
  const host = document.createElement("div");
  const app = createApp();
  app.render(<><Static /><Filter /></>, host);
  expect(host.textContent).toBe("Welcomeopen");
  expect(setup).not.toHaveBeenCalled();
  expect(mount).not.toHaveBeenCalled();
  app.dispose();
});

it("tracks default state reads and shares writable bindings within one app", () => {
  const cleanup = vi.fn();
  const setup = vi.fn();
  const mount = vi.fn(() => cleanup);
  const session = store({ state: { count: 1, unrelated: 0 }, setup, mount });
  const view = defineView({ session }, { default: "session" });
  const renderCount = vi.fn();
  const Count = view(({ state }) => {
    renderCount();
    return <p>{state.count}</p>;
  });
  const Controls = view(({ $ }) => (
    <>
      <button onClick={() => $.count.set((value) => value + 1)}>{$.count}</button>
      <button onClick={() => $.unrelated.set(1)}>Unrelated</button>
    </>
  ), ["session"]);
  const app = createApp();
  const host = document.createElement("div");
  const root = app.render(<><Count /><Controls /></>, host, { schedule: "manual" });
  const [count, unrelated] = Array.from(host.querySelectorAll("button"));
  unrelated!.click();
  root.flush();
  expect(renderCount).toHaveBeenCalledOnce();
  count!.click();
  root.flush();
  expect(host.querySelector("p")?.textContent).toBe("2");
  expect(count!.textContent).toBe("2");
  expect(renderCount).toHaveBeenCalledTimes(2);
  expect(setup).toHaveBeenCalledOnce();
  expect(mount).toHaveBeenCalledOnce();
  app.dispose();
  expect(cleanup).toHaveBeenCalledOnce();

  const otherApp = createApp();
  otherApp.render(<Count />, host);
  expect(host.textContent).toBe("1");
  expect(setup).toHaveBeenCalledTimes(2);
  otherApp.dispose();
});

it("initializes a default store on the first binding read in a mounted handler", () => {
  const mount = vi.fn();
  const model = store({ state: { count: 0 }, mount });
  const view = defineView({ model }, { default: "model" });
  const Open = view(({ $ }) => <button onClick={() => $.count.set(1)}>Open</button>);
  const Count = view(({ state }) => <p>{state.count}</p>);
  const app = createApp();
  const host = document.createElement("div");
  app.render(<Open />, host);
  expect(mount).not.toHaveBeenCalled();
  host.querySelector("button")!.click();
  expect(mount).toHaveBeenCalledOnce();
  app.render(<Count />, host);
  expect(host.querySelector("p")?.textContent).toBe("1");
  app.dispose();
});

it("transfers the default store only when a server view reads it", () => {
  const initial = { count: 7 };
  const mount = vi.fn();
  const model = store({ state: initial, mount });
  const view = defineView({ model }, { default: "model" });
  const Static = view(() => <p>Static</p>);
  const Counter = view(({ $ }) => (
    <button onClick={() => $.count.set((value) => value + 1)}>{$.count}</button>
  ));
  expect(renderToString(<Static />, { hydration: true })).toBe("<p>Static</p>");
  const host = document.createElement("div");
  host.innerHTML = renderToString(<Counter />, { hydration: true });
  const button = host.querySelector("button")!;
  expect(mount).not.toHaveBeenCalled();
  initial.count = 0;
  const app = createApp();
  const root = app.hydrate(<Counter />, host, { schedule: "manual" });
  expect(host.querySelector("button")).toBe(button);
  expect(button.textContent).toBe("7");
  expect(mount).toHaveBeenCalledOnce();
  button.click();
  root.flush();
  expect(button.textContent).toBe("8");
  app.dispose();
});

it("reports unknown names for plain JavaScript callers", () => {
  const view = defineView({});
  // @ts-expect-error The name is absent from the registry.
  expect(() => view(() => null, ["missing"])).toThrowError(
    expect.objectContaining({ code: "UNKNOWN_STORE_NAME" })
  );
});
