import { Owner } from "./owner.js";
import type { Scheduler } from "./scheduler.js";
import type { KeyedVNode, Renderable } from "./types.js";

interface KeyedBlock {
  readonly key: PropertyKey;
  nodes: Node[];
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
  let active = true;
  let nextItems = vnode.source.get();

  const renderBlock = (block: KeyedBlock) => {
    const reference = block.nodes.at(-1)?.nextSibling ?? end;
    block.owner.dispose();
    removeNodes(block.nodes);
    block.owner = new Owner(owner);
    const rendered = renderNodes(
      document,
      vnode.project(block.item),
      block.owner,
      renderInto
    );
    block.nodes = rendered.nodes;
    reference.parentNode?.insertBefore(rendered.fragment, reference);
  };

  const createBlock = (
    key: PropertyKey,
    item: unknown
  ): KeyedBlock => {
    const block: KeyedBlock = {
      key,
      item,
      owner: new Owner(owner),
      nodes: [],
    };
    const rendered = renderNodes(
      document,
      vnode.project(item),
      block.owner,
      renderInto
    );
    block.nodes = rendered.nodes;
    end.parentNode?.insertBefore(rendered.fragment, end);
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
      reference = block.nodes[0] ?? reference;
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
