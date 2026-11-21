import { Owner } from "./owner.js";
import type { Scheduler } from "./scheduler.js";
import type { KeyedVNode, Renderable } from "./types.js";

interface KeyedBlock {
  readonly key: PropertyKey;
  readonly start: Comment;
  readonly end: Comment;
  owner: Owner;
  item: unknown;
}

interface MountKeyedOptions<C> {
  target: Node;
  owner: Owner;
  vnode: KeyedVNode;
  scheduler: Scheduler<C>;
  renderInto(view: Renderable, target: Node, owner: Owner): void;
}

function removeBetween(start: Node, end: Node) {
  let node = start.nextSibling;
  while (node && node !== end) {
    const next = node.nextSibling;
    node.parentNode?.removeChild(node);
    node = next;
  }
}

function removeBlock(block: KeyedBlock) {
  block.owner.dispose();
  let node: Node | null = block.start;
  while (node) {
    const next: Node | null = node.nextSibling;
    node.parentNode?.removeChild(node);
    if (node === block.end) break;
    node = next;
  }
}

function moveBlockBefore(block: KeyedBlock, reference: Node) {
  if (block.end.nextSibling === reference) return;
  const document = reference.ownerDocument ?? (reference as Document);
  const fragment = document.createDocumentFragment();
  let node: Node | null = block.start;

  while (node) {
    const next: Node | null = node.nextSibling;
    fragment.appendChild(node);
    if (node === block.end) break;
    node = next;
  }

  reference.parentNode?.insertBefore(fragment, reference);
}

export function mountKeyedRegion<C>({
  target,
  owner,
  vnode,
  scheduler,
  renderInto,
}: MountKeyedOptions<C>) {
  const document = target.ownerDocument ?? (target as Document);
  const start = document.createComment("nexus-each");
  const end = document.createComment("/nexus-each");
  target.appendChild(start);
  target.appendChild(end);

  const token = {};
  const blocks = new Map<PropertyKey, KeyedBlock>();
  let active = true;
  let nextItems = vnode.source.get();

  const renderBlock = (block: KeyedBlock) => {
    block.owner.dispose();
    removeBetween(block.start, block.end);
    block.owner = new Owner(owner);
    const fragment = document.createDocumentFragment();
    renderInto(vnode.project(block.item), fragment, block.owner);
    block.end.parentNode?.insertBefore(fragment, block.end);
  };

  const createBlock = (
    key: PropertyKey,
    item: unknown
  ): KeyedBlock => {
    const block: KeyedBlock = {
      key,
      item,
      owner: new Owner(owner),
      start: document.createComment(`nexus-item:${String(key)}`),
      end: document.createComment(`/nexus-item:${String(key)}`),
    };
    const fragment = document.createDocumentFragment();
    fragment.appendChild(block.start);
    renderInto(vnode.project(item), fragment, block.owner);
    fragment.appendChild(block.end);
    end.parentNode?.insertBefore(fragment, end);
    return block;
  };

  const reconcile = () => {
    const nextBlocks: KeyedBlock[] = [];
    const nextKeys = new Set<PropertyKey>();
    const keyedItems = nextItems.map((item) => ({ item, key: vnode.key(item) }));

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
        renderBlock(block);
      }
      nextBlocks.push(block);
    });

    for (const [key, block] of blocks) {
      if (nextKeys.has(key)) continue;
      removeBlock(block);
      blocks.delete(key);
    }

    let reference: Node = end;
    for (let index = nextBlocks.length - 1; index >= 0; index--) {
      const block = nextBlocks[index];
      if (!block) continue;
      moveBlockBefore(block, reference);
      reference = block.start;
    }
  };

  reconcile();

  const unsubscribe = vnode.source.subscribe((items, context) => {
    nextItems = items;
    scheduler.enqueue(
      token,
      () => {
        if (active) reconcile();
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
