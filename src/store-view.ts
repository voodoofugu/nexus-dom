import {
  createNexus,
  type Getter,
  type Nexus,
  type SetContext,
  type Setter,
  type UpdateContext,
} from "nexus-state";
import { nexusDOMError } from "./errors.js";
import { bind, createTrackedSelector } from "./live.js";
import { LIVE_VALUE, type LiveValue } from "./types.js";
import { createListHelpers, type AppHelpers } from "./list.js";
import { captureOwnerId } from "./owner.js";
import type { AppRefs } from "./app.js";
import type {
  BoundState,
  NexusSource,
  Renderable,
  StoreViewResolver,
  StoreSnapshot,
  StoreViewVNode,
  TrackedViewVNode,
  VNode,
} from "./types.js";

type RecordAny = Record<string, any>;
type EmptyRecord = {};
const STORE_OPTIONS = Symbol("nexus-dom.store-options");
declare const STORE_TYPES: unique symbol;

export interface StoreActsContext<
  S extends RecordAny,
  R extends RecordAny,
  D extends readonly AnyStore[],
> {
  readonly get: Getter<S>;
  readonly set: Setter<S>;
  readonly reset: (...keys: (keyof S)[]) => void;
  readonly refs: AppRefs<R>;
  readonly list: AppHelpers<S>["list"];
  readonly dependencies: StoreDependencyScope<D>;
}

export interface StoreOptions<
  S extends RecordAny,
  A extends RecordAny,
  R extends RecordAny,
  D extends readonly AnyStore[] = readonly [],
> {
  /** Initial state for each app that resolves this store. */
  state: S;
  /** Initial values for mutable, non-reactive `{ current }` cells. */
  refs?: R;
  /** Creates named commands with access to state and declared dependencies. */
  acts?: (context: StoreActsContext<S, R, D>) => A;
  /** Prepares the first client render and may return app-scoped cleanup. */
  setup?: (
    context: StoreSetupContext<S, A, R, D>
  ) => void | (() => void);
  /**
   * Connects client resources when the first consuming view mounts.
   * Hydration validates the server snapshot before running this callback.
   * Return a cleanup function or register one with `onCleanup`.
   * @example
   * ```ts
   * mount({ nexus }) {
   *   return persist(nexus, { key: "preferences", include: ["compact"] });
   * }
   * ```
   */
  mount?: (
    context: NoInfer<StoreSetupContext<S, A, R, D>>
  ) => void | (() => void);
}

export interface StoreDefinition<
  S extends RecordAny,
  A extends RecordAny = EmptyRecord,
  R extends RecordAny = EmptyRecord,
  D extends readonly AnyStore[] = readonly [],
> {
  readonly [STORE_OPTIONS]: StoreOptions<any, any, any, any>;
  readonly dependencies: D;
  readonly [STORE_TYPES]: {
    readonly state: S;
    readonly acts: A;
    readonly refs: R;
  };
}

/**
 * ![nexus-dom logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 *
 * Declares a lazy store shared by the views of one application.
 * @param options initial state, actions, refs and store lifecycle.
 * @param dependencies stores available to this store's actions and lifecycle.
 * @example
 * ```ts
 * const preferences = store({ state: { compact: false } });
 * ```
 */
export function store<
  S extends RecordAny,
  R extends RecordAny = EmptyRecord,
  A extends RecordAny = EmptyRecord,
  const D extends readonly AnyStore[] = readonly [],
>(
  options: StoreOptions<S, A, R, D>,
  dependencies: D & ValidDependencies<D> = [] as unknown as D &
    ValidDependencies<D>
): StoreDefinition<S, A, R, D> {
  return { [STORE_OPTIONS]: options, dependencies } as unknown as StoreDefinition<S, A, R, D>;
}

type AnyStore = StoreDefinition<RecordAny, RecordAny, RecordAny, any>;
type StoreState<T> = T extends StoreDefinition<infer S, any, any, any> ? S : never;
type StoreActs<T> = T extends StoreDefinition<any, infer A, any, any> ? A : never;
type StoreRefs<T> = T extends StoreDefinition<any, any, infer R, any> ? R : never;
type UnionToIntersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;
type MergeStores<D extends readonly AnyStore[], Values> = D[number] extends never
  ? EmptyRecord
  : UnionToIntersection<Values>;
type EnsureRecord<T> = T extends RecordAny ? T : never;

export type DependencyState<D extends readonly AnyStore[]> = EnsureRecord<
  MergeStores<D, StoreState<D[number]>>
>;
export type DependencyActs<D extends readonly AnyStore[]> = EnsureRecord<
  MergeStores<D, StoreActs<D[number]>>
>;
export type DependencyRefs<D extends readonly AnyStore[]> = EnsureRecord<
  MergeStores<D, StoreRefs<D[number]>>
>;

export interface WritableLiveValue<T, C = unknown> extends LiveValue<T, C> {
  set(value: T | ((current: T) => T), context?: SetContext): void;
}

export type WritableBoundState<S extends RecordAny, C = unknown> = {
  readonly [K in keyof S]: WritableLiveValue<S[K], C>;
} & Pick<BoundState<S, C>, "$select">;

type Conflicts<
  D extends readonly AnyStore[],
  Domain extends "state" | "acts" | "refs",
  Seen extends PropertyKey = never,
> = D extends readonly [
  infer Head extends AnyStore,
  ...infer Tail extends readonly AnyStore[],
]
  ? Extract<
        keyof (Domain extends "state"
          ? StoreState<Head>
          : Domain extends "acts"
            ? StoreActs<Head>
            : StoreRefs<Head>),
        Seen
      > |
      Conflicts<
        Tail,
        Domain,
        | Seen
        | keyof (Domain extends "state"
            ? StoreState<Head>
            : Domain extends "acts"
              ? StoreActs<Head>
              : StoreRefs<Head>)
      >
  : never;

type StoreConflicts<D extends readonly AnyStore[]> = {
  state: Conflicts<D, "state">;
  acts: Conflicts<D, "acts">;
  refs: Conflicts<D, "refs">;
};
type ConflictDomains<D extends readonly AnyStore[]> = {
  [K in keyof StoreConflicts<D>]: StoreConflicts<D>[K] extends never
    ? never
    : K;
}[keyof StoreConflicts<D>];
type ValidDependencies<D extends readonly AnyStore[]> =
  ConflictDomains<D> extends never
    ? unknown
    : {
        readonly "nexus-dom: conflicting store dependencies": StoreConflicts<D>;
      };

export interface ViewScope<D extends readonly AnyStore[]> {
  /** Returns a stable DOM id for a local key within this component instance. */
  readonly id: (localKey: string) => string;
  /** Plain values whose top-level reads determine when the view reruns. */
  readonly state: Readonly<DependencyState<D>>;
  /** Writable live values for direct DOM bindings and small local writes. */
  readonly $: WritableBoundState<DependencyState<D>, UpdateContext>;
  /** Named commands from the declared stores. */
  readonly acts: DependencyActs<D>;
  /** Shared, non-reactive runtime cells from the declared stores. */
  readonly refs: AppRefs<DependencyRefs<D>>;
}

export interface StoreDependencyScope<D extends readonly AnyStore[]> {
  readonly get: Getter<DependencyState<D>>;
  readonly $: WritableBoundState<DependencyState<D>, UpdateContext>;
  readonly acts: DependencyActs<D>;
  readonly refs: AppRefs<DependencyRefs<D>>;
}

export interface StoreSetupContext<
  S extends RecordAny,
  A extends RecordAny,
  R extends RecordAny,
  D extends readonly AnyStore[],
> {
  readonly nexus: Nexus<S, A>;
  readonly $: WritableBoundState<S, UpdateContext>;
  readonly acts: A;
  readonly refs: AppRefs<R>;
  readonly dependencies: StoreDependencyScope<D>;
  onCleanup(cleanup: () => void): () => void;
}

type ViewComponent<Input extends object = EmptyRecord> = (
  input: Input & { children?: Renderable }
) => VNode | null;

/**
 * ![nexus-dom logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 *
 * Defines a JSX component that tracks reads from its declared stores.
 * @param render reads tracked state and returns JSX for the current props.
 * @param dependencies stores available in the render scope. Object keys become namespaces.
 * @example
 * ```tsx
 * const Title = component(
 *   ({ state }, { prefix }: { prefix: string }) => <h1>{prefix}{state.document.title}</h1>,
 *   { document: documentStore }
 * );
 * // <Title prefix="Editing: " />
 * ```
 */
export function component<
  const R extends StoreRegistry,
  Input extends object = EmptyRecord,
>(
  render: (scope: WorkspaceScope<R>, input: Input) => Renderable,
  dependencies: R & ValidNamespaceNames<R>
): ViewComponent<Input>;
export function component<
  const D extends readonly AnyStore[] = readonly [],
  Input extends object = EmptyRecord,
>(
  render: (scope: ViewScope<D>, input: Input) => Renderable,
  dependencies?: D & ValidDependencies<D>
): ViewComponent<Input>;
export function component<Input extends object>(
  render: (...args: never[]) => Renderable,
  dependencies: readonly AnyStore[] | StoreRegistry = []
): ViewComponent<Input> {
  const flat = Array.isArray(dependencies);
  const registry = flat ? undefined : extendRegistry(new Map(), dependencies as StoreRegistry);
  return (input) => ({
    kind: "store-view",
    dependencies: flat ? dependencies : [],
    ...(registry ? { registry } : {}),
    input,
    render: render as StoreViewVNode["render"],
    id: captureOwnerId(),
  });
}

type StoreRegistry = Record<string, AnyStore>;
type ValidNamespaceNames<R> = Record<Extract<keyof R, "$select" | "">, never>;
type WorkspaceState<R extends StoreRegistry> = {
  readonly [K in keyof R]: Readonly<StoreState<R[K]>>;
};

/** Store namespaces exposed to a component created by `componentScope`. */
export type WorkspaceScope<R extends StoreRegistry> = {
  readonly id: (localKey: string) => string;
  readonly state: WorkspaceState<R>;
  readonly $: {
    readonly [K in keyof R]: WritableBoundState<StoreState<R[K]>, UpdateContext>;
  } & Pick<BoundState<WorkspaceState<R>, UpdateContext>, "$select">;
  readonly acts: { readonly [K in keyof R]: StoreActs<R[K]> };
  readonly refs: { readonly [K in keyof R]: AppRefs<StoreRefs<R[K]>> };
};

/** A view factory with lazy store namespaces and optional local additions. */
export interface WorkspaceViewFactory<R extends StoreRegistry> {
  <Input extends object = EmptyRecord>(
    render: (scope: WorkspaceScope<R>, input: Input) => Renderable
  ): ViewComponent<Input>;
  <const Extra extends StoreRegistry, Input extends object = EmptyRecord>(
    render: (scope: WorkspaceScope<R & Extra>, input: Input) => Renderable,
    extra: Extra & ValidNamespaceNames<Extra> & Record<Extract<keyof Extra, keyof R>, never>
  ): ViewComponent<Input>;
}

/**
 * ![nexus-dom logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 *
 * Creates JSX components that resolve store namespaces on first access.
 * @param stores shared store descriptors keyed by namespace.
 * @example
 * ```tsx
 * const workspaceComponent = componentScope({ preferences, issues });
 * const Title = workspaceComponent(({ state }) => (
 *   <p class={state.preferences.theme}>{state.issues.items[0]?.title}</p>
 * ));
 * ```
 */
export function componentScope<const R extends StoreRegistry>(
  stores: R & ValidNamespaceNames<R>
): WorkspaceViewFactory<R> {
  const shared = extendRegistry(new Map(), stores);
  const factory = (render: StoreViewVNode["render"], extra?: StoreRegistry): ViewComponent<object> => {
    const registry = extra ? extendRegistry(new Map(shared), extra) : shared;
    return (input) => ({
      kind: "store-view",
      dependencies: [],
      registry,
      render,
      input,
      id: captureOwnerId(),
    });
  };
  return factory as WorkspaceViewFactory<R>;
}

function extendRegistry(registry: Map<string, AnyStore[]>, stores: StoreRegistry) {
  if (Array.isArray(stores)) {
    throw nexusDOMError("STORE_DEPENDENCY_CONFLICT", "Use an object with named store dependencies.");
  }
  for (const [name, store] of Object.entries(stores)) {
    if (name === "$select" || name === "") {
      throw nexusDOMError("STORE_DEPENDENCY_CONFLICT", `Store namespace "${name}" is reserved.`);
    }
    if (registry.has(name)) {
      throw nexusDOMError("STORE_DEPENDENCY_CONFLICT", `Store namespace "${name}" is already defined.`);
    }
    registry.set(name, [store]);
  }
  return registry;
}

interface ResolvedStore {
  nexus: Nexus<RecordAny, RecordAny>;
  refs: AppRefs<RecordAny>;
  mount?: () => void;
}

interface ResolvedScope {
  source: NexusSource<RecordAny, UpdateContext>;
  $: WritableBoundState<RecordAny, UpdateContext>;
  acts: RecordAny;
  refs: AppRefs<RecordAny>;
  mount?: () => void;
}

const createRefs = (values: RecordAny): AppRefs<RecordAny> =>
  Object.fromEntries(
    Object.entries(values).map(([key, current]) => [key, { current }])
  );

const createWritableBinding = (
  source: NexusSource<RecordAny, UpdateContext>,
  ownerForKey: (key: string) => ResolvedStore | undefined
): WritableBoundState<RecordAny, UpdateContext> => {
  const readonly = bind(source);
  const cache = new Map<PropertyKey, WritableLiveValue<unknown, UpdateContext>>();
  return new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === "$select") return readonly.$select;
      if (typeof property !== "string") return undefined;
      let value = cache.get(property);
      if (value) return value;
      const base = readonly[property]!;
      const owner = ownerForKey(property);
      if (!owner) return base;
      value = {
        [LIVE_VALUE]: true,
        get: () => base.get(),
        subscribe: (listener) => base.subscribe(listener),
        map: (project, isEqual) => base.map(project, isEqual),
        render: (project, options) => base.render(project, options),
        each: (base.each as any).bind(base),
        set(next, context = "$.set") {
          if (typeof next === "function") {
            owner.nexus.set(
              (state) => ({
                [property]: (next as (current: unknown) => unknown)(
                  state[property]
                ),
              }),
              context
            );
          } else {
            owner.nexus.set({ [property]: next }, context);
          }
        },
      };
      cache.set(property, value);
      return value;
    },
  });
};

export function createStoreViewRegistry(
  registryOptions: { runSetup?: boolean } = {}
): StoreViewResolver & { snapshots(): readonly StoreSnapshot[] } {
  const stores = new Map<AnyStore, ResolvedStore>();
  const storeOrder: ResolvedStore[] = [];
  const scopes = new WeakMap<readonly unknown[], ResolvedScope>();
  const resolving = new Set<AnyStore>();
  const cleanups: Array<() => void> = [];
  let restoreSnapshots: readonly StoreSnapshot[] | undefined;
  let restoreIndex = 0;
  let disposed = false;

  const sortedKeys = (value: RecordAny) => Object.keys(value).sort();
  const sameKeys = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length &&
    left.every((key, index) => key === right[index]);

  const resolveStore = (definition: AnyStore) => {
    const existing = stores.get(definition);
    if (existing) return existing;
    if (resolving.has(definition)) {
      throw nexusDOMError(
        "STORE_DEPENDENCY_CYCLE",
        "Store dependencies contain a cycle. Move shared state into a third store or remove one dependency."
      );
    }
    resolving.add(definition);
    const options = definition[STORE_OPTIONS];
    let consumedSnapshot = false;
    try {
      const dependencyScope = resolveScope(definition.dependencies);
      const dependencies = {
        get: ((key?: string) => {
          const state = dependencyScope.source.get();
          return key === undefined ? state : state[key];
        }) as Getter<RecordAny>,
        $: dependencyScope.$,
        acts: dependencyScope.acts,
        refs: dependencyScope.refs,
      };
      const refs = createRefs(options.refs ?? {});
      const expectedKeys = sortedKeys(options.state);
      const snapshot = restoreSnapshots?.[restoreIndex];
      let initialState = options.state;
      if (restoreSnapshots) {
        if (
          !snapshot ||
          !snapshot.state ||
          typeof snapshot.state !== "object" ||
          Array.isArray(snapshot.state) ||
          !sameKeys(expectedKeys, [...snapshot.keys].sort()) ||
          !sameKeys(expectedKeys, sortedKeys(snapshot.state))
        ) {
          throw nexusDOMError(
            "HYDRATION_STATE_INVALID",
            `Hydration snapshot ${restoreIndex} does not match store keys ${JSON.stringify(expectedKeys)}.`
          );
        }
        initialState = snapshot.state;
        restoreIndex++;
        consumedSnapshot = true;
      }
      let nexus: Nexus<RecordAny, RecordAny>;
      nexus = options.acts
        ? (createNexus({
            state: initialState,
            acts: (get, set) => {
              const helpers = createListHelpers(get, set);
              return options.acts!({
                get,
                set,
                reset: (...keys) => nexus.reset(...(keys as string[])),
                refs,
                list: helpers.list,
                dependencies,
              });
            },
          }) as Nexus<RecordAny, RecordAny>)
        : (createNexus({ state: initialState }) as Nexus<RecordAny, RecordAny>);
      const resolved: ResolvedStore = {
        nexus: nexus as Nexus<RecordAny, RecordAny>,
        refs,
      };
      stores.set(definition, resolved);
      storeOrder.push(resolved);

      if (registryOptions.runSetup !== false && (options.setup || options.mount)) {
        const ownCleanups = new Set<() => void>();
        const onCleanup = (cleanup: () => void) => {
          ownCleanups.add(cleanup);
          return () => ownCleanups.delete(cleanup);
        };
        const disposeSetup = () => {
          for (const cleanup of Array.from(ownCleanups).reverse()) cleanup();
          ownCleanups.clear();
        };
        const context = () => ({
          nexus,
          $: createWritableBinding(nexus, () => resolved),
          acts: nexus.acts,
          refs,
          dependencies,
          onCleanup,
        });
        try {
          const setupCleanup = options.setup?.(context());
          if (setupCleanup) ownCleanups.add(setupCleanup);
          cleanups.push(disposeSetup);
        } catch (error) {
          disposeSetup();
          stores.delete(definition);
          if (storeOrder.at(-1) === resolved) storeOrder.pop();
          throw error;
        }
        let mount = options.mount;
        if (mount || dependencyScope.mount) {
          resolved.mount = () => {
            if (disposed) return;
            dependencyScope.mount?.();
            if (disposed) return;
            const connect = mount;
            mount = undefined;
            if (!connect) return;
            const mountCleanups = new Set<() => void>();
            const disposeMount = () => {
              for (const stop of Array.from(mountCleanups).reverse()) stop();
              mountCleanups.clear();
            };
            try {
              const cleanup = connect({
                ...context(),
                onCleanup(cleanup) {
                  mountCleanups.add(cleanup);
                  return () => mountCleanups.delete(cleanup);
                },
              });
              if (cleanup) mountCleanups.add(cleanup);
            } catch (error) {
              disposeMount();
              throw error;
            }
            if (disposed) disposeMount();
            else ownCleanups.add(disposeMount);
          };
        }
      } else if (dependencyScope.mount) {
        resolved.mount = dependencyScope.mount;
      }
      return resolved;
    } catch (error) {
      if (consumedSnapshot) restoreIndex--;
      throw error;
    } finally {
      resolving.delete(definition);
    }
  };

  const mergeDomain = (
    target: RecordAny,
    values: RecordAny,
    domain: "state" | "acts" | "refs"
  ) => {
    for (const [key, value] of Object.entries(values)) {
      if (Object.prototype.hasOwnProperty.call(target, key)) {
        throw nexusDOMError(
          "STORE_DEPENDENCY_CONFLICT",
          `Store dependencies define the same ${domain} key "${key}".`
        );
      }
      target[key] = value;
    }
  };

  const resolveScope = (dependencies: readonly unknown[]) => {
    const existing = scopes.get(dependencies);
    if (existing) return existing;
    const resolved = dependencies.map((dependency) =>
      resolveStore(dependency as AnyStore)
    );
    const acts: RecordAny = {};
    const refs = {} as AppRefs<RecordAny>;
    const stateKeys = new Map<ResolvedStore, Set<string>>();
    const stateOwners = new Map<string, ResolvedStore>();
    for (const item of resolved) {
      const state = item.nexus.get();
      stateKeys.set(item, new Set(Object.keys(state)));
      for (const key of Object.keys(state)) {
        if (stateOwners.has(key)) {
          throw nexusDOMError(
            "STORE_DEPENDENCY_CONFLICT",
            `Store dependencies define the same state key "${key}".`
          );
        }
        stateOwners.set(key, item);
      }
      mergeDomain(acts, item.nexus.acts, "acts");
      mergeDomain(refs, item.refs, "refs");
    }
    const source: NexusSource<RecordAny, UpdateContext> = {
      get() {
        const state: RecordAny = {};
        for (const item of resolved) mergeDomain(state, item.nexus.get(), "state");
        return state;
      },
      subscribe(listener, dependenciesToWatch) {
        const unsubscribes = resolved.flatMap((item) => {
          const ownKeys = stateKeys.get(item)!;
          const keys =
            dependenciesToWatch[0] === "*"
              ? (["*"] as ["*"])
              : dependenciesToWatch.filter((key) => ownKeys.has(String(key)));
          if (keys.length === 0) return [];
          return [
            item.nexus.subscribe(
              (_state, context) => listener(source.get(), context),
              keys as ["*"] | string[]
            ),
          ];
        });
        return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
      },
    };
    // Validate state conflicts once, before any view project executes.
    source.get();
    const mounts = resolved.flatMap((item) => item.mount ? [item.mount] : []);
    const scope: ResolvedScope = {
      source,
      $: createWritableBinding(source, (key) => stateOwners.get(key)),
      acts,
      refs,
    };
    if (mounts.length) scope.mount = () => mounts.forEach((mount) => mount());
    scopes.set(dependencies, scope);
    return scope;
  };

  const resolveWorkspace = (
    vnode: StoreViewVNode,
    registry: NonNullable<StoreViewVNode["registry"]>
  ): TrackedViewVNode => {
    const scopes = new Map<string, ResolvedScope>();
    let mounted = false;
    const read = (name: string) => {
      let scope = scopes.get(name);
      if (scope) return scope;
      if (disposed) {
        throw nexusDOMError("APP_DISPOSED", "Cannot resolve a store after app disposal.");
      }
      scope = resolveScope(registry.get(name)!);
      scopes.set(name, scope);
      if (mounted) scope.mount?.();
      return scope;
    };
    const namespace = (get: (name: string) => unknown, target = Object.create(null)): RecordAny =>
      new Proxy(target, {
        get(_target, name) {
          if (typeof name === "string" && registry.has(name)) return get(name);
          return Reflect.get(_target, name);
        },
        has: (_target, name) =>
          (typeof name === "string" && registry.has(name)) || Reflect.has(_target, name),
        ownKeys: (_target) => [...registry.keys(), ...Reflect.ownKeys(_target)],
        getOwnPropertyDescriptor(_target, name) {
          if (typeof name === "string" && registry.has(name)) {
            return { enumerable: true, configurable: true, get: () => get(name) };
          }
          return Reflect.getOwnPropertyDescriptor(_target, name);
        },
      });
    const snapshot = (readState: (name: string) => RecordAny = (name) => read(name).source.get()) => {
      let values: Map<string, RecordAny> | undefined;
      return namespace((name) => {
        let value = values?.get(name);
        if (!value) {
          value = readState(name);
          (values ??= new Map()).set(name, value);
        }
        return value;
      });
    };
    const track = <R>(select: (state: RecordAny) => R) => {
      const used = new Set<string>();
      const value = select(snapshot((name) => {
        used.add(name);
        return read(name).source.get();
      }));
      return { value, dependencies: [...used] };
    };
    const source: NexusSource<RecordAny, UpdateContext> = {
      get: () => snapshot(),
      subscribe(listener, names) {
        const stop = names.map((name) =>
          read(name).source.subscribe((_state, context) => listener(snapshot(), context), ["*"])
        );
        return () => stop.forEach((unsubscribe) => unsubscribe());
      },
    };
    const trackFields = <R>(select: (state: RecordAny) => R) => {
      const stores = new Map<string, Set<string> | null>();
      const value = select(snapshot((name) => {
        const keys = new Set<string>();
        stores.set(name, keys);
        const record = (key: PropertyKey) => {
          if (typeof key === "string") keys.add(key);
          else stores.set(name, null);
        };
        return new Proxy(read(name).source.get(), {
          get(target, key, receiver) {
            record(key);
            return Reflect.get(target, key, receiver);
          },
          has(target, key) {
            record(key);
            return Reflect.has(target, key);
          },
          getOwnPropertyDescriptor(target, key) {
            record(key);
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
          ownKeys(target) {
            stores.set(name, null);
            return Reflect.ownKeys(target);
          },
        });
      }));
      const dependencies: string[] = [];
      for (const [name, keys] of stores) {
        if (!keys?.size) dependencies.push(JSON.stringify([name, null]));
        else for (const key of keys) dependencies.push(JSON.stringify([name, key]));
      }
      return { value, dependencies };
    };
    const fieldSource: NexusSource<RecordAny, UpdateContext> = {
      get: source.get,
      subscribe(listener, dependencies) {
        const byStore = new Map<string, string[]>();
        for (const dependency of dependencies) {
          const [name, key] = JSON.parse(dependency) as [string, string | null];
          let keys = byStore.get(name);
          if (!keys) byStore.set(name, (keys = []));
          keys.push(key ?? "*");
        }
        const stop = Array.from(byStore, ([name, keys]) =>
          read(name).source.subscribe((_state, context) => listener(snapshot(), context), keys)
        );
        return () => stop.forEach((unsubscribe) => unsubscribe());
      },
    };
    const $ = namespace((name) => read(name).$, {
      __proto__: null,
      $select: <R>(select: (state: RecordAny) => R, isEqual?: (left: R, right: R) => boolean) =>
        createTrackedSelector(fieldSource, select, () => trackFields(select), isEqual),
    });
    const acts = namespace((name) => read(name).acts);
    const refs = namespace((name) => read(name).refs);
    const project = (state: RecordAny) =>
      vnode.render({ id: vnode.id, state, $, acts, refs }, vnode.input);
    return {
      kind: "tracked-view",
      source,
      project,
      track: () => track(project),
      mountStores() {
        mounted = true;
        for (const scope of scopes.values()) scope.mount?.();
      },
    };
  };

  return {
    restore(snapshots) {
      if (stores.size > 0) {
        throw nexusDOMError(
          "HYDRATION_STATE_LATE",
          "Hydration state must be restored before the first lazy store is resolved."
        );
      }
      restoreSnapshots = snapshots;
      restoreIndex = 0;
    },
    completeRestore() {
      if (restoreSnapshots && restoreIndex !== restoreSnapshots.length) {
        throw nexusDOMError(
          "HYDRATION_STATE_INVALID",
          `Hydration provided ${restoreSnapshots.length} store snapshots, but the view resolved ${restoreIndex}.`
        );
      }
      restoreSnapshots = undefined;
    },
    snapshots() {
      return storeOrder.map(({ nexus }) => {
        const state = nexus.get();
        return { keys: sortedKeys(state), state };
      });
    },
    resolve(vnode): TrackedViewVNode {
      if (vnode.registry) return resolveWorkspace(vnode, vnode.registry);
      const scope = resolveScope(vnode.dependencies);
      return {
        kind: "tracked-view",
        source: scope.source,
        ...(scope.mount ? { mountStores: scope.mount } : {}),
        project: (state) =>
          vnode.render(
            {
              id: vnode.id,
              state,
              $: scope.$,
              acts: scope.acts,
              refs: scope.refs,
            },
            vnode.input
          ),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (let index = cleanups.length - 1; index >= 0; index--) {
        cleanups[index]?.();
      }
      cleanups.length = 0;
      stores.clear();
      storeOrder.length = 0;
    },
  };
}
