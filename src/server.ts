import { isLiveValue, createMutableLiveItem } from "./live.js";
import { Owner, withOwner } from "./owner.js";
import { createStoreViewRegistry } from "./store-view.js";
import { nexusDOMError } from "./errors.js";
import { checkedDOMValue, isEventProperty } from "./dom-prop-policy.js";
import { hydrationText } from "./hydration-markers.js";
import { serializeHydrationState } from "./hydration-state.js";
import type { Renderable, VNode } from "./types.js";

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***ServerRenderOptions***:
 * configures the root ID prefix and hydration output for `renderToString`.
 */
export interface ServerRenderOptions {
  idPrefix?: string;
  /** Emits structural markers required by hydrate(). */
  hydration?: boolean;
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

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***renderToString***:
 * renders JSX to an HTML string without a browser DOM.
 * @description
 * Each call resolves its own lazy stores. Set `hydration: true`
 * to include the markers and store snapshots the client uses.
 * @param view JSX, a live value or another renderable value.
 * @param options hydration output and the root ID prefix.
 * @returns the serialized HTML fragment.
 * @example
 * ```tsx
 * import { renderToString } from "nexus-dom/server";
 * const html = renderToString(<App />, { hydration: true, idPrefix: "app" });
 * ```
 */
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
    if (isLiveValue(current)) {
      const value = escapeText(current.get());
      return options.hydration ? hydrationText(value) : value;
    }
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
      const branchOwner = new Owner(
        owner,
        true,
        owner.reserveIdSegment("t")
      );
      return render(vnode.project(vnode.source.get()), branchOwner);
    }
    if (vnode.kind === "fragment") {
      return render(vnode.props.children as Renderable, owner);
    }
    if (vnode.kind === "dynamic") {
      const branchOwner = new Owner(
        owner,
        true,
        owner.reserveIdSegment("d")
      );
      return render(vnode.project(vnode.source.get()), branchOwner);
    }
    if (vnode.kind === "show") {
      const branchOwner = new Owner(
        owner,
        true,
        owner.reserveIdSegment("d")
      );
      return render(
        vnode.when.get() ? vnode.children : vnode.fallback,
        branchOwner
      );
    }
    if (vnode.kind === "keyed") {
      const regionId = owner.reserveIdSegment("l");
      return vnode.source
        .get()
        .map((item) => {
          const key = vnode.key(item);
          const rowOwner = new Owner(
            owner,
            true,
            owner.keyedIdSegment(regionId, key)
          );
          const { live } = createMutableLiveItem<unknown, unknown>(item);
          return render(vnode.project(live), rowOwner);
        })
        .join("");
    }
    if (vnode.kind === "error-boundary") {
      const boundaryOwner = new Owner(owner);
      const branchId = boundaryOwner.reserveIdSegment("b");
      const childOwner = new Owner(boundaryOwner, true, branchId);
      try {
        return render(vnode.children, childOwner);
      } catch (error) {
        childOwner.dispose();
        const fallback = typeof vnode.fallback === "function"
          ? vnode.fallback(error, () => {})
          : vnode.fallback;
        const fallbackOwner = new Owner(boundaryOwner, true, branchId);
        return render(fallback, fallbackOwner);
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
        isEventProperty(rawName)
      ) continue;
      const value = checkedDOMValue(
        vnode.type, rawName, isLiveValue(rawValue) ? rawValue.get() : rawValue
      );
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
    const html = render(view, root);
    const snapshots = storeViews.snapshots();
    return options.hydration && snapshots.length > 0
      ? html + serializeHydrationState(snapshots)
      : html;
  } finally {
    storeViews.dispose();
    root.dispose();
  }
}
