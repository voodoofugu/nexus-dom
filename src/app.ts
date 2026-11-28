import {
  createNexus,
  type Getter,
  type Nexus,
  type Setter,
  type UpdateContext,
} from "nexus-state";
import { bind } from "./live.js";
import { nexusDOMError } from "./errors.js";
import {
  createListHelpers,
  type AppHelpers,
  type ArrayItem,
  type ArrayKey,
  type ListController,
} from "./list.js";
import { hydrate as hydrateView, render as renderView } from "./render.js";
import { createStoreViewRegistry } from "./store-view.js";
import type {
  BoundState,
  Renderable,
  RendererOptions,
  RenderRoot,
} from "./types.js";

type RecordAny = Record<string, any>;

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***RefValue***:
 * a mutable `current` cell for a DOM node or another runtime value.
 */
export interface RefValue<T> {
  current: T;
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***AppRefs***:
 * non-reactive runtime cells keyed by the names supplied in `refs`.
 */
export type AppRefs<R extends RecordAny> = {
  readonly [K in keyof R]: RefValue<R[K]>;
};

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***AppActsCreate***:
 * creates app-level actions from Nexus getters, setters, refs and list helpers.
 */
export type AppActsCreate<
  S extends RecordAny,
  R extends RecordAny,
  A extends RecordAny,
> = (
  get: Getter<S>,
  set: Setter<S>,
  refs: AppRefs<R>,
  helpers: AppHelpers<S>
) => A;

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***AppSetupContext***:
 * passes the app store, bindings, actions, refs and cleanup to `setup`.
 */
export interface AppSetupContext<
  S extends RecordAny,
  A extends RecordAny,
  R extends RecordAny,
> {
  readonly nexus: Nexus<S, A>;
  readonly $: BoundState<S, UpdateContext>;
  readonly refs: AppRefs<R>;
  readonly acts: A;
  onCleanup(cleanup: () => void): () => void;
}

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
export interface NexusDOMApp<
  S extends RecordAny,
  A extends RecordAny,
  R extends RecordAny,
> {
  readonly nexus: Nexus<S, A>;
  readonly $: BoundState<S, UpdateContext>;
  readonly refs: AppRefs<R>;
  readonly acts: A;
  list<K extends ArrayKey<S>>(key: K): ListController<ArrayItem<S[K]>>;
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

interface AppOptions<
  S extends RecordAny,
  R extends RecordAny,
  A extends RecordAny,
> {
  state: S;
  refs?: R;
  acts: AppActsCreate<S, R, A>;
  setup?: (context: AppSetupContext<S, A, R>) => void | (() => void);
}

interface AppOptionsWithoutActs<S extends RecordAny, R extends RecordAny> {
  state: S;
  refs?: R;
  setup?: (
    context: AppSetupContext<S, Record<string, never>, R>
  ) => void | (() => void);
}

function createRefs<R extends RecordAny>(values: R): AppRefs<R> {
  return Object.fromEntries(
    Object.entries(values).map(([key, current]) => [key, { current }])
  ) as AppRefs<R>;
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
export function createApp(): NexusDOMApp<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>
>;

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***createApp***:
 * creates an application and mounts its first DOM root.
 * @param view JSX or another renderable value.
 * @param target DOM container or selector.
 * @param options optional scheduling, diagnostics and component ID prefix.
 * @returns the app with `render`, `hydrate` and `dispose`.
 * @example
 * ```tsx
 * const app = createApp(<Counter />, "#app");
 * ```
 */
export function createApp(
  view: Renderable,
  target: ParentNode | string,
  options?: RendererOptions<UpdateContext>
): NexusDOMApp<Record<string, never>, Record<string, never>, Record<string, never>>;

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***createApp***:
 * creates an application with an app-level Nexus store and named actions.
 * @param options state, actions, optional runtime refs and app setup.
 * @returns an app with the Nexus store, actions, bindings and root lifecycle.
 * @example
 * ```ts
 * const app = createApp({
 *   state: { count: 0 },
 *   acts: (get, set) => ({
 *     increment: () => set({ count: get("count") + 1 }),
 *   }),
 * });
 * app.acts.increment();
 * ```
 */
export function createApp<
  S extends RecordAny,
  R extends RecordAny = Record<string, never>,
  A extends RecordAny = Record<string, never>,
>(options: AppOptions<S, R, A>): NexusDOMApp<S, A, R>;
/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***createApp***:
 * creates an application with an app-level Nexus store.
 * @param options state, optional runtime refs and app setup.
 * @returns an app with the Nexus store, bindings and root lifecycle.
 */
export function createApp<
  S extends RecordAny,
  R extends RecordAny = Record<string, never>,
>(
  options: AppOptionsWithoutActs<S, R>
): NexusDOMApp<S, Record<string, never>, R>;
export function createApp<
  S extends RecordAny,
  R extends RecordAny,
  A extends RecordAny,
>(
  optionsOrView?: AppOptions<S, R, A> | AppOptionsWithoutActs<S, R> | Renderable,
  target?: ParentNode | string,
  rendererOptions?: RendererOptions<UpdateContext>
): NexusDOMApp<S, A, R> {
  const options = target === undefined ? optionsOrView : undefined;
  const normalized = (options ?? { state: {} }) as
    | AppOptions<S, R, A>
    | AppOptionsWithoutActs<S, R>;
  const refs = createRefs((normalized.refs ?? {}) as R);
  const nexus =
    "acts" in normalized
      ? createNexus({
          state: normalized.state,
          acts: (get, set) =>
            normalized.acts(get, set, refs, createListHelpers(get, set)),
        })
      : createNexus({ state: normalized.state });
  const typedNexus = nexus as Nexus<S, A>;
  const binding = bind(typedNexus);
  const helpers = createListHelpers(typedNexus.get, typedNexus.set);
  const roots = new Set<RenderRoot>();
  const cleanups = new Set<() => void>();
  const storeViews = createStoreViewRegistry();
  let disposed = false;

  const app: NexusDOMApp<S, A, R> = {
    nexus: typedNexus,
    $: binding,
    refs,
    acts: typedNexus.acts,
    list: helpers.list,
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

  const setup = normalized.setup as
    | ((context: AppSetupContext<S, A, R>) => void | (() => void))
    | undefined;
  const setupCleanup = setup?.({
    nexus: typedNexus,
    $: binding,
    refs,
    acts: typedNexus.acts,
    onCleanup: app.onCleanup,
  });
  if (setupCleanup) app.onCleanup(setupCleanup);

  if (target !== undefined) {
    try {
      app.render(optionsOrView as Renderable, target, rendererOptions);
    } catch (error) {
      app.dispose();
      throw error;
    }
  }

  return app;
}
