import type { LiveValue, Renderable, ShowVNode } from "./types.js";

export interface ShowProps {
  when: LiveValue<unknown, unknown>;
  fallback?: Renderable;
  children?: Renderable;
}

/**
 * Replaces one owned DOM branch when a live condition changes truthiness.
 * This is the first structural rendering experiment, not a settled API.
 */
export function Show({ when, children, fallback }: ShowProps): ShowVNode {
  return {
    kind: "show",
    when,
    ...(children === undefined ? {} : { children }),
    ...(fallback === undefined ? {} : { fallback }),
  };
}
