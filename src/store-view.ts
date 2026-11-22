import {
  createNexus,
  type Getter,
  type Nexus,
  type Setter,
  type UpdateContext,
} from "nexus-state";
import { nexusDOMError } from "./errors.js";
import { bind } from "./live.js";
import { createListHelpers, type AppHelpers } from "./list.js";
import type { AppRefs } from "./app.js";
import type {
  BoundState,
  NexusSource,
  Renderable,
  StoreViewResolver,
  StoreViewVNode,
  TrackedViewVNode,
  VNode,
} from "./types.js";

type RecordAny = Record<string, any>;
type EmptyRecord = {};
const STORE_OPTIONS = Symbol("nexus-dom.store-options");
declare const STORE_TYPES: unique symbol;

export interface StoreOptions<
  S extends RecordAny,
  A extends RecordAny,
  R extends RecordAny,
> {
  state: S;
  refs?: R;
  acts?: (
    get: Getter<S>,
    set: Setter<S>,
    refs: AppRefs<R>,
    helpers: AppHelpers<S>
  ) => A;
}

export interface StoreDefinition<
  S extends RecordAny,
  A extends RecordAny = EmptyRecord,
  R extends RecordAny = EmptyRecord,
> {
  readonly [STORE_OPTIONS]: StoreOptions<any, any, any>;
  readonly [STORE_TYPES]: {
    readonly state: S;
    readonly acts: A;
    readonly refs: R;
  };
}

export function store<
  S extends RecordAny,
  R extends RecordAny = EmptyRecord,
  A extends RecordAny = EmptyRecord,
>(options: StoreOptions<S, A, R>): StoreDefinition<S, A, R> {
  return { [STORE_OPTIONS]: options } as StoreDefinition<S, A, R>;
}

type AnyStore = StoreDefinition<RecordAny, RecordAny, RecordAny>;
type StoreState<T> = T extends StoreDefinition<infer S, any, any> ? S : never;
type StoreActs<T> = T extends StoreDefinition<any, infer A, any> ? A : never;
type StoreRefs<T> = T extends StoreDefinition<any, any, infer R> ? R : never;
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
  readonly state: Readonly<DependencyState<D>>;
  readonly $: BoundState<DependencyState<D>, UpdateContext>;
  readonly acts: DependencyActs<D>;
  readonly refs: AppRefs<DependencyRefs<D>>;
}

type ViewComponent<Input extends object = EmptyRecord> = (
  input: Input & { children?: Renderable }
) => VNode | null;

export function view<
  const D extends readonly AnyStore[] = readonly [],
  Input extends object = EmptyRecord,
>(
  render: (scope: ViewScope<D>, input: Input) => Renderable,
  dependencies: D & ValidDependencies<D> = [] as unknown as D &
    ValidDependencies<D>
): ViewComponent<Input> {
  return (input) => ({
    kind: "store-view",
    dependencies,
    input,
    render: render as StoreViewVNode["render"],
  });
}

interface ResolvedStore {
  nexus: Nexus<RecordAny, RecordAny>;
  refs: AppRefs<RecordAny>;
}

interface ResolvedScope {
  source: NexusSource<RecordAny, UpdateContext>;
  $: BoundState<RecordAny, UpdateContext>;
  acts: RecordAny;
  refs: AppRefs<RecordAny>;
}

const createRefs = (values: RecordAny): AppRefs<RecordAny> =>
  Object.fromEntries(
    Object.entries(values).map(([key, current]) => [key, { current }])
  );

export function createStoreViewRegistry(): StoreViewResolver {
  const stores = new Map<AnyStore, ResolvedStore>();
  const scopes = new WeakMap<readonly unknown[], ResolvedScope>();

  const resolveStore = (definition: AnyStore) => {
    const existing = stores.get(definition);
    if (existing) return existing;
    const options = definition[STORE_OPTIONS];
    const refs = createRefs(options.refs ?? {});
    const nexus = options.acts
      ? createNexus({
          state: options.state,
          acts: (get, set) =>
            options.acts!(get, set, refs, createListHelpers(get, set)),
        })
      : createNexus({ state: options.state });
    const resolved = {
      nexus: nexus as Nexus<RecordAny, RecordAny>,
      refs,
    };
    stores.set(definition, resolved);
    return resolved;
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
    for (const item of resolved) {
      const state = item.nexus.get();
      stateKeys.set(item, new Set(Object.keys(state)));
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
    const scope = { source, $: bind(source), acts, refs };
    scopes.set(dependencies, scope);
    return scope;
  };

  return {
    resolve(vnode): TrackedViewVNode {
      const scope = resolveScope(vnode.dependencies);
      return {
        kind: "tracked-view",
        source: scope.source,
        project: (state) =>
          vnode.render(
            { state, $: scope.$, acts: scope.acts, refs: scope.refs },
            vnode.input
          ),
      };
    },
  };
}
