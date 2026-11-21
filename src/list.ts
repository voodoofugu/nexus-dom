import type { Getter, Setter, UpdateContext } from "nexus-state";
import { nexusDOMError } from "./errors.js";

type RecordAny = Record<string, any>;

export type ArrayKey<S extends RecordAny> = {
  [K in keyof S]: S[K] extends readonly unknown[] ? K : never;
}[keyof S];

export type ArrayItem<T> = T extends readonly (infer Item)[] ? Item : never;

export type ListOperation =
  | { id: number; key: PropertyKey; type: "insert"; index: number; count: number }
  | { id: number; key: PropertyKey; type: "remove"; index: number; count: number }
  | { id: number; key: PropertyKey; type: "move"; from: number; to: number }
  | { id: number; key: PropertyKey; type: "replace"; index: number }
  | { id: number; key: PropertyKey; type: "reorder" }
  | { id: number; key: PropertyKey; type: "set" }
  | {
      id: number;
      key: PropertyKey;
      type: "batch";
      operations: readonly ListOperation[];
    };

type ListOperationWithoutId = ListOperation extends infer Operation
  ? Operation extends { id: number }
    ? Omit<Operation, "id">
    : never
  : never;

export interface ListController<Item> {
  append(...items: Item[]): void;
  insert(index: number, ...items: Item[]): void;
  remove(index: number, count?: number): void;
  move(from: number, to: number): void;
  replace(index: number, item: Item): void;
  reverse(): void;
  set(items: readonly Item[]): void;
  batch(run: (list: ListController<Item>) => void): void;
}

export interface AppHelpers<S extends RecordAny> {
  list<K extends ArrayKey<S>>(key: K): ListController<ArrayItem<S[K]>>;
}

const contextFor = (operation: ListOperation): UpdateContext => ({
  source: `list.${operation.type}`,
  meta: { nexusDOM: { list: operation } },
});

let nextOperationId = 1;
const trustedOperations = new WeakSet<object>();
const operationPayloads = new WeakMap<object, unknown>();
const noPayload = Symbol("nexus-dom.no-list-payload");

function createOperation<T extends ListOperationWithoutId>(
  operation: T,
  payload: unknown = noPayload
): ListOperation {
  const created = { ...operation, id: nextOperationId++ } as ListOperation;
  trustedOperations.add(created);
  if (payload !== noPayload) operationPayloads.set(created, payload);
  return created;
}

function assertIndex(index: number, length: number, allowEnd = false) {
  const maximum = allowEnd ? length : length - 1;
  if (!Number.isInteger(index) || index < 0 || index > maximum) {
    throw nexusDOMError(
      "INVALID_LIST_INDEX",
      `List index ${index} is outside 0..${Math.max(maximum, 0)}.`
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

      let transaction:
        | {
            items: ArrayItem<S[K]>[];
            operations: ListOperation[];
          }
        | undefined;
      const read = () =>
        transaction?.items ?? (get(key) as readonly ArrayItem<S[K]>[]);
      const write = (
        items: readonly ArrayItem<S[K]>[],
        operation: ListOperation
      ) => {
        if (transaction) {
          transaction.items = [...items];
          transaction.operations.push(operation);
          return;
        }
        set({ [key]: items } as Partial<S>, contextFor(operation));
      };

      const controller: ListController<ArrayItem<S[K]>> = {
        append(...items) {
          if (items.length === 0) return;
          const current = read();
          write([...current, ...items], createOperation({
            key,
            type: "insert",
            index: current.length,
            count: items.length,
          }, [...items]));
        },
        insert(index, ...items) {
          if (items.length === 0) return;
          const current = read();
          assertIndex(index, current.length, true);
          write([...current.slice(0, index), ...items, ...current.slice(index)], createOperation({
            key,
            type: "insert",
            index,
            count: items.length,
          }, [...items]));
        },
        remove(index, count = 1) {
          const current = read();
          assertIndex(index, current.length);
          if (
            !Number.isInteger(count) ||
            count < 1 ||
            index + count > current.length
          ) {
            throw nexusDOMError(
              "INVALID_LIST_REMOVE_COUNT",
              `Cannot remove ${count} item(s) from index ${index} in a list of ${current.length}.`
            );
          }
          write([...current.slice(0, index), ...current.slice(index + count)], createOperation({
            key,
            type: "remove",
            index,
            count,
          }));
        },
        move(from, to) {
          const current = [...read()];
          assertIndex(from, current.length);
          assertIndex(to, current.length);
          if (from === to) return;
          const [item] = current.splice(from, 1);
          current.splice(to, 0, item!);
          write(current, createOperation({ key, type: "move", from, to }));
        },
        replace(index, item) {
          const current = [...read()];
          assertIndex(index, current.length);
          current[index] = item;
          write(current, createOperation({ key, type: "replace", index }, item));
        },
        reverse() {
          const current = read();
          if (current.length < 2) return;
          write([...current].reverse(), createOperation({ key, type: "reorder" }));
        },
        set(items) {
          write([...items], createOperation({ key, type: "set" }));
        },
        batch(run) {
          if (transaction) {
            run(controller);
            return;
          }

          transaction = { items: [...read()], operations: [] };
          try {
            run(controller);
            const completed = transaction;
            if (completed.operations.length === 0) return;
            const operation = createOperation({
              key,
              type: "batch",
              operations: completed.operations,
            });
            set(
              { [key]: completed.items } as Partial<S>,
              contextFor(operation)
            );
          } finally {
            transaction = undefined;
          }
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
  return trustedOperations.has(operation) &&
    (operation as ListOperation).key === stateKey
    ? (operation as ListOperation)
    : undefined;
}

export function readListOperationPayload(operation: ListOperation): unknown {
  return operationPayloads.get(operation);
}

export function hasListOperationPayload(operation: ListOperation): boolean {
  return operationPayloads.has(operation);
}
