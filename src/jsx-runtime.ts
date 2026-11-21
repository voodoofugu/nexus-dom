import { FRAGMENT, type JSXType, type VNode } from "./types.js";

export const Fragment = FRAGMENT;

export function jsx(
  type: JSXType,
  props: Record<string, unknown> | null,
  key?: PropertyKey
): VNode {
  const normalizedProps = props ?? {};

  if (type === FRAGMENT) {
    return { kind: "fragment", props: normalizedProps, ...(key === undefined ? {} : { key }) };
  }

  if (typeof type === "string") {
    return {
      kind: "element",
      type,
      props: normalizedProps,
      ...(key === undefined ? {} : { key }),
    };
  }

  return {
    kind: "component",
    type,
    props: normalizedProps,
    ...(key === undefined ? {} : { key }),
  };
}

export const jsxs = jsx;

type DOMEventHandler = (event: Event) => void;

interface DOMAttributes {
  children?: import("./types.js").Renderable;
  class?: unknown;
  className?: unknown;
  style?: unknown;
  ref?: (element: Element | null) => void;
  [name: `on${string}`]: DOMEventHandler | undefined;
  [name: string]: unknown;
}

export namespace JSX {
  export type Element = VNode;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
  export interface IntrinsicAttributes {
    key?: PropertyKey;
  }
  export interface IntrinsicElements {
    [elementName: string]: DOMAttributes;
  }
}
