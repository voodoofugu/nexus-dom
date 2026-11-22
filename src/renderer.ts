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
import { mountTrackedView } from "./view.js";
import { nexusDOMError } from "./errors.js";
import type {
  DOMRenderer,
  ElementVNode,
  ErrorBoundaryFallback,
  LiveValue,
  MountedRoot,
  Renderable,
  RendererOptions,
  StoreViewResolver,
  VNode,
} from "./types.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

type RefTarget =
  | ((element: Element | null) => void)
  | { current: unknown };

interface EventRecord {
  listener: EventListener | undefined;
}

interface RefRecord {
  value: RefTarget | undefined;
  attached: boolean;
}

type PatchValue = string | number | bigint | ElementVNode | LiveValue<unknown, unknown>;

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
  options: RendererOptions<C> = {},
  storeViews?: StoreViewResolver
): DOMRenderer<C> {
  const scheduler = createScheduler(options);
  const eventRecords = new WeakMap<Element, Map<string, EventRecord>>();
  const refRecords = new WeakMap<Element, RefRecord>();

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
      if (boundaryOwner.isMounted()) nextOwner.mount();
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

    const records = eventRecords.get(element) ?? new Map<string, EventRecord>();
    eventRecords.set(element, records);
    const record: EventRecord = {
      listener: typeof value === "function" ? (value as EventListener) : undefined,
    };
    records.set(property, record);
    if (record.listener) {
      element.addEventListener(eventName(property), record.listener);
    }
    owner.addCleanup(() => {
      if (record.listener) {
        element.removeEventListener(eventName(property), record.listener);
      }
      if (records.get(property) === record) records.delete(property);
    });
  };

  const writeRef = (ref: RefTarget | undefined, value: Element | null) => {
    if (typeof ref === "function") ref(value);
    else if (ref && typeof ref === "object") ref.current = value;
  };

  const isRefTarget = (value: unknown): value is RefTarget =>
    typeof value === "function" ||
    (typeof value === "object" && value !== null && "current" in value);

  const attachRef = (element: Element, value: unknown, owner: Owner) => {
    if (!isRefTarget(value)) return;
    const record: RefRecord = { value, attached: false };
    refRecords.set(element, record);
    owner.addMount(() => {
      record.attached = true;
      writeRef(record.value, element);
    });
    owner.addCleanup(() => {
      if (record.attached) writeRef(record.value, null);
      if (refRecords.get(element) === record) refRecords.delete(element);
    });
  };

  const flattenPatchValues = (
    view: Renderable,
    values: PatchValue[]
  ): boolean => {
    if (view === null || view === undefined || view === false || view === true) {
      return true;
    }
    if (Array.isArray(view)) {
      return view.every((child) => flattenPatchValues(child, values));
    }
    if (isLiveValue(view)) {
      values.push(view);
      return true;
    }
    if (typeof view !== "object") {
      values.push(view);
      return true;
    }
    const vnode = view as VNode;
    if (vnode.kind === "fragment") {
      return flattenPatchValues(vnode.props.children as Renderable, values);
    }
    if (vnode.kind !== "element") return false;
    values.push(vnode);
    return true;
  };

  const canPatchProperties = (
    previous: Record<string, unknown>,
    next: Record<string, unknown>
  ) => {
    const properties = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const property of properties) {
      if (property === "children" || property === "key") continue;
      const previousValue = previous[property];
      const nextValue = next[property];
      if (
        (isLiveValue(previousValue) || isLiveValue(nextValue)) &&
        previousValue !== nextValue
      ) {
        return false;
      }
    }
    return true;
  };

  const canPatchValue = (previous: PatchValue, next: PatchValue): boolean => {
    if (isLiveValue(previous) || isLiveValue(next)) return previous === next;
    if (typeof previous !== "object" || typeof next !== "object") {
      return typeof previous !== "object" && typeof next !== "object";
    }
    if (
      previous.type !== next.type ||
      previous.key !== next.key ||
      !canPatchProperties(previous.props, next.props)
    ) {
      return false;
    }
    const previousChildren: PatchValue[] = [];
    const nextChildren: PatchValue[] = [];
    return (
      flattenPatchValues(previous.props.children as Renderable, previousChildren) &&
      flattenPatchValues(next.props.children as Renderable, nextChildren) &&
      previousChildren.length === nextChildren.length &&
      previousChildren.every((child, index) =>
        canPatchValue(child, nextChildren[index]!)
      )
    );
  };

  const patchPlainEvent = (
    element: Element,
    property: string,
    value: unknown,
    owner: Owner
  ) => {
    let records = eventRecords.get(element);
    let record = records?.get(property);
    if (!record) {
      attachEvent(element, property, value, owner);
      return;
    }
    if (record.listener) {
      element.removeEventListener(eventName(property), record.listener);
    }
    record.listener =
      typeof value === "function" ? (value as EventListener) : undefined;
    if (record.listener) {
      element.addEventListener(eventName(property), record.listener);
    }
  };

  const patchRef = (element: Element, value: unknown, owner: Owner) => {
    const next = isRefTarget(value) ? value : undefined;
    const record = refRecords.get(element);
    if (!record) {
      if (next) attachRef(element, next, owner);
      return;
    }
    if (record.value === next) return;
    if (record.attached) writeRef(record.value, null);
    record.value = next;
    if (record.attached) writeRef(record.value, element);
  };

  const patchValue = (
    previous: PatchValue,
    next: PatchValue,
    node: Node,
    owner: Owner
  ) => {
    if (isLiveValue(previous) || isLiveValue(next)) return;
    if (typeof previous !== "object" || typeof next !== "object") {
      if (node.nodeType === Node.TEXT_NODE) node.nodeValue = formatText(next);
      return;
    }
    if (!(node instanceof Element)) return;
    const properties = new Set([
      ...Object.keys(previous.props),
      ...Object.keys(next.props),
    ]);
    for (const property of properties) {
      if (property === "children" || property === "key") continue;
      const previousValue = previous.props[property];
      const nextValue = next.props[property];
      if (previousValue === nextValue) continue;
      if (property === "ref") {
        patchRef(node, nextValue, owner);
      } else if (isEventProperty(property)) {
        patchPlainEvent(node, property, nextValue, owner);
      } else if (!isLiveValue(nextValue)) {
        writeProperty(node, property, nextValue, previousValue);
      }
    }
    const previousChildren: PatchValue[] = [];
    const nextChildren: PatchValue[] = [];
    flattenPatchValues(previous.props.children as Renderable, previousChildren);
    flattenPatchValues(next.props.children as Renderable, nextChildren);
    previousChildren.forEach((child, index) => {
      patchValue(child, nextChildren[index]!, node.childNodes[index]!, owner);
    });
  };

  const reconcileView = (
    previous: Renderable,
    next: Renderable,
    nodes: readonly Node[],
    owner: Owner
  ) => {
    const previousValues: PatchValue[] = [];
    const nextValues: PatchValue[] = [];
    if (
      !flattenPatchValues(previous, previousValues) ||
      !flattenPatchValues(next, nextValues) ||
      previousValues.length !== nextValues.length ||
      previousValues.length !== nodes.length ||
      !previousValues.every((value, index) =>
        canPatchValue(value, nextValues[index]!)
      )
    ) {
      return false;
    }
    previousValues.forEach((value, index) => {
      patchValue(value, nextValues[index]!, nodes[index]!, owner);
    });
    return true;
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
      if (owner.isMounted()) nextOwner.mount();
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
    if (vnode.kind === "store-view") {
      if (!storeViews) {
        throw nexusDOMError(
          "STORE_VIEW_OUTSIDE_APP",
          "A view with store dependencies must be rendered through createApp().render()."
        );
      }
      renderVNode(storeViews.resolve(vnode), target, owner);
      return;
    }

    if (vnode.kind === "error-boundary") {
      renderBoundary(target, owner, vnode.children, vnode.fallback);
      return;
    }
    if (vnode.kind === "keyed") {
      mountKeyedRegion({ target, owner, vnode, scheduler, renderInto });
      return;
    }

    if (vnode.kind === "tracked-view") {
      mountTrackedView({
        target,
        owner,
        vnode,
        scheduler,
        renderInto,
        reconcile: reconcileView,
      });
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

      if (property === "ref") {
        attachRef(element, value, owner);
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
      owner.mount();

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
