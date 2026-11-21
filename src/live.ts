import type { Nexus, UpdateContext } from "nexus-state";
import {
  LIVE_VALUE,
  type BoundState,
  type EqualityFn,
  type LiveListener,
  type LiveValue,
  type NexusSource,
} from "./types.js";

const sameValue: EqualityFn<unknown> = Object.is;

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
  };
}

function selectorLive<S extends object, R, C>(
  nexus: NexusSource<S, C>,
  selector: (state: S) => R,
  isEqual: EqualityFn<R> = Object.is
): LiveValue<R, C> {
  return {
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
  };
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
  const cache = new Map<PropertyKey, LiveValue<unknown, C>>();

  return new Proxy(Object.create(null) as BoundState<S, C>, {
    get(_target, property) {
      if (property === "$select") {
        return <R>(selector: (state: S) => R, isEqual?: EqualityFn<R>) =>
          selectorLive(nexus, selector, isEqual);
      }

      let value = cache.get(property);
      if (!value) {
        value = selectorLive(nexus, (state) => state[property as keyof S]);
        cache.set(property, value);
      }
      return value;
    },
  });
}

export function isLiveValue(value: unknown): value is LiveValue<unknown, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<LiveValue<unknown>>)[LIVE_VALUE] === true
  );
}

export { selectorLive as createLiveSelector };
