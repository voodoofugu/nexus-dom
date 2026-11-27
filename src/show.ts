import type { LiveValue, Renderable, ShowVNode } from "./types.js";

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***ShowProps***:
 * provides the condition, children and optional fallback for `Show`.
 */
export interface ShowProps {
  when: LiveValue<unknown, unknown>;
  fallback?: Renderable;
  children?: Renderable;
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***Show***:
 * chooses a JSX branch from a live condition.
 * @param props live condition, children and optional fallback.
 * @returns an owned conditional region.
 * @example
 * ```tsx
 * <Show when={$.signedIn} fallback={<SignIn />}>
 *   <Profile />
 * </Show>
 * ```
 */
export function Show({ when, children, fallback }: ShowProps): ShowVNode {
  return {
    kind: "show",
    when,
    ...(children === undefined ? {} : { children }),
    ...(fallback === undefined ? {} : { fallback }),
  };
}
