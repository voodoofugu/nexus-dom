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
  ErrorBoundaryFallback,
  LiveValue,
  MountedRoot,
  Renderable,
  RendererOptions,
  VNode,
} from "./types.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function createElement(document: Document, target: Node, type: string) {
  const parent = target instanceof Element ? target : undefined;
  const isSVG =
    type === "svg" ||
    (parent?.namespaceURI === SVG_NAMESPACE && parent.localName !== "foreignObject");
  return isSVG
    ? document.createElementNS(SVG_NAMESPACE, type)
    : document.createElement(type);
}

export function createDOMRenderer<C = unknown>(
  options: RendererOptions<C> = {}
): DOMRenderer<C> {
  const scheduler = createScheduler(options);

  const attachLive = (
    live: LiveValue<unknown, unknown>,
    owner: Owner,
    write: (value: unknown, previous: unknown) => void
  ) => {
    let active = true;
    let current = live.get();
    let next = current;
    write(current, undefined);

    const listener = (value: unknown, context?: unknown) => {
      next = value;
      scheduler.enqueue(
        listener,
        () => {
          if (!active) return;
          const previous = current;
          current = next;
          write(current, previous);
        },
        context as C | undefined,
        (error) => owner.handleError(error)
      );
    };
    const unsubscribe = live.subscribe(listener);

    owner.addCleanup(() => {
      active = false;
      scheduler.cancel(listener);
      unsubscribe();
    });
  };

  const renderBoundary = (
    target: Node,
    owner: Owner,
    children: Renderable,
    fallback: ErrorBoundaryFallback
  ) => {
    const document = target.ownerDocument ?? (target as Document);
    const boundaryOwner = new Owner(owner);
    const end = document.createTextNode("");
    target.appendChild(end);
    let active = true;
    let mounted = false;
    let branchOwner: Owner | undefined;
    let branchNodes: Node[] = [];

    const replaceBranch = (view: Renderable, catchesErrors: boolean) => {
      const nextOwner = new Owner(boundaryOwner);
      const fragment = document.createDocumentFragment();
      if (catchesErrors) nextOwner.setErrorHandler(showFallback);
      try {
        renderInto(view, fragment, nextOwner);
      } catch (error) {
        nextOwner.dispose();
        throw error;
      }

      const nextNodes = Array.from(fragment.childNodes);
      branchOwner?.dispose();
      for (const node of branchNodes) node.parentNode?.removeChild(node);
      branchOwner = nextOwner;
      branchNodes = nextNodes;
      end.parentNode?.insertBefore(fragment, end);
    };

    const reset = () => {
      if (!active) return;
      try {
        replaceBranch(children, true);
      } catch (error) {
        try {
          showFallback(error);
        } catch (fallbackError) {
          if (mounted && boundaryOwner.parent?.handleError(fallbackError)) return;
          throw fallbackError;
        }
      }
    };

    function showFallback(error: unknown) {
      if (!active) return;
      const view =
        typeof fallback === "function" ? fallback(error, reset) : fallback;
      replaceBranch(view, false);
    }

    reset();
    mounted = true;

    boundaryOwner.addCleanup(() => {
      active = false;
      branchOwner?.dispose();
      branchOwner = undefined;
      for (const node of branchNodes) node.parentNode?.removeChild(node);
      branchNodes = [];
      end.parentNode?.removeChild(end);
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
      const nextOwner = new Owner(owner);
      const fragment = document.createDocumentFragment();
      try {
        renderInto(project(nextValue), fragment, nextOwner);
      } catch (error) {
        nextOwner.dispose();
        throw error;
      }
      const nextNodes = Array.from(fragment.childNodes);
      clearBranch();
      branchOwner = nextOwner;
      branchNodes = nextNodes;
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
          mountBranch();
        },
        context as C | undefined,
        (error) => owner.handleError(error)
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
    if (vnode.kind === "error-boundary") {
      renderBoundary(target, owner, vnode.children, vnode.fallback);
      return;
    }
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
    const element = createElement(document, target, vnode.type);

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
      try {
        renderInto(view, fragment, owner);
      } catch (error) {
        owner.dispose();
        throw error;
      }
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
