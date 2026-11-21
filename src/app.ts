import {
  createNexus,
  type Getter,
  type Nexus,
  type Setter,
  type UpdateContext,
} from "nexus-state";
import { bind } from "./live.js";
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
> = (get: Getter<S>, set: Setter<S>, refs: AppRefs<R>) => A;

export interface NexusDOMApp<
  S extends RecordAny,
  A extends RecordAny,
  R extends RecordAny,
> {
  readonly nexus: Nexus<S, A>;
  readonly $: BoundState<S, UpdateContext>;
  readonly refs: AppRefs<R>;
  readonly acts: A;
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
}

interface AppOptionsWithoutActs<S extends RecordAny, R extends RecordAny> {
  state: S;
  refs?: R;
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
          acts: (get, set) => options.acts(get, set, refs),
        })
      : createNexus({ state: options.state });
  const typedNexus = nexus as Nexus<S, A>;

  return {
    nexus: typedNexus,
    $: bind(typedNexus),
    refs,
    acts: typedNexus.acts,
    render(view, target, rendererOptions) {
      return renderView(view, target, rendererOptions);
    },
  };
}
