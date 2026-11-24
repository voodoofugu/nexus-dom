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

/** Reuses server-rendered DOM and attaches client behavior. */
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
  let root: ReturnType<typeof renderer.hydrate> | undefined;
  try {
    root = renderer.hydrate(view, resolvedTarget);
    storeViews?.completeRestore?.();
  } catch (error) {
    root?.dispose();
    throw error;
  }

  return {
    dispose: root.dispose,
    flush: renderer.flush,
  };
}

/** Mounts a view using an isolated DOM renderer. */
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
