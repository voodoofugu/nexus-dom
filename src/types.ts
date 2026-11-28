export const LIVE_VALUE: unique symbol = Symbol.for(
  "nexus-dom.live-value"
) as typeof LIVE_VALUE;

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***EqualityFn***:
 * compares two derived values to decide whether subscribers need an update.
 */
export type EqualityFn<T> = (previous: T, next: T) => boolean;

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***LiveListener***:
 * receives a new live value and its optional update context.
 */
export type LiveListener<T, C = unknown> = (value: T, context?: C) => void;

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***LiveValue***:
 * exposes a reactive value for JSX text, properties and structural regions.
 * @description
 * Use `get()` for the current value and `map()` for a derived binding.
 * Use `if()` for a condition, `render()` for a value-dependent branch
 * and `each()` for a keyed array region.
 * @example
 * ```tsx
 * <span>{$.count.map((count) => count.toLocaleString())}</span>
 * ```
 */
export interface LiveValue<T, C = unknown> {
  readonly [LIVE_VALUE]: true;
  get(): T;
  subscribe(listener: LiveListener<T, C>): () => void;
  map<U>(project: (value: T) => U, isEqual?: EqualityFn<U>): LiveValue<U, C>;
  /**---
   * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
   * ### ***if***:
   * retains the active branch while the source truthiness stays the same.
   * @param truthy content to mount for a truthy value.
   * @param fallback optional content to mount for a falsy value.
   * @returns a renderable dynamic region.
   * @example
   * ```tsx
   * {$.authorized.if(<Profile />, <Login />)}
   * ```
   */
  if(truthy: Renderable, fallback?: Renderable): DynamicVNode;
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

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***LiveItem***:
 * exposes an item and its live fields inside a keyed row.
 * @description
 * Use `$field(key)` when a field name overlaps a live-value method.
 * @example
 * ```tsx
 * {$.tasks.each((task) => task.id, ($task) => <li>{$task.title}</li>)}
 * ```
 */
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

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***NexusSource***:
 * defines the store methods a Nexus DOM binding uses for reads and subscriptions.
 */
export interface NexusSource<S extends object, C = unknown> {
  get(): S;
  subscribe(
    listener: (state: S, context?: C) => void,
    dependencies: ["*"] | (keyof S)[]
  ): () => void;
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***BoundState***:
 * exposes stable live fields and a `$select` helper for a bound source.
 */
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

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***DynamicVNode***:
 * describes a live branch returned by `LiveValue.if` or `LiveValue.render`.
 */
export interface DynamicVNode {
  readonly kind: "dynamic";
  readonly source: LiveValue<unknown, unknown>;
  readonly project: (value: unknown) => Renderable;
  readonly key?: (value: unknown) => unknown;
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***TrackedViewVNode***:
 * describes a branch rendered from tracked store reads.
 */
export interface TrackedViewVNode {
  readonly kind: "tracked-view";
  readonly source: NexusSource<Record<string, unknown>, unknown>;
  readonly project: (state: Record<string, unknown>) => Renderable;
  readonly track?: () => { value: Renderable; dependencies: string[] };
  readonly mountStores?: () => void;
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***StoreViewVNode***:
 * describes a component awaiting resolution of its declared stores.
 */
export interface StoreViewVNode {
  readonly kind: "store-view";
  readonly dependencies: readonly unknown[];
  readonly registry?: ReadonlyMap<string, readonly unknown[]>;
  readonly input: Record<string, unknown>;
  readonly render: (scope: unknown, input: Record<string, unknown>) => Renderable;
  readonly getId: () => string;
}

export interface StoreViewResolver {
  resolve(vnode: StoreViewVNode): TrackedViewVNode;
  restore?(snapshots: readonly StoreSnapshot[]): void;
  completeRestore?(): void;
  dispose(): void;
}

export interface StoreSnapshot {
  readonly keys: readonly string[];
  readonly state: Record<string, unknown>;
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***KeyedVNode***:
 * describes a keyed collection returned by `LiveValue.each`.
 */
export interface KeyedVNode {
  readonly kind: "keyed";
  readonly source: LiveValue<readonly unknown[], unknown>;
  readonly stateKey?: PropertyKey;
  readonly key: (item: unknown) => PropertyKey;
  readonly project: (item: LiveItem<unknown, unknown>) => Renderable;
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***ErrorBoundaryFallback***:
 * supplies recovery JSX or a callback that receives the render error and reset function.
 */
export type ErrorBoundaryFallback =
  | Renderable
  | ((error: unknown, reset: () => void) => Renderable);

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***ErrorBoundaryVNode***:
 * describes the region managed by an error boundary.
 */
export interface ErrorBoundaryVNode {
  readonly kind: "error-boundary";
  readonly fallback: ErrorBoundaryFallback;
  readonly children?: Renderable;
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***VNode***:
 * describes a JSX element, component or renderer-owned region.
 */
export type VNode =
  | ElementVNode
  | ComponentVNode
  | FragmentVNode
  | DynamicVNode
  | TrackedViewVNode
  | StoreViewVNode
  | ErrorBoundaryVNode
  | KeyedVNode;

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***Renderable***:
 * represents content that can be mounted or serialized by Nexus DOM.
 */
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

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***Component***:
 * accepts JSX props and returns renderable content.
 */
export type Component<P extends object = Record<string, unknown>> = (
  props: P & { children?: Renderable }
) => Renderable;

export const FRAGMENT: unique symbol = Symbol.for(
  "nexus-dom.fragment"
) as typeof FRAGMENT;

export type FragmentType = typeof FRAGMENT;

export type JSXType = string | FragmentType | Component<any>;

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***CommitEvent***:
 * reports how many jobs a render batch applied and their update contexts.
 */
export interface CommitEvent<C = unknown> {
  updates: number;
  contexts: readonly C[];
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***RendererOptions***:
 * configures update scheduling, diagnostics and component IDs.
 * @example
 * ```tsx
 * app.render(<App />, "#app", {
 *   schedule: "animationFrame",
 *   onCommit: ({ contexts }) => recordUpdates(contexts),
 * });
 * ```
 */
export interface RendererOptions<C = unknown> {
  /** Microtask batches by default; animationFrame aligns visual work to paint. */
  schedule?: "microtask" | "animationFrame" | "manual";
  onCommit?: (event: CommitEvent<C>) => void;
  /** Handles errors thrown by scheduled bindings or structural updates. */
  onError?: (error: unknown) => void;
  /** Stable root prefix shared by server rendering and hydration. */
  idPrefix?: string;
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***MountedRoot***:
 * provides the disposal handle for one mounted or hydrated root.
 */
export interface MountedRoot {
  dispose(): void;
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***RenderRoot***:
 * provides disposal and immediate flushing for a root returned by `render` or `hydrate`.
 */
export interface RenderRoot extends MountedRoot {
  /** Immediately applies queued updates. Primarily useful for tests and tools. */
  flush(): void;
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***DOMRenderer***:
 * provides mount, hydration and a shared flush function for an independent renderer.
 */
export interface DOMRenderer<C = unknown> {
  mount(view: Renderable, container: ParentNode): MountedRoot;
  hydrate(view: Renderable, container: ParentNode): MountedRoot;
  flush(): void;
}
