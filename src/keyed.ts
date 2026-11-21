import { Owner } from "./owner.js";
import { createMutableLiveItem } from "./live.js";
import {
  hasListOperationPayload,
  readListOperation,
  readListOperationPayload,
  type ListOperation,
} from "./list.js";
import type { Scheduler } from "./scheduler.js";
import type { KeyedVNode, LiveItem, Renderable } from "./types.js";

interface KeyedBlock {
  readonly key: PropertyKey;
  nodes: Node[];
  owner: Owner;
  item: unknown;
  live: LiveItem<unknown, unknown>;
  setItem(item: unknown, context?: unknown): void;
}

interface MountKeyedOptions<C> {
  target: Node;
  owner: Owner;
  vnode: KeyedVNode;
  scheduler: Scheduler<C>;
  renderInto(view: Renderable, target: Node, owner: Owner): void;
}

function removeNodes(nodes: readonly Node[]) {
  for (const node of nodes) node.parentNode?.removeChild(node);
}

function removeBlock(block: KeyedBlock) {
  block.owner.dispose();
  removeNodes(block.nodes);
}

function moveBlockBefore(block: KeyedBlock, reference: Node) {
  if (block.nodes.at(-1)?.nextSibling === reference) return;
  const document = reference.ownerDocument ?? (reference as Document);
  const fragment = document.createDocumentFragment();
  for (const node of block.nodes) fragment.appendChild(node);
  reference.parentNode?.insertBefore(fragment, reference);
}

function longestIncreasingPositions(values: readonly number[]) {
  const tails: number[] = [];
  const previous = new Array<number>(values.length).fill(-1);

  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === undefined || value < 0) continue;

    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      const tailIndex = tails[middle];
      const tailValue = tailIndex === undefined ? -1 : values[tailIndex] ?? -1;
      if (tailValue < value) low = middle + 1;
      else high = middle;
    }

    if (low > 0) previous[index] = tails[low - 1] ?? -1;
    tails[low] = index;
  }

  const positions = new Set<number>();
  let cursor = tails.at(-1) ?? -1;
  while (cursor >= 0) {
    positions.add(cursor);
    cursor = previous[cursor] ?? -1;
  }
  return positions;
}

function renderNodes(
  document: Document,
  view: Renderable,
  owner: Owner,
  renderInto: MountKeyedOptions<unknown>["renderInto"]
) {
  const fragment = document.createDocumentFragment();
  renderInto(view, fragment, owner);
  if (fragment.childNodes.length === 0) fragment.appendChild(document.createTextNode(""));
  return {
    fragment,
    nodes: Array.from(fragment.childNodes),
  };
}

export function mountKeyedRegion<C>({
  target,
  owner,
  vnode,
  scheduler,
  renderInto,
}: MountKeyedOptions<C>) {
  const document = target.ownerDocument ?? (target as Document);
  const end = document.createTextNode("");
  target.appendChild(end);

  const token = {};
  const blocks = new Map<PropertyKey, KeyedBlock>();
  let currentBlocks: KeyedBlock[] = [];
  let active = true;
  let nextItems = vnode.source.get();
  let nextOperation: ListOperation | undefined;

  const createBlock = (key: PropertyKey, item: unknown): KeyedBlock => {
    const mutable = createMutableLiveItem<unknown, unknown>(item);
    const block: KeyedBlock = {
      key,
      item,
      owner: new Owner(owner),
      nodes: [],
      live: mutable.live,
      setItem: mutable.set,
    };
    const rendered = renderNodes(
      document,
      vnode.project(block.live),
      block.owner,
      renderInto
    );
    block.nodes = rendered.nodes;
    end.parentNode?.insertBefore(rendered.fragment, end);
    return block;
  };

  const reconcile = (context?: unknown) => {
    const nextBlocks: KeyedBlock[] = [];
    const nextKeys = new Set<PropertyKey>();
    const keyedItems = nextItems.map((item) => ({ item, key: vnode.key(item) }));
    const oldPositions = new Map(
      currentBlocks.map((block, index) => [block.key, index] as const)
    );

    for (const { key } of keyedItems) {
      if (nextKeys.has(key)) {
        throw new Error(`[nexus-dom] Duplicate key "${String(key)}" in .each().`);
      }
      nextKeys.add(key);
    }

    keyedItems.forEach(({ item, key }) => {
      let block = blocks.get(key);
      if (!block) {
        block = createBlock(key, item);
        blocks.set(key, block);
      } else if (!Object.is(block.item, item)) {
        block.item = item;
        block.setItem(item, context);
      }
      nextBlocks.push(block);
    });

    for (const [key, block] of blocks) {
      if (nextKeys.has(key)) continue;
      removeBlock(block);
      blocks.delete(key);
    }

    const positions = nextBlocks.map(
      (block) => oldPositions.get(block.key) ?? -1
    );
    const stablePositions = longestIncreasingPositions(positions);

    for (let index = nextBlocks.length - 1; index >= 0; index--) {
      const block = nextBlocks[index];
      if (!block) continue;
      const reference = nextBlocks[index + 1]?.nodes[0] ?? end;
      if (positions[index] === -1 || !stablePositions.has(index)) {
        moveBlockBefore(block, reference);
      }
    }
    currentBlocks = nextBlocks;
  };

  const applyOperation = (
    operation: ListOperation,
    context?: unknown,
    validateFinalState = true
  ): boolean => {
    if (operation.type === "batch") {
      for (const nested of operation.operations) {
        if (!applyOperation(nested, context, false)) return false;
      }
      return currentBlocks.length === nextItems.length;
    }

    if (operation.type === "insert") {
      if (
        !Number.isInteger(operation.index) ||
        !Number.isInteger(operation.count) ||
        operation.index < 0 ||
        operation.index > currentBlocks.length ||
        operation.count < 1
      ) {
        return false;
      }
      if (
        validateFinalState &&
        nextItems.length !== currentBlocks.length + operation.count
      ) {
        return false;
      }
      const payload = readListOperationPayload(operation);
      if (!Array.isArray(payload) || payload.length !== operation.count) return false;
      const items = payload as unknown[];

      const keyedItems = items.map((item) => ({ item, key: vnode.key(item) }));
      const insertedKeys = new Set<PropertyKey>();
      for (const { key } of keyedItems) {
        if (blocks.has(key) || insertedKeys.has(key)) return false;
        insertedKeys.add(key);
      }

      const inserted: KeyedBlock[] = [];
      for (const { item, key } of keyedItems) {
        const block = createBlock(key, item);
        blocks.set(key, block);
        inserted.push(block);
      }
      currentBlocks.splice(operation.index, 0, ...inserted);
      let reference = currentBlocks[operation.index + inserted.length]?.nodes[0] ?? end;
      for (let index = inserted.length - 1; index >= 0; index--) {
        const block = inserted[index];
        if (!block) continue;
        moveBlockBefore(block, reference);
        reference = block.nodes[0] ?? reference;
      }
      return true;
    }

    if (operation.type === "remove") {
      if (
        !Number.isInteger(operation.index) ||
        !Number.isInteger(operation.count) ||
        operation.index < 0 ||
        operation.count < 1 ||
        operation.index + operation.count > currentBlocks.length
      ) {
        return false;
      }
      if (
        validateFinalState &&
        nextItems.length !== currentBlocks.length - operation.count
      ) {
        return false;
      }
      const removed = currentBlocks.splice(operation.index, operation.count);
      if (removed.length !== operation.count) return false;
      for (const block of removed) {
        blocks.delete(block.key);
        removeBlock(block);
      }
      return true;
    }

    if (operation.type === "move") {
      if (
        !Number.isInteger(operation.from) ||
        !Number.isInteger(operation.to) ||
        operation.from < 0 ||
        operation.from >= currentBlocks.length ||
        operation.to < 0 ||
        operation.to >= currentBlocks.length
      ) {
        return false;
      }
      if (validateFinalState && nextItems.length !== currentBlocks.length) return false;
      const block = currentBlocks[operation.from];
      if (!block) return false;
      if (validateFinalState) {
        const targetItem = nextItems[operation.to];
        if (targetItem === undefined || vnode.key(targetItem) !== block.key) {
          return false;
        }
      }
      currentBlocks.splice(operation.from, 1);
      currentBlocks.splice(operation.to, 0, block);
      const reference = currentBlocks[operation.to + 1]?.nodes[0] ?? end;
      moveBlockBefore(block, reference);
      return true;
    }

    if (operation.type === "replace") {
      if (
        !Number.isInteger(operation.index) ||
        operation.index < 0 ||
        operation.index >= currentBlocks.length
      ) {
        return false;
      }
      if (validateFinalState && nextItems.length !== currentBlocks.length) return false;
      const previous = currentBlocks[operation.index];
      const item = readListOperationPayload(operation);
      if (!previous || !hasListOperationPayload(operation)) return false;
      const key = vnode.key(item);
      if (key === previous.key) {
        previous.item = item;
        previous.setItem(item, context);
        return true;
      }
      if (blocks.has(key)) return false;

      blocks.delete(previous.key);
      removeBlock(previous);
      const replacement = createBlock(key, item);
      blocks.set(key, replacement);
      currentBlocks[operation.index] = replacement;
      const reference = currentBlocks[operation.index + 1]?.nodes[0] ?? end;
      moveBlockBefore(replacement, reference);
      return true;
    }

    return false;
  };

  reconcile();

  const unsubscribe = vnode.source.subscribe((items, context) => {
    nextItems = items;
    nextOperation = readListOperation(context, vnode.stateKey);
    scheduler.enqueue(
      token,
      () => {
        if (!active) return;
        const operation = nextOperation;
        nextOperation = undefined;
        if (!operation || !applyOperation(operation, context)) reconcile(context);
      },
      context as C | undefined
    );
  });

  owner.addCleanup(() => {
    active = false;
    scheduler.cancel(token);
    unsubscribe();
    for (const block of blocks.values()) removeBlock(block);
    blocks.clear();
  });
}
