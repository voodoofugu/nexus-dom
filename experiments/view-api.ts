import type { Getter, Setter, UpdateContext } from "nexus-state";
import type {
  AppHelpers,
  AppRefs,
  BoundState,
  Renderable,
  VNode,
} from "../src/index.js";

type RecordAny = Record<string, any>;
type EmptyRecord = Record<string, never>;

declare const STORE_TYPES: unique symbol;

/** Type-only descriptor. It contains no state until an app resolves it. */
export interface StoreDefinition<
  S extends RecordAny,
  A extends RecordAny = EmptyRecord,
  R extends RecordAny = EmptyRecord,
> {
  readonly [STORE_TYPES]: {
    readonly state: S;
    readonly acts: A;
    readonly refs: R;
  };
}

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

/** Declares a lazy store without creating an application-global singleton. */
export declare function store<
  S extends RecordAny,
  R extends RecordAny = EmptyRecord,
  A extends RecordAny = EmptyRecord,
>(options: StoreOptions<S, A, R>): StoreDefinition<S, A, R>;

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

type StateConflicts<
  D extends readonly AnyStore[],
  Seen extends PropertyKey = never,
> = D extends readonly [
  infer Head extends AnyStore,
  ...infer Tail extends readonly AnyStore[],
]
  ? Extract<keyof StoreState<Head>, Seen> |
      StateConflicts<Tail, Seen | keyof StoreState<Head>>
  : never;

type ActsConflicts<
  D extends readonly AnyStore[],
  Seen extends PropertyKey = never,
> = D extends readonly [
  infer Head extends AnyStore,
  ...infer Tail extends readonly AnyStore[],
]
  ? Extract<keyof StoreActs<Head>, Seen> |
      ActsConflicts<Tail, Seen | keyof StoreActs<Head>>
  : never;

type RefsConflicts<
  D extends readonly AnyStore[],
  Seen extends PropertyKey = never,
> = D extends readonly [
  infer Head extends AnyStore,
  ...infer Tail extends readonly AnyStore[],
]
  ? Extract<keyof StoreRefs<Head>, Seen> |
      RefsConflicts<Tail, Seen | keyof StoreRefs<Head>>
  : never;

type StoreConflicts<D extends readonly AnyStore[]> = {
  state: StateConflicts<D>;
  acts: ActsConflicts<D>;
  refs: RefsConflicts<D>;
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

type ViewFactory<Inputs extends readonly unknown[]> = (
  ...inputs: Inputs
) => VNode | null;

/** Defines a component whose ordinary state reads form its tracked view. */
export declare function view(
  render: (scope: ViewScope<readonly []>) => Renderable
): ViewFactory<readonly []>;

export declare function view<
  const D extends readonly AnyStore[],
  Inputs extends readonly unknown[] = readonly [],
>(
  render: (scope: ViewScope<D>, ...inputs: Inputs) => Renderable,
  dependencies: D & ValidDependencies<D>
): ViewFactory<Inputs>;
