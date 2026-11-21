import { isLiveValue } from "./live.js";
import { mountKeyedRegion } from "./keyed.js";
import {
  eventName,
  formatText,
  isEventProperty,
  writeProperty,
} from "./dom.js";
import { Owner, withOwner } from "./owner.js";
import { createScheduler } from "./scheduler.js";
import type {
  DOMRenderer,
  LiveValue,
  MountedRoot,
  Renderable,
  RendererOptions,
  VNode,
} from "./types.js";

export function createDOMRenderer<C = unknown>(
  options: RendererOptions<C> = {}
): DOMRenderer<C> {
  const scheduler = createScheduler(options);

  const attachLive = (
    live: LiveValue<unknown, unknown>,
    owner: Owner,
    write: (value: unknown, previous: unknown) => void
  ) => {
    const token = {};
    let active = true;
    let current = live.get();
    let next = current;
    write(current, undefined);

    const unsubscribe = live.subscribe((value, context) => {
      next = value;
      scheduler.enqueue(
        token,
        () => {
          if (!active) return;
          const previous = current;
          current = next;
          write(current, previous);
        },
        context as C | undefined
      );
    });

    owner.addCleanup(() => {
      active = false;
      scheduler.cancel(token);
      unsubscribe();
    });
  };

  const attachEvent = (
    element: Element,
    property: string,
    value: unknown,
    owner: Owner
  ) => {
    if (isLiveValue(value)) {
      let handler = value.get();
      const listener: EventListener = (event) => {
        if (typeof handler === "function") handler(event);
      };
      const unsubscribe = value.subscribe((next) => {
        handler = next;
      });
      element.addEventListener(eventName(property), listener);
      owner.addCleanup(() => {
        unsubscribe();
        element.removeEventListener(eventName(property), listener);
      });
      return;
    }

    if (typeof value !== "function") return;
    const listener = value as EventListener;
    element.addEventListener(eventName(property), listener);
    owner.addCleanup(() =>
      element.removeEventListener(eventName(property), listener)
    );
  };

  const renderRegion = (
    target: Node,
    owner: Owner,
    source: LiveValue<unknown, unknown>,
    project: (value: unknown) => Renderable,
    structuralKey?: (value: unknown) => unknown
  ) => {
    const document = target.ownerDocument ?? (target as Document);
    const end = document.createTextNode("");
    target.appendChild(end);

    let active = true;
    let nextValue = source.get();
    let currentKey = structuralKey?.(nextValue);
    let branchOwner: Owner | undefined;
    let branchNodes: Node[] = [];
    const token = {};

    const clearBranch = () => {
      branchOwner?.dispose();
      branchOwner = undefined;
      for (const node of branchNodes) node.parentNode?.removeChild(node);
      branchNodes = [];
    };

    const mountBranch = () => {
      branchOwner = new Owner(owner);
      const fragment = document.createDocumentFragment();
      renderInto(project(nextValue), fragment, branchOwner);
      branchNodes = Array.from(fragment.childNodes);
      end.parentNode?.insertBefore(fragment, end);
    };

    mountBranch();

    const unsubscribe = source.subscribe((value, context) => {
      nextValue = value;
      if (structuralKey) {
        const nextKey = structuralKey(value);
        if (Object.is(currentKey, nextKey)) return;
        currentKey = nextKey;
      }
      scheduler.enqueue(
        token,
        () => {
          if (!active) return;
          clearBranch();
          mountBranch();
        },
        context as C | undefined
      );
    });

    owner.addCleanup(() => {
      active = false;
      scheduler.cancel(token);
      unsubscribe();
      clearBranch();
    });
  };

  const renderVNode = (vnode: VNode, target: Node, owner: Owner) => {
    if (vnode.kind === "keyed") {
      mountKeyedRegion({ target, owner, vnode, scheduler, renderInto });
      return;
    }

    if (vnode.kind === "dynamic") {
      renderRegion(target, owner, vnode.source, vnode.project, vnode.key);
      return;
    }

    if (vnode.kind === "show") {
      const condition = vnode.when.map(Boolean);
      renderRegion(
        target,
        owner,
        condition,
        (visible) => (visible ? vnode.children : vnode.fallback)
      );
      return;
    }

    if (vnode.kind === "fragment") {
      renderInto(vnode.props.children as Renderable, target, owner);
      return;
    }

    if (vnode.kind === "component") {
      const componentOwner = new Owner(owner);
      const output = withOwner(componentOwner, () => vnode.type(vnode.props));
      renderInto(output, target, componentOwner);
      return;
    }

    const document = target.ownerDocument ?? (target as Document);
    const element = document.createElement(vnode.type);

    for (const [property, value] of Object.entries(vnode.props)) {
      if (property === "children" || property === "key") continue;

      if (property === "ref" && typeof value === "function") {
        value(element);
        owner.addCleanup(() => value(null));
        continue;
      }

      if (isEventProperty(property)) {
        attachEvent(element, property, value, owner);
        continue;
      }

      if (isLiveValue(value)) {
        attachLive(value, owner, (next, previous) =>
          writeProperty(element, property, next, previous)
        );
      } else {
        writeProperty(element, property, value, undefined);
      }
    }

    renderInto(vnode.props.children as Renderable, element, owner);
    target.appendChild(element);
  };

  const renderInto = (view: Renderable, target: Node, owner: Owner): void => {
    if (
      view === null ||
      view === undefined ||
      view === false ||
      view === true
    ) {
      return;
    }

    if (Array.isArray(view)) {
      for (const child of view) renderInto(child, target, owner);
      return;
    }

    const document = target.ownerDocument ?? (target as Document);

    if (isLiveValue(view)) {
      const text = document.createTextNode("");
      attachLive(view, owner, (value) => {
        text.data = formatText(value);
      });
      target.appendChild(text);
      return;
    }

    if (typeof view === "object") {
      renderVNode(view as VNode, target, owner);
      return;
    }

    target.appendChild(document.createTextNode(formatText(view)));
  };

  return {
    mount(view, container): MountedRoot {
      const owner = new Owner();
      const document = container.ownerDocument ?? (container as Document);
      const fragment = document.createDocumentFragment();
      renderInto(view, fragment, owner);
      const nodes = Array.from(fragment.childNodes);
      container.appendChild(fragment);

      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          owner.dispose();
          for (const node of nodes) node.parentNode?.removeChild(node);
        },
      };
    },
    flush: scheduler.flush,
  };
}
