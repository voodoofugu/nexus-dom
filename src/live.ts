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
import { sameDependencies, trackSelector } from "./tracking.js";

const sameValue: EqualityFn<unknown> = Object.is;
const bindingCache = new WeakMap<object, object>();
const sourceKeys = new WeakMap<object, PropertyKey>();

class MappedLiveValue<T, U, C> implements LiveValue<U, C> {
  readonly [LIVE_VALUE] = true as const;

  constructor(
    private readonly source: LiveValue<T, C>,
    private readonly project: (value: T) => U,
    private readonly isEqual: EqualityFn<U>
  ) {}

  get() {
    return this.project(this.source.get());
  }

  subscribe(listener: LiveListener<U, C>) {
    let current = this.project(this.source.get());
    return this.source.subscribe((value, context) => {
      const next = this.project(value);
      if (this.isEqual(current, next)) return;
      current = next;
      listener(next, context);
    });
  }

  map<V>(
    nextProject: (value: U) => V,
    nextEqual?: EqualityFn<V>
  ): LiveValue<V, C> {
    return mapLive(this, nextProject, nextEqual);
  }

  render(
    project: (value: U) => Renderable,
    options?: { key?: (value: U) => unknown }
  ): DynamicVNode {
    return renderLive(this, project, options);
  }

  each<Item, Key extends PropertyKey>(
    this: LiveValue<readonly Item[], C>,
    key: (item: Item) => Key,
    project: (item: LiveItem<Item, C>) => Renderable
  ): KeyedVNode {
    return eachLive(this, key, project);
  }
}

const readField = (value: unknown, property: PropertyKey) =>
  value === null || value === undefined
    ? undefined
    : (value as Record<PropertyKey, unknown>)[property];

class FieldLiveValue<T, C> implements LiveValue<unknown, C> {
  readonly [LIVE_VALUE] = true as const;
  private listeners: MutableListeners<unknown, C>;

  constructor(
    private readonly source: LiveValue<T, C>,
    readonly property: PropertyKey
  ) {}

  get() {
    return readField(this.source.get(), this.property);
  }

  subscribe(listener: LiveListener<unknown, C>) {
    const current = this.listeners;
    if (!current) this.listeners = listener;
    else if (current instanceof Set) current.add(listener);
    else this.listeners = new Set([current, listener]);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const listeners = this.listeners;
      if (listeners === listener) {
        this.listeners = undefined;
      } else if (listeners instanceof Set) {
        listeners.delete(listener);
        if (listeners.size === 1) {
          this.listeners = listeners.values().next().value;
        }
      }
    };
  }

  update(previous: unknown, next: unknown, context?: C) {
    const previousField = readField(previous, this.property);
    const nextField = readField(next, this.property);
    if (Object.is(previousField, nextField)) return;
    const listeners = this.listeners;
    if (!listeners) return;
    if (listeners instanceof Set) {
      for (const listener of Array.from(listeners)) {
        listener(nextField, context);
      }
    } else {
      listeners(nextField, context);
    }
  }

  map<U>(
    project: (value: unknown) => U,
    isEqual?: EqualityFn<U>
  ): LiveValue<U, C> {
    return mapLive(this, project, isEqual);
  }

  render(
    project: (value: unknown) => Renderable,
    options?: { key?: (value: unknown) => unknown }
  ): DynamicVNode {
    return renderLive(this, project, options);
  }

  each<Item, Key extends PropertyKey>(
    this: LiveValue<readonly Item[], C>,
    key: (item: Item) => Key,
    project: (item: LiveItem<Item, C>) => Renderable
  ): KeyedVNode {
    return eachLive(this, key, project);
  }
}

function mapLive<T, U, C>(
  source: LiveValue<T, C>,
  project: (value: T) => U,
  isEqual: EqualityFn<U> = Object.is
): LiveValue<U, C> {
  return new MappedLiveValue(source, project, isEqual);
}

const MUTABLE_CURRENT = Symbol("nexus-dom.mutable-current");
const MUTABLE_LISTENERS = Symbol("nexus-dom.mutable-listeners");
const MUTABLE_FIELDS = Symbol("nexus-dom.mutable-fields");

type MutableListeners<T, C> =
  | LiveListener<T, C>
  | Set<LiveListener<T, C>>
  | undefined;

type MutableFields<C> =
  | FieldLiveValue<unknown, C>
  | Map<PropertyKey, FieldLiveValue<unknown, C>>
  | undefined;

class MutableLiveValue<T, C> implements LiveValue<T, C> {
  readonly [LIVE_VALUE] = true as const;
  private [MUTABLE_CURRENT]: T;
  private [MUTABLE_LISTENERS]: MutableListeners<T, C>;
  private [MUTABLE_FIELDS]: MutableFields<C>;

  constructor(initial: T) {
    this[MUTABLE_CURRENT] = initial;
  }

  get() {
    return this[MUTABLE_CURRENT];
  }

  subscribe(listener: LiveListener<T, C>) {
    const current = this[MUTABLE_LISTENERS];
    if (!current) this[MUTABLE_LISTENERS] = listener;
    else if (current instanceof Set) current.add(listener);
    else this[MUTABLE_LISTENERS] = new Set([current, listener]);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const listeners = this[MUTABLE_LISTENERS];
      if (listeners === listener) {
        this[MUTABLE_LISTENERS] = undefined;
      } else if (listeners instanceof Set) {
        listeners.delete(listener);
        if (listeners.size === 1) {
          this[MUTABLE_LISTENERS] = listeners.values().next().value;
        }
      }
    };
  }

  map<U>(
    project: (value: T) => U,
    isEqual?: EqualityFn<U>
  ): LiveValue<U, C> {
    return mapLive(this, project, isEqual);
  }

  render(
    project: (value: T) => Renderable,
    options?: { key?: (value: T) => unknown }
  ): DynamicVNode {
    return renderLive(this, project, options);
  }

  each<Item, Key extends PropertyKey>(
    this: LiveValue<readonly Item[], C>,
    key: (item: Item) => Key,
    project: (item: LiveItem<Item, C>) => Renderable
  ): KeyedVNode {
    return eachLive(this, key, project);
  }

  $field(property: PropertyKey): LiveValue<unknown, C> {
    const fields = this[MUTABLE_FIELDS];
    if (!fields) {
      const field = new FieldLiveValue(this, property);
      this[MUTABLE_FIELDS] = field;
      return field;
    }
    if (fields instanceof Map) {
      let field = fields.get(property);
      if (!field) {
        field = new FieldLiveValue(this, property);
        fields.set(property, field);
      }
      return field;
    }
    if (fields.property === property) return fields;

    const field = new FieldLiveValue(this, property);
    this[MUTABLE_FIELDS] = new Map([
      [fields.property, fields],
      [property, field],
    ]);
    return field;
  }

  set(value: T, context?: C) {
    const previous = this[MUTABLE_CURRENT];
    if (Object.is(previous, value)) return;
    this[MUTABLE_CURRENT] = value;
    const listeners = this[MUTABLE_LISTENERS];
    if (listeners instanceof Set) {
      for (const listener of Array.from(listeners)) listener(value, context);
    } else if (listeners) {
      listeners(value, context);
    }

    const fields = this[MUTABLE_FIELDS];
    if (!fields) return;
    if (fields instanceof Map) {
      for (const field of fields.values()) {
        field.update(previous, value, context);
      }
    } else {
      fields.update(previous, value, context);
    }
  }
}

const mutableItemProxyHandler: ProxyHandler<
  MutableLiveValue<unknown, unknown>
> = {
  get(target, property, receiver) {
    if (property in target) return Reflect.get(target, property, receiver);
    return target.$field(property);
  },
};

export function createMutableLiveItem<T, C>(initial: T) {
  const mutable = new MutableLiveValue<T, C>(initial);

  const item = new Proxy(
    mutable,
    mutableItemProxyHandler as ProxyHandler<MutableLiveValue<T, C>>
  ) as unknown as LiveItem<T, C>;

  return {
    live: item,
    controller: mutable,
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
  sourceKey?: PropertyKey,
  track = (state: S) => trackSelector(state, selector)
): LiveValue<R, C> {
  const live: LiveValue<R, C> = {
    [LIVE_VALUE]: true,
    get: () => selector(nexus.get()),
    subscribe(listener: LiveListener<R, C>) {
      const tracked = track(nexus.get());
      let current = tracked.value;
      let dependencies = tracked.dependencies;
      let disposed = false;
      let unsubscribe = () => {};

      const handle = (state: S, context?: C) => {
        if (disposed) return;
        const next = track(state);

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

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***bind***:
 * creates stable live bindings for the fields of an existing Nexus store.
 * @param nexus store to read and subscribe to.
 * @returns the cached binding object with each field and `$select`.
 * @example
 * ```tsx
 * const $ = bind(nexus);
 * render(<span>{$.count}</span>, "#app");
 * ```
 */
export function bind<
  S extends Record<string, any>,
  A extends Record<string, any>
>(
  nexus: Nexus<S, A>
): BoundState<S, UpdateContext>;
/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***bind***:
 * creates stable live bindings from a compatible state source.
 * @param nexus source implementing `get` and `subscribe`.
 * @returns the cached binding object with each field and `$select`.
 */
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

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***isLiveValue***:
 * checks whether a value is a Nexus DOM live binding.
 * @param value the value to narrow.
 * @returns whether the value implements the live-value protocol.
 */
export function isLiveValue(value: unknown): value is LiveValue<unknown, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<LiveValue<unknown>>)[LIVE_VALUE] === true
  );
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***when***:
 * chooses an owned JSX branch from the truthiness of a live value.
 * @param source a live condition.
 * @param truthy JSX to mount while the condition is truthy.
 * @param fallback optional JSX to mount otherwise.
 * @returns a renderable dynamic branch.
 * @example
 * ```tsx
 * const panel = when($.signedIn, <Profile />, <SignIn />);
 * ```
 */
export function when<T, C>(
  source: LiveValue<T, C>,
  truthy: Renderable,
  fallback?: Renderable
): DynamicVNode {
  return source
    .map((value) => Boolean(value))
    .render((visible) => (visible ? truthy : fallback));
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***createLiveSelector***:
 * creates a standalone live value derived from a state source.
 * @param source store or compatible source to observe.
 * @param selector computes a value from the current state.
 * @param isEqual optional comparison for successive results. Defaults to `Object.is`.
 * @param sourceKey optional known top-level dependency.
 * @returns a live value that notifies when its selected result changes.
 */
export function createLiveSelector<S extends object, R, C>(
  source: NexusSource<S, C>,
  selector: (state: S) => R,
  isEqual?: EqualityFn<R>,
  sourceKey?: PropertyKey
): LiveValue<R, C> {
  return selectorLive(source, selector, isEqual, sourceKey);
}

export function createTrackedSelector<S extends object, R, C>(
  source: NexusSource<S, C>,
  selector: (state: S) => R,
  track: (state: S) => ReturnType<typeof trackSelector<S, R>>,
  isEqual?: EqualityFn<R>
): LiveValue<R, C> {
  return selectorLive(source, selector, isEqual, undefined, track);
}
