import {
  createNexus,
  type Getter,
  type Nexus,
  type Setter,
  type UpdateContext,
} from "nexus-state";
import { bind } from "./live.js";
import {
  createListHelpers,
  type AppHelpers,
  type ArrayItem,
  type ArrayKey,
  type ListController,
} from "./list.js";
import { render as renderView } from "./render.js";
import type {
  BoundState,
  Renderable,
  RendererOptions,
  RenderRoot,
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
  options: AppOptions<S, R, A> | AppOptionsWithoutActs<S, R>
): NexusDOMApp<S, A, R> {
  const refs = createRefs((options.refs ?? {}) as R);
  const nexus =
    "acts" in options
      ? createNexus({
          state: options.state,
          acts: (get, set) =>
            options.acts(get, set, refs, createListHelpers(get, set)),
        })
      : createNexus({ state: options.state });
  const typedNexus = nexus as Nexus<S, A>;
  const binding = bind(typedNexus);
  const helpers = createListHelpers(typedNexus.get, typedNexus.set);
  const roots = new Set<RenderRoot>();
  const cleanups = new Set<() => void>();
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
    },
    render(view, target, rendererOptions) {
      if (disposed) {
        throw new Error("[nexus-dom] Cannot render a disposed app.");
      }
      const root = renderView(view, target, rendererOptions);
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

  const setup = options.setup as
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
