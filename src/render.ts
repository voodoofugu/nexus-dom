import { createDOMRenderer } from "./renderer.js";
import { nexusDOMError } from "./errors.js";
import { takeHydrationState } from "./hydration-state.js";
import type {
  Renderable,
  RendererOptions,
  RenderRoot,
  StoreViewResolver,
} from "./types.js";

function resolveTarget(target: ParentNode | string): ParentNode {
  if (typeof target !== "string") return target;

  const element = document.querySelector(target);
  if (!element) {
    throw nexusDOMError(
      "RENDER_TARGET_NOT_FOUND",
      `Render target "${target}" was not found.`
    );
  }
  return element;
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***hydrate***:
 * adopts server-rendered DOM and attaches client bindings, events and refs.
 * @description
 * Use `app.hydrate` when the server HTML carries lazy-store snapshots.
 * @param view the same initial JSX tree used on the server.
 * @param target container node or a selector in the current document.
 * @param options renderer options, including the server's `idPrefix`.
 * @returns a root with `dispose()` and `flush()`.
 */
export function hydrate<C = unknown>(
  view: Renderable,
  target: ParentNode | string,
  options: RendererOptions<C> = {},
  storeViews?: StoreViewResolver
): RenderRoot {
  const renderer = createDOMRenderer(options, storeViews);
  const resolvedTarget = resolveTarget(target);
  const snapshots = takeHydrationState(resolvedTarget);
  if (snapshots) {
    if (!storeViews?.restore) {
      throw nexusDOMError(
        "HYDRATION_STATE_INVALID",
        "Lazy-store hydration state requires createApp().hydrate()."
      );
    }
    storeViews.restore(snapshots);
  }
  const root = renderer.hydrate(view, resolvedTarget);

  return {
    dispose: root.dispose,
    flush: renderer.flush,
  };
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***render***:
 * mounts JSX into a DOM container with an isolated renderer.
 * @param view JSX, a live value or another renderable value.
 * @param target container node or a selector in the current document.
 * @param options scheduling, diagnostics and component ID prefix.
 * @returns a root with `dispose()` and `flush()`.
 * @example
 * ```tsx
 * const root = render(<p>Ready</p>, "#app");
 * ```
 */
export function render<C = unknown>(
  view: Renderable,
  target: ParentNode | string,
  options: RendererOptions<C> = {},
  storeViews?: StoreViewResolver
): RenderRoot {
  const renderer = createDOMRenderer(options, storeViews);
  const root = renderer.mount(view, resolveTarget(target));

  return {
    dispose: root.dispose,
    flush: renderer.flush,
  };
}
