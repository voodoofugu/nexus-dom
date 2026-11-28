import type { UpdateContext } from "nexus-state";
import { nexusDOMError } from "./errors.js";
import { hydrate as hydrateView, render as renderView } from "./render.js";
import { createStoreViewRegistry } from "./store-view.js";
import type { Renderable, RendererOptions, RenderRoot } from "./types.js";

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***NexusDOMApp***:
 * owns DOM roots, lazy store instances and application resources.
 * @description
 * `render` and `hydrate` return disposable root handles. `dispose()`
 * releases every root and calls the application's registered cleanups.
 * @example
 * ```tsx
 * const root = app.render(<App />, "#app");
 * root.dispose(); // Dispose this root.
 * app.dispose(); // Dispose the application and its stores.
 * ```
 */
export interface NexusDOMApp {
  onCleanup(cleanup: () => void): () => void;
  dispose(): void;
  render(
    view: Renderable,
    target: ParentNode | string,
    options?: RendererOptions<UpdateContext>
  ): RenderRoot;
  hydrate(
    view: Renderable,
    target: ParentNode | string,
    options?: RendererOptions<UpdateContext>
  ): RenderRoot;
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***createApp***:
 * creates an application that resolves lazy stores and mounts DOM roots.
 * @returns an app with `render`, `hydrate` and `dispose`.
 * @example
 * ```tsx
 * const app = createApp();
 * app.render(<Counter />, "#app");
 * ```
 */
export function createApp(): NexusDOMApp;

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***createApp***:
 * creates an application and mounts its first DOM root.
 * @param view JSX or another renderable value.
 * @param target DOM container or selector.
 * @returns the app with `render`, `hydrate` and `dispose`.
 * @example
 * ```tsx
 * const app = createApp(<Counter />, "#app");
 * ```
 */
export function createApp(
  view: Renderable,
  target: ParentNode | string
): NexusDOMApp;
export function createApp(
  view?: Renderable,
  target?: ParentNode | string
): NexusDOMApp {
  if (view !== undefined && target === undefined) {
    throw nexusDOMError(
      "RENDER_TARGET_NOT_FOUND",
      "Pass a target to createApp(view, target), or call createApp() to mount later."
    );
  }
  const roots = new Set<RenderRoot>();
  const cleanups = new Set<() => void>();
  const storeViews = createStoreViewRegistry();
  let disposed = false;

  const app: NexusDOMApp = {
    onCleanup(cleanup) {
      if (disposed) {
        cleanup();
        return () => {};
      }
      cleanups.add(cleanup);
      return () => cleanups.delete(cleanup);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const root of Array.from(roots)) root.dispose();
      roots.clear();
      for (const cleanup of Array.from(cleanups).reverse()) cleanup();
      cleanups.clear();
      storeViews.dispose();
    },
    render(view, target, rendererOptions) {
      if (disposed) {
        throw nexusDOMError(
          "APP_DISPOSED",
          "Cannot render a disposed app. app.dispose() has already run."
        );
      }
      const root = renderView(view, target, rendererOptions, storeViews);
      let rootDisposed = false;
      const managedRoot: RenderRoot = {
        flush: root.flush,
        dispose() {
          if (rootDisposed) return;
          rootDisposed = true;
          roots.delete(managedRoot);
          root.dispose();
        },
      };
      if (disposed) managedRoot.dispose();
      else roots.add(managedRoot);
      return managedRoot;
    },
    hydrate(view, target, rendererOptions) {
      if (disposed) {
        throw nexusDOMError(
          "APP_DISPOSED",
          "Cannot hydrate with a disposed app. app.dispose() has already run."
        );
      }
      const root = hydrateView(view, target, rendererOptions, storeViews);
      let rootDisposed = false;
      const managedRoot: RenderRoot = {
        flush: root.flush,
        dispose() {
          if (rootDisposed) return;
          rootDisposed = true;
          roots.delete(managedRoot);
          root.dispose();
        },
      };
      if (disposed) managedRoot.dispose();
      else roots.add(managedRoot);
      return managedRoot;
    },
  };

  if (target !== undefined) {
    try {
      app.render(view, target);
    } catch (error) {
      app.dispose();
      throw error;
    }
  }

  return app;
}
