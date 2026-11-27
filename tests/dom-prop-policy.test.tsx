/** @jsxImportSource nexus-dom */
import { expect, it, vi } from "vitest";
import { bind, createNexus, hydrate, render } from "nexus-dom";
import { jsx } from "nexus-dom/jsx-runtime";
import { renderToString } from "nexus-dom/server";

it("preserves explicit ARIA boolean values during rendering and hydration", () => {
  const state = createNexus({ state: { pressed: false as boolean | null } });
  const $ = bind(state);
  const view = <button aria-pressed={$.pressed} aria-expanded={true}>Toggle</button>;
  const client = document.createElement("main");
  const clientRoot = render(view, client);
  const clientButton = client.querySelector("button")!;
  expect(clientButton.getAttribute("aria-pressed")).toBe("false");
  expect(clientButton.getAttribute("aria-expanded")).toBe("true");
  clientRoot.dispose();

  const host = document.createElement("main");
  host.innerHTML = renderToString(view, { hydration: true });
  const button = host.querySelector("button")!;
  expect(button.getAttribute("aria-pressed")).toBe("false");
  expect(button.getAttribute("aria-expanded")).toBe("true");
  const root = hydrate(view, host, { schedule: "manual" });
  expect(host.querySelector("button")).toBe(button);
  state.set({ pressed: true });
  root.flush();
  expect(button.getAttribute("aria-pressed")).toBe("true");
  state.set({ pressed: null });
  root.flush();
  expect(button.hasAttribute("aria-pressed")).toBe(false);
  root.dispose();
});

it.each(["innerHTML", "outerHTML", "srcDoc", "dangerouslySetInnerHTML", "onclick"])(
  "rejects %s in DOM rendering, SSR and hydration",
  (property) => {
    const view = jsx("div", { [property]: "example" });
    const host = document.createElement("main");
    const error = expect.objectContaining({ code: "UNSAFE_DOM_PROPERTY" });
    expect(() => render(view, host)).toThrowError(error);
    expect(() => renderToString(view)).toThrowError(error);
    host.innerHTML = "<div></div>";
    expect(() => hydrate(view, host)).toThrowError(error);
  }
);

it.each(["/issues?q=one&sort=asc", "#details", "https://example.com/", "mailto:help@example.com", "tel:+123"])(
  "preserves allowed href %s in DOM and SSR",
  (href) => {
    const view = <a href={href}>Open</a>;
    const host = document.createElement("main");
    const root = render(view, host);
    const fromServer = document.createElement("main");
    fromServer.innerHTML = renderToString(view);
    expect(host.querySelector("a")?.getAttribute("href")).toBe(href);
    expect(fromServer.querySelector("a")?.getAttribute("href")).toBe(href);
    root.dispose();
  }
);

it("rejects an unsupported URL scheme on shared DOM and SSR paths", () => {
  const dataURL = "data:text/plain,example";
  const host = document.createElement("main");
  const error = expect.objectContaining({ code: "UNSAFE_DOM_URL" });
  for (const view of [
    <a href={dataURL}>Open</a>,
    <img src={dataURL} />,
    <form action={dataURL} />,
    <object data={dataURL} />,
    <svg>{jsx("use", { "xlink:href": dataURL })}</svg>,
  ]) {
    expect(() => render(view, host)).toThrowError(error);
    expect(() => renderToString(view)).toThrowError(error);
    expect(host.childNodes).toHaveLength(0);
  }
});

it("keeps the last valid URL when a live update is rejected", () => {
  const state = createNexus({ state: { href: "/before" } });
  const $ = bind(state);
  const onError = vi.fn();
  const onClick = vi.fn((event: Event) => event.preventDefault());
  const host = document.createElement("main");
  const view = <a href={$.href} onClick={onClick}>Open</a>;
  host.innerHTML = renderToString(view, { hydration: true });
  const link = host.querySelector("a")!;
  const root = hydrate(view, host, { schedule: "manual", onError });

  state.set({ href: "data:text/plain,example" });
  root.flush();
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "UNSAFE_DOM_URL" }));
  expect(link.getAttribute("href")).toBe("/before");
  expect(() => renderToString(view)).toThrowError(expect.objectContaining({ code: "UNSAFE_DOM_URL" }));

  state.set({ href: "/after" });
  root.flush();
  expect(link.getAttribute("href")).toBe("/after");
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(onClick).toHaveBeenCalledOnce();
  root.dispose();
});

it("rejects a disallowed static URL before hydrating its props", () => {
  const host = document.createElement("main");
  host.innerHTML = '<a href="/before">Open</a>';
  expect(() =>
    hydrate(<a href="data:text/plain,example">Open</a>, host)
  ).toThrowError(expect.objectContaining({ code: "UNSAFE_DOM_URL" }));
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/before");
});
