import type { Nexus, UpdateContext } from "nexus-state";
import {
  LIVE_VALUE,
  type BoundState,
  type DynamicVNode,
  type EqualityFn,
  type LiveListener,
  type LiveItem,
  type LiveValue,
  type KeyedVNode,
  type NexusSource,
  type Renderable,
} from "./types.js";

const sameValue: EqualityFn<unknown> = Object.is;
const bindingCache = new WeakMap<object, object>();
const sourceKeys = new WeakMap<object, PropertyKey>();

interface Tracked<R, S extends object> {
  value: R;
  dependencies: ["*"] | (keyof S)[];
}

function trackSelector<S extends object, R>(
  state: S,
  selector: (state: S) => R
): Tracked<R, S> {
  const keys = new Set<keyof S>();
  let all = false;

  const proxy = new Proxy(state, {
    get(target, property, receiver) {
      if (property in target) keys.add(property as keyof S);
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      if (property in target) keys.add(property as keyof S);
      return Reflect.has(target, property);
    },
    ownKeys(target) {
      all = true;
      return Reflect.ownKeys(target);
    },
  });

  return {
    value: selector(proxy),
    dependencies: all ? ["*"] : Array.from(keys),
  };
}

function sameDependencies<S extends object>(
  left: ["*"] | (keyof S)[],
  right: ["*"] | (keyof S)[]
) {
  if (left.length !== right.length) return false;
  if (left[0] === "*" || right[0] === "*") return left[0] === right[0];
  const rightKeys = right as (keyof S)[];
  return (left as (keyof S)[]).every((key) => rightKeys.includes(key));
}

function mapLive<T, U, C>(
  source: LiveValue<T, C>,
  project: (value: T) => U,
  isEqual: EqualityFn<U> = Object.is
): LiveValue<U, C> {
  return {
    [LIVE_VALUE]: true,
    get: () => project(source.get()),
    subscribe(listener) {
      let current = project(source.get());
      return source.subscribe((value, context) => {
        const next = project(value);
        if (isEqual(current, next)) return;
        current = next;
        listener(next, context);
      });
    },
    map<V>(nextProject: (value: U) => V, nextEqual?: EqualityFn<V>) {
      return mapLive(this, nextProject, nextEqual);
    },
    render(
      project: (value: U) => Renderable,
      options?: { key?: (value: U) => unknown }
    ) {
      return renderLive(this, project, options);
    },
    each<Item, Key extends PropertyKey>(
      this: LiveValue<readonly Item[], C>,
      key: (item: Item) => Key,
      project: (item: LiveItem<Item, C>) => Renderable
    ) {
      return eachLive(this, key, project);
    },
  };
}

export function createMutableLiveItem<T, C>(initial: T) {
  let current = initial;
  const listeners = new Set<LiveListener<T, C>>();
  const fields = new Map<PropertyKey, LiveValue<unknown, C>>();

  const live: LiveValue<T, C> = {
    [LIVE_VALUE]: true,
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    map<U>(project: (value: T) => U, isEqual?: EqualityFn<U>) {
      return mapLive(this, project, isEqual);
    },
    render(
      project: (value: T) => Renderable,
      options?: { key?: (value: T) => unknown }
    ) {
      return renderLive(this, project, options);
    },
    each<Item, Key extends PropertyKey>(
      this: LiveValue<readonly Item[], C>,
      key: (item: Item) => Key,
      project: (item: LiveItem<Item, C>) => Renderable
    ) {
      return eachLive(this, key, project);
    },
  };

  const item = new Proxy(live as LiveItem<T, C>, {
    get(target, property, receiver) {
      if (property in target) return Reflect.get(target, property, receiver);
      let field = fields.get(property);
      if (!field) {
        field = mapLive(live, (value) =>
          value === null || value === undefined
            ? undefined
            : (value as Record<PropertyKey, unknown>)[property]
        );
        fields.set(property, field);
      }
      return field;
    },
  });

  return {
    live: item,
    set(value: T, context?: C) {
      if (Object.is(current, value)) return;
      current = value;
      for (const listener of Array.from(listeners)) listener(value, context);
    },
  };
}

function renderLive<T, C>(
  source: LiveValue<T, C>,
  project: (value: T) => Renderable,
  options?: { key?: (value: T) => unknown }
): DynamicVNode {
  return {
    kind: "dynamic",
    source: source as LiveValue<unknown, unknown>,
    project: project as (value: unknown) => Renderable,
    ...(options?.key
      ? { key: options.key as (value: unknown) => unknown }
      : {}),
  };
}

function eachLive<Item, Key extends PropertyKey, C>(
  source: LiveValue<readonly Item[], C>,
  key: (item: Item) => Key,
  project: (item: LiveItem<Item, C>) => Renderable
): KeyedVNode {
  const stateKey = sourceKeys.get(source);
  return {
    kind: "keyed",
    source: source as LiveValue<readonly unknown[], unknown>,
    ...(stateKey === undefined ? {} : { stateKey }),
    key: key as (item: unknown) => PropertyKey,
    project: project as (item: LiveItem<unknown, unknown>) => Renderable,
  };
}

function selectorLive<S extends object, R, C>(
  nexus: NexusSource<S, C>,
  selector: (state: S) => R,
  isEqual: EqualityFn<R> = Object.is,
  sourceKey?: PropertyKey
): LiveValue<R, C> {
  const live: LiveValue<R, C> = {
    [LIVE_VALUE]: true,
    get: () => selector(nexus.get()),
    subscribe(listener: LiveListener<R, C>) {
      let tracked = trackSelector(nexus.get(), selector);
      let current = tracked.value;
      let dependencies = tracked.dependencies;
      let disposed = false;
      let unsubscribe = () => {};

      const handle = (state: S, context?: C) => {
        if (disposed) return;
        const next = trackSelector(state, selector);

        if (!sameDependencies(dependencies, next.dependencies)) {
          const previousUnsubscribe = unsubscribe;
          dependencies = next.dependencies;
          unsubscribe = nexus.subscribe(handle, dependencies);
          previousUnsubscribe();
        }

        if (isEqual(current, next.value)) return;
        current = next.value;
        listener(next.value, context);
      };

      unsubscribe = nexus.subscribe(handle, dependencies);

      return () => {
        if (disposed) return;
        disposed = true;
        unsubscribe();
      };
    },
    map<U>(project: (value: R) => U, nextEqual?: EqualityFn<U>) {
      return mapLive(this, project, nextEqual);
    },
    render(
      project: (value: R) => Renderable,
      options?: { key?: (value: R) => unknown }
    ) {
      return renderLive(this, project, options);
    },
    each<Item, Key extends PropertyKey>(
      this: LiveValue<readonly Item[], C>,
      key: (item: Item) => Key,
      project: (item: LiveItem<Item, C>) => Renderable
    ) {
      return eachLive(this, key, project);
    },
  };
  if (sourceKey !== undefined) sourceKeys.set(live, sourceKey);
  return live;
}

/**
 * Creates stable live values for the keys and selectors of a nexus store.
 * `$select` is reserved by the binding proxy.
 */
export function bind<
  S extends Record<string, any>,
  A extends Record<string, any>
>(
  nexus: Nexus<S, A>
): BoundState<S, UpdateContext>;
export function bind<S extends object, C = unknown>(
  nexus: NexusSource<S, C>
): BoundState<S, C>;
export function bind<S extends object, C = unknown>(
  nexus: NexusSource<S, C>
): BoundState<S, C> {
  const existing = bindingCache.get(nexus);
  if (existing) return existing as BoundState<S, C>;

  const cache = new Map<PropertyKey, LiveValue<unknown, C>>();

  const binding = new Proxy(Object.create(null) as BoundState<S, C>, {
    get(_target, property) {
      if (property === "$select") {
        return <R>(selector: (state: S) => R, isEqual?: EqualityFn<R>) =>
          selectorLive(nexus, selector, isEqual);
      }

      let value = cache.get(property);
      if (!value) {
        value = selectorLive(
          nexus,
          (state) => state[property as keyof S],
          Object.is,
          property
        );
        cache.set(property, value);
      }
      return value;
    },
  });

  bindingCache.set(nexus, binding);
  return binding;
}

export function isLiveValue(value: unknown): value is LiveValue<unknown, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<LiveValue<unknown>>)[LIVE_VALUE] === true
  );
}

export { selectorLive as createLiveSelector };
