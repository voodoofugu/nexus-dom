export const LIVE_VALUE: unique symbol = Symbol.for(
  "nexus-dom.live-value"
) as typeof LIVE_VALUE;

export type EqualityFn<T> = (previous: T, next: T) => boolean;

export type LiveListener<T, C = unknown> = (value: T, context?: C) => void;

/** A stable reactive value that can be attached to a concrete DOM binding. */
export interface LiveValue<T, C = unknown> {
  readonly [LIVE_VALUE]: true;
  get(): T;
  subscribe(listener: LiveListener<T, C>): () => void;
  map<U>(project: (value: T) => U, isEqual?: EqualityFn<U>): LiveValue<U, C>;
  render(
    project: (value: T) => Renderable,
    options?: { key?: (value: T) => unknown }
  ): DynamicVNode;
  each<Item, Key extends PropertyKey>(
    this: LiveValue<readonly Item[], C>,
    key: (item: Item) => Key,
    project: (item: LiveItem<Item, C>) => Renderable
  ): KeyedVNode;
}

export type LiveItem<T, C = unknown> = LiveValue<T, C> & {
  $field<K extends keyof T>(key: K): LiveValue<T[K], C>;
} & (T extends object
    ? {
        readonly [K in Exclude<
          keyof T,
          keyof LiveValue<T, C> | "$field"
        >]: LiveValue<T[K], C>;
      }
    : Record<never, never>);

export interface NexusSource<S extends object, C = unknown> {
  get(): S;
  subscribe(
    listener: (state: S, context?: C) => void,
    dependencies: ["*"] | (keyof S)[]
  ): () => void;
}

export type BoundState<S extends object, C = unknown> = {
  readonly [K in keyof S]: LiveValue<S[K], C>;
} & {
  $select<R>(
    selector: (state: S) => R,
    isEqual?: EqualityFn<R>
  ): LiveValue<R, C>;
};

export interface ElementVNode {
  readonly kind: "element";
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly key?: PropertyKey;
}

export interface ComponentVNode {
  readonly kind: "component";
  readonly type: Component<any>;
  readonly props: Record<string, unknown>;
  readonly key?: PropertyKey;
}

export interface FragmentVNode {
  readonly kind: "fragment";
  readonly props: Record<string, unknown>;
  readonly key?: PropertyKey;
}

export interface ShowVNode {
  readonly kind: "show";
  readonly when: LiveValue<unknown, unknown>;
  readonly children?: Renderable;
  readonly fallback?: Renderable;
}

export interface DynamicVNode {
  readonly kind: "dynamic";
  readonly source: LiveValue<unknown, unknown>;
  readonly project: (value: unknown) => Renderable;
  readonly key?: (value: unknown) => unknown;
}

export interface TrackedViewVNode {
  readonly kind: "tracked-view";
  readonly source: NexusSource<Record<string, unknown>, unknown>;
  readonly project: (state: Record<string, unknown>) => Renderable;
}

export interface KeyedVNode {
  readonly kind: "keyed";
  readonly source: LiveValue<readonly unknown[], unknown>;
  readonly stateKey?: PropertyKey;
  readonly key: (item: unknown) => PropertyKey;
  readonly project: (item: LiveItem<unknown, unknown>) => Renderable;
}

export type ErrorBoundaryFallback =
  | Renderable
  | ((error: unknown, reset: () => void) => Renderable);

export interface ErrorBoundaryVNode {
  readonly kind: "error-boundary";
  readonly fallback: ErrorBoundaryFallback;
  readonly children?: Renderable;
}

export type VNode =
  | ElementVNode
  | ComponentVNode
  | FragmentVNode
  | ShowVNode
  | DynamicVNode
  | TrackedViewVNode
  | ErrorBoundaryVNode
  | KeyedVNode;

export type Renderable =
  | VNode
  | LiveValue<unknown, unknown>
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | readonly Renderable[];

export type Component<P extends object = Record<string, unknown>> = (
  props: P & { children?: Renderable }
) => Renderable;

export const FRAGMENT: unique symbol = Symbol.for(
  "nexus-dom.fragment"
) as typeof FRAGMENT;

export type FragmentType = typeof FRAGMENT;

export type JSXType = string | FragmentType | Component<any>;

export interface CommitEvent<C = unknown> {
  updates: number;
  contexts: readonly C[];
}

export interface RendererOptions<C = unknown> {
  /** Microtask batches by default; animationFrame aligns visual work to paint. */
  schedule?: "microtask" | "animationFrame" | "manual";
  onCommit?: (event: CommitEvent<C>) => void;
  /** Handles errors thrown by scheduled bindings or structural updates. */
  onError?: (error: unknown) => void;
}

export interface MountedRoot {
  dispose(): void;
}

export interface RenderRoot extends MountedRoot {
  /** Immediately applies queued updates. Primarily useful for tests and tools. */
  flush(): void;
}

export interface DOMRenderer<C = unknown> {
  mount(view: Renderable, container: ParentNode): MountedRoot;
  flush(): void;
}
