import type { Getter, Setter, UpdateContext } from "nexus-state";

type RecordAny = Record<string, any>;

export type ArrayKey<S extends RecordAny> = {
  [K in keyof S]: S[K] extends readonly unknown[] ? K : never;
}[keyof S];

export type ArrayItem<T> = T extends readonly (infer Item)[] ? Item : never;

export type ListOperation =
  | { key: PropertyKey; type: "insert"; index: number; count: number }
  | { key: PropertyKey; type: "remove"; index: number; count: number }
  | { key: PropertyKey; type: "move"; from: number; to: number }
  | { key: PropertyKey; type: "replace"; index: number }
  | { key: PropertyKey; type: "reorder" }
  | { key: PropertyKey; type: "set" };

export interface ListController<Item> {
  append(...items: Item[]): void;
  insert(index: number, ...items: Item[]): void;
  remove(index: number, count?: number): void;
  move(from: number, to: number): void;
  replace(index: number, item: Item): void;
  reverse(): void;
  set(items: readonly Item[]): void;
}

export interface AppHelpers<S extends RecordAny> {
  list<K extends ArrayKey<S>>(key: K): ListController<ArrayItem<S[K]>>;
}

const contextFor = (operation: ListOperation): UpdateContext => ({
  source: `list.${operation.type}`,
  meta: { nexusDOM: { list: operation } },
});

function assertIndex(index: number, length: number, allowEnd = false) {
  const maximum = allowEnd ? length : length - 1;
  if (!Number.isInteger(index) || index < 0 || index > maximum) {
    throw new RangeError(
      `[nexus-dom] List index ${index} is outside 0..${Math.max(maximum, 0)}.`
    );
  }
}

export function createListHelpers<S extends RecordAny>(
  get: Getter<S>,
  set: Setter<S>
): AppHelpers<S> {
  const controllers = new Map<PropertyKey, ListController<unknown>>();

  return {
    list<K extends ArrayKey<S>>(key: K) {
      const cached = controllers.get(key);
      if (cached) return cached as ListController<ArrayItem<S[K]>>;

      const read = () => get(key) as readonly ArrayItem<S[K]>[];
      const write = (
        items: readonly ArrayItem<S[K]>[],
        operation: ListOperation
      ) => set({ [key]: items } as Partial<S>, contextFor(operation));

      const controller: ListController<ArrayItem<S[K]>> = {
        append(...items) {
          if (items.length === 0) return;
          const current = read();
          write([...current, ...items], {
            key,
            type: "insert",
            index: current.length,
            count: items.length,
          });
        },
        insert(index, ...items) {
          if (items.length === 0) return;
          const current = read();
          assertIndex(index, current.length, true);
          write([...current.slice(0, index), ...items, ...current.slice(index)], {
            key,
            type: "insert",
            index,
            count: items.length,
          });
        },
        remove(index, count = 1) {
          const current = read();
          assertIndex(index, current.length);
          if (
            !Number.isInteger(count) ||
            count < 1 ||
            index + count > current.length
          ) {
            throw new RangeError("[nexus-dom] Invalid list removal count.");
          }
          write([...current.slice(0, index), ...current.slice(index + count)], {
            key,
            type: "remove",
            index,
            count,
          });
        },
        move(from, to) {
          const current = [...read()];
          assertIndex(from, current.length);
          assertIndex(to, current.length);
          if (from === to) return;
          const [item] = current.splice(from, 1);
          current.splice(to, 0, item!);
          write(current, { key, type: "move", from, to });
        },
        replace(index, item) {
          const current = [...read()];
          assertIndex(index, current.length);
          current[index] = item;
          write(current, { key, type: "replace", index });
        },
        reverse() {
          const current = read();
          if (current.length < 2) return;
          write([...current].reverse(), { key, type: "reorder" });
        },
        set(items) {
          write([...items], { key, type: "set" });
        },
      };

      controllers.set(key, controller as ListController<unknown>);
      return controller;
    },
  };
}

export function readListOperation(
  context: unknown,
  stateKey: PropertyKey | undefined
): ListOperation | undefined {
  if (stateKey === undefined || !context || typeof context !== "object") return;
  const meta = (context as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return;
  const nexusDOM = (meta as { nexusDOM?: unknown }).nexusDOM;
  if (!nexusDOM || typeof nexusDOM !== "object") return;
  const operation = (nexusDOM as { list?: unknown }).list;
  if (!operation || typeof operation !== "object") return;
  return (operation as ListOperation).key === stateKey
    ? (operation as ListOperation)
    : undefined;
}
