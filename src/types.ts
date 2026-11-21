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
}

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
  readonly type: Component<Record<string, unknown>>;
  readonly props: Record<string, unknown>;
  readonly key?: PropertyKey;
}

export interface FragmentVNode {
  readonly kind: "fragment";
  readonly props: Record<string, unknown>;
  readonly key?: PropertyKey;
}

export type VNode = ElementVNode | ComponentVNode | FragmentVNode;

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

export type JSXType = string | FragmentType | Component<Record<string, unknown>>;

export interface CommitEvent<C = unknown> {
  updates: number;
  contexts: readonly C[];
}

export interface RendererOptions<C = unknown> {
  /** Microtask batches updates by default. Manual mode is useful for tests. */
  schedule?: "microtask" | "manual";
  onCommit?: (event: CommitEvent<C>) => void;
}

export interface MountedRoot {
  dispose(): void;
}

export interface DOMRenderer<C = unknown> {
  mount(view: Renderable, container: ParentNode): MountedRoot;
  flush(): void;
}
