import { Owner } from "./owner.js";
import type { Scheduler } from "./scheduler.js";
import { sameDependencies, trackSelector } from "./tracking.js";
import type { Renderable, TrackedViewVNode } from "./types.js";

interface MountTrackedViewOptions<C> {
  target: Node;
  owner: Owner;
  vnode: TrackedViewVNode;
  scheduler: Scheduler<C>;
  renderInto(view: Renderable, target: Node, owner: Owner): void;
  reconcile(
    previous: Renderable,
    next: Renderable,
    nodes: readonly Node[],
    owner: Owner
  ): boolean;
  hydration?: {
    node: Node | null;
    hydrateInto(
      view: Renderable,
      target: Node,
      owner: Owner,
      node: Node | null
    ): Node | null;
  };
}

export function mountTrackedView<C>({
  target,
  owner,
  vnode,
  scheduler,
  renderInto,
  reconcile,
  hydration,
}: MountTrackedViewOptions<C>) {
  const document = target.ownerDocument ?? (target as Document);
  const end = document.createTextNode("");
  if (!hydration) target.appendChild(end);

  const token = {};
  let active = true;
  let branchOwner: Owner | undefined;
  let branchNodes: Node[] = [];
  let branchView: Renderable = undefined;
  let dependencies: ["*"] | string[] | undefined;
  let unsubscribe = () => {};
  const branchId = owner.reserveIdSegment("t");

  const clearBranch = () => {
    branchOwner?.dispose();
    branchOwner = undefined;
    for (const node of branchNodes) node.parentNode?.removeChild(node);
    branchNodes = [];
  };

  function handle(_state: Record<string, unknown>, context?: unknown) {
    scheduler.enqueue(
      token,
      mountBranch,
      context as C | undefined,
      (error) => owner.handleError(error)
    );
  }

  const updateSubscription = (next: ["*"] | string[]) => {
    if (dependencies && sameDependencies(dependencies, next)) return;
    const previousUnsubscribe = unsubscribe;
    dependencies = next;
    unsubscribe = vnode.source.subscribe(handle, next);
    previousUnsubscribe();
  };

  function mountBranch() {
    if (!active) return;
    const tracked = trackSelector(vnode.source.get(), vnode.project);

    if (
      branchOwner &&
      reconcile(branchView, tracked.value, branchNodes, branchOwner)
    ) {
      branchView = tracked.value;
      updateSubscription(tracked.dependencies);
      return;
    }

    const nextOwner = new Owner(owner, true, branchId);
    const fragment = document.createDocumentFragment();
    try {
      renderInto(tracked.value, fragment, nextOwner);
      updateSubscription(tracked.dependencies);
    } catch (error) {
      nextOwner.dispose();
      throw error;
    }

    const nextNodes = Array.from(fragment.childNodes);
    clearBranch();
    branchOwner = nextOwner;
    branchNodes = nextNodes;
    branchView = tracked.value;
    end.parentNode?.insertBefore(fragment, end);
    if (owner.isMounted()) nextOwner.mount();
  }

  let hydrationNext: Node | null | undefined;
  if (hydration) {
    const tracked = trackSelector(vnode.source.get(), vnode.project);
    const nextOwner = new Owner(owner, true, branchId);
    const previous = hydration.node
      ? hydration.node.previousSibling
      : target.lastChild;
    try {
      hydrationNext = hydration.hydrateInto(
        tracked.value,
        target,
        nextOwner,
        hydration.node
      );
      updateSubscription(tracked.dependencies);
    } catch (error) {
      nextOwner.dispose();
      throw error;
    }
    target.insertBefore(end, hydrationNext);
    const nextNodes: Node[] = [];
    let current = previous ? previous.nextSibling : target.firstChild;
    while (current && current !== end) {
      nextNodes.push(current);
      current = current.nextSibling;
    }
    branchOwner = nextOwner;
    branchNodes = nextNodes;
    branchView = tracked.value;
  } else mountBranch();

  owner.addCleanup(() => {
    active = false;
    scheduler.cancel(token);
    unsubscribe();
    clearBranch();
    end.parentNode?.removeChild(end);
  });
  if (vnode.mountStores) branchOwner?.addMount(vnode.mountStores);

  return hydrationNext;
}
