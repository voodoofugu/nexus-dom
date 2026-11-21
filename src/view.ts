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
}

export function mountTrackedView<C>({
  target,
  owner,
  vnode,
  scheduler,
  renderInto,
}: MountTrackedViewOptions<C>) {
  const document = target.ownerDocument ?? (target as Document);
  const end = document.createTextNode("");
  target.appendChild(end);

  const token = {};
  let active = true;
  let branchOwner: Owner | undefined;
  let branchNodes: Node[] = [];
  let dependencies: ["*"] | string[] | undefined;
  let unsubscribe = () => {};

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
    const nextOwner = new Owner(owner);
    const fragment = document.createDocumentFragment();
    try {
      const tracked = trackSelector(vnode.source.get(), vnode.project);
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
    end.parentNode?.insertBefore(fragment, end);
    if (owner.isMounted()) nextOwner.mount();
  }

  mountBranch();

  owner.addCleanup(() => {
    active = false;
    scheduler.cancel(token);
    unsubscribe();
    clearBranch();
    end.parentNode?.removeChild(end);
  });
}
