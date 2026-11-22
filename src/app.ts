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
import { render as renderView } from "./render.js";
import { createStoreViewRegistry } from "./store-view.js";
import type {
  BoundState,
  Renderable,
  RendererOptions,
  RenderRoot,
  TrackedViewVNode,
} from "./types.js";

type RecordAny = Record<string, any>;

export interface RefValue<T> {
  current: T;
}

export type AppRefs<R extends RecordAny> = {
  readonly [K in keyof R]: RefValue<R[K]>;
};

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

export interface AppViewContext<
  S extends RecordAny,
  A extends RecordAny,
  R extends RecordAny,
> {
  /** Plain current values. Top-level reads determine this view's subscriptions. */
  readonly state: Readonly<S>;
  /** Fine-grained bindings for hot values that should not rerun this view. */
  readonly $: BoundState<S, UpdateContext>;
  readonly refs: AppRefs<R>;
  readonly acts: A;
}

export interface NexusDOMApp<
  S extends RecordAny,
  A extends RecordAny,
  R extends RecordAny,
> {
  readonly nexus: Nexus<S, A>;
  readonly $: BoundState<S, UpdateContext>;
  readonly refs: AppRefs<R>;
  readonly acts: A;
  /** Creates an owned reactive region using ordinary expressions over app state. */
  view(
    project: (context: AppViewContext<S, A, R>) => Renderable
  ): TrackedViewVNode;
  list<K extends ArrayKey<S>>(key: K): ListController<ArrayItem<S[K]>>;
  onCleanup(cleanup: () => void): () => void;
  dispose(): void;
  render(
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

export function createApp(): NexusDOMApp<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>
>;

export function createApp<
  S extends RecordAny,
  R extends RecordAny = Record<string, never>,
  A extends RecordAny = Record<string, never>,
>(options: AppOptions<S, R, A>): NexusDOMApp<S, A, R>;
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
  options?: AppOptions<S, R, A> | AppOptionsWithoutActs<S, R>
): NexusDOMApp<S, A, R> {
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
    view(project) {
      return {
        kind: "tracked-view",
        source: typedNexus as unknown as TrackedViewVNode["source"],
        project: (state) =>
          project({
            state: state as S,
            $: binding,
            refs,
            acts: typedNexus.acts,
          }),
      };
    },
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
      roots.add(managedRoot);
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

  return app;
}
