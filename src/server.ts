import { isLiveValue, createMutableLiveItem } from "./live.js";
import { Owner, withOwner } from "./owner.js";
import { createStoreViewRegistry } from "./store-view.js";
import { nexusDOMError } from "./errors.js";
import type { Renderable, VNode } from "./types.js";

export interface ServerRenderOptions {
  idPrefix?: string;
}

const voidElements = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);
const elementNamePattern = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const attributeNamePattern = /^[A-Za-z_:][A-Za-z0-9:._-]*$/;

const escapeText = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const escapeAttribute = (value: unknown) =>
  escapeText(value).replaceAll('"', "&quot;");

const attributeName = (name: string) =>
  name === "className" ? "class" : name === "htmlFor" ? "for" : name;

const styleText = (value: Record<string, unknown>) =>
  Object.entries(value)
    .filter(([, item]) => item !== null && item !== undefined && item !== false)
    .map(([name, item]) =>
      `${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${String(item)}`
    )
    .join(";");

export function renderToString(
  view: Renderable,
  options: ServerRenderOptions = {}
) {
  const storeViews = createStoreViewRegistry({ runSetup: false });
  const root = new Owner(undefined, true, options.idPrefix ?? "ssr");

  const render = (current: Renderable, owner: Owner): string => {
    if (
      current === null ||
      current === undefined ||
      current === false ||
      current === true
    ) return "";
    if (Array.isArray(current)) {
      return current.map((child) => render(child, owner)).join("");
    }
    if (isLiveValue(current)) return escapeText(current.get());
    if (typeof current !== "object") return escapeText(current);

    const vnode = current as VNode;
    if (vnode.kind === "component") {
      const componentOwner = new Owner(owner);
      return render(withOwner(componentOwner, () => vnode.type(vnode.props)), componentOwner);
    }
    if (vnode.kind === "store-view") {
      return render(storeViews.resolve(vnode), owner);
    }
    if (vnode.kind === "tracked-view") {
      return render(vnode.project(vnode.source.get()), owner);
    }
    if (vnode.kind === "fragment") {
      return render(vnode.props.children as Renderable, owner);
    }
    if (vnode.kind === "dynamic") {
      return render(vnode.project(vnode.source.get()), owner);
    }
    if (vnode.kind === "show") {
      return render(vnode.when.get() ? vnode.children : vnode.fallback, owner);
    }
    if (vnode.kind === "keyed") {
      return vnode.source
        .get()
        .map((item) => {
          const rowOwner = new Owner(owner, false);
          const { live } = createMutableLiveItem<unknown, unknown>(item);
          try {
            return render(vnode.project(live), rowOwner);
          } finally {
            rowOwner.dispose();
          }
        })
        .join("");
    }
    if (vnode.kind === "error-boundary") {
      try {
        return render(vnode.children, owner);
      } catch (error) {
        const fallback = typeof vnode.fallback === "function"
          ? vnode.fallback(error, () => {})
          : vnode.fallback;
        return render(fallback, owner);
      }
    }

    if (!elementNamePattern.test(vnode.type)) {
      throw nexusDOMError(
        "INVALID_SERVER_ELEMENT",
        `Cannot serialize the element name ${JSON.stringify(vnode.type)}.`
      );
    }

    let attributes = "";
    for (const [rawName, rawValue] of Object.entries(vnode.props)) {
      if (
        rawName === "children" ||
        rawName === "key" ||
        rawName === "ref" ||
        rawName.toLowerCase().startsWith("on")
      ) continue;
      const value = isLiveValue(rawValue) ? rawValue.get() : rawValue;
      if (
        value === null ||
        value === undefined ||
        value === false ||
        typeof value === "function"
      ) continue;
      const name = attributeName(rawName);
      if (!attributeNamePattern.test(name)) {
        throw nexusDOMError(
          "INVALID_SERVER_ATTRIBUTE",
          `Cannot serialize the attribute name ${JSON.stringify(name)}.`
        );
      }
      if (value === true) {
        attributes += ` ${name}`;
      } else if (name === "style" && typeof value === "object") {
        const serialized = styleText(value as Record<string, unknown>);
        if (serialized) attributes += ` style="${escapeAttribute(serialized)}"`;
      } else {
        attributes += ` ${name}="${escapeAttribute(value)}"`;
      }
    }
    if (voidElements.has(vnode.type)) return `<${vnode.type}${attributes}>`;
    return `<${vnode.type}${attributes}>${render(vnode.props.children as Renderable, owner)}</${vnode.type}>`;
  };

  try {
    return render(view, root);
  } finally {
    storeViews.dispose();
    root.dispose();
  }
}
