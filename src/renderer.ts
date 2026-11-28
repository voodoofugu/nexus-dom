import { isLiveValue } from "./live.js";
import { checkedDOMValue } from "./dom-prop-policy.js";
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
import { NexusDOMError, nexusDOMError } from "./errors.js";
import { TEXT_END, TEXT_START } from "./hydration-markers.js";
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
let nextRootId = 0;

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

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***createDOMRenderer***:
 * creates a DOM renderer with one scheduler for its mounted roots.
 * @param options scheduling, diagnostics and component ID prefix.
 * @returns a renderer with `mount()`, `hydrate()` and `flush()`.
 * @example
 * ```tsx
 * const renderer = createDOMRenderer({ schedule: "manual" });
 * const root = renderer.mount(<p>Ready</p>, document.body);
 * renderer.flush();
 * root.dispose();
 * ```
 */
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
    fallback: ErrorBoundaryFallback,
    hydration?: {
      node: Node | null;
      hydrateInto(
        view: Renderable,
        target: Node,
        owner: Owner,
        node: Node | null
      ): Node | null;
    }
  ) => {
    const document = target.ownerDocument ?? (target as Document);
    const boundaryOwner = new Owner(owner);
    const branchId = boundaryOwner.reserveIdSegment("b");
    const end = document.createTextNode("");
    if (!hydration) target.appendChild(end);
    let active = true;
    let mounted = false;
    let branchOwner: Owner | undefined;
    let branchNodes: Node[] = [];
    let hydrationNext: Node | null | undefined;

    const replaceBranch = (view: Renderable, catchesErrors: boolean) => {
      const nextOwner = new Owner(boundaryOwner, true, branchId);
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

    if (hydration) {
      const hydrateBranch = (view: Renderable, catchesErrors: boolean) => {
        const nextOwner = new Owner(boundaryOwner, true, branchId);
        if (catchesErrors) nextOwner.setErrorHandler(showFallback);
        const previous = hydration.node
          ? hydration.node.previousSibling
          : target.lastChild;
        try {
          hydrationNext = hydration.hydrateInto(
            view,
            target,
            nextOwner,
            hydration.node
          );
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
      };

      try {
        hydrateBranch(children, true);
      } catch (error) {
        if (
          error instanceof NexusDOMError &&
          error.code === "HYDRATION_MISMATCH"
        ) throw error;
        const view = typeof fallback === "function"
          ? fallback(error, reset)
          : fallback;
        hydrateBranch(view, false);
      }
    } else reset();
    mounted = true;

    boundaryOwner.addCleanup(() => {
      active = false;
      branchOwner?.dispose();
      branchOwner = undefined;
      for (const node of branchNodes) node.parentNode?.removeChild(node);
      branchNodes = [];
      end.parentNode?.removeChild(end);
    });

    return hydrationNext;
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
    structuralKey?: (value: unknown) => unknown,
    hydration?: {
      node: Node | null;
      hydrateInto(
        view: Renderable,
        target: Node,
        owner: Owner,
        node: Node | null
      ): Node | null;
    }
  ) => {
    const document = target.ownerDocument ?? (target as Document);
    const end = document.createTextNode("");
    if (!hydration) target.appendChild(end);
    const branchId = owner.reserveIdSegment("d");

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
      const nextOwner = new Owner(owner, true, branchId);
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

    let hydrationNext: Node | null | undefined;
    if (hydration) {
      const nextOwner = new Owner(owner, true, branchId);
      const previous = hydration.node
        ? hydration.node.previousSibling
        : target.lastChild;
      try {
        hydrationNext = hydration.hydrateInto(
          project(nextValue),
          target,
          nextOwner,
          hydration.node
        );
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
    } else mountBranch();

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

    return hydrationNext;
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

  const mismatch = (expected: string, node: Node | null): never => {
    const actual = node
      ? node.nodeType === 1
        ? `<${(node as Element).localName}>`
        : node.nodeType === 3
          ? `text ${JSON.stringify(node.nodeValue)}`
          : node.nodeType === 8
            ? `comment ${JSON.stringify(node.nodeValue)}`
            : `node type ${node.nodeType}`
      : "the end of the container";
    throw nexusDOMError(
      "HYDRATION_MISMATCH",
      `Expected ${expected}, but found ${actual}.`
    );
  };

  const hydrateTextNode = (
    value: string,
    target: Node,
    node: Node | null
  ) => {
    const document = target.ownerDocument ?? (target as Document);
    if (value === "") {
      target.insertBefore(document.createTextNode(""), node);
      return node;
    }
    if (!node || node.nodeType !== 3) {
      mismatch(`text ${JSON.stringify(value)}`, node);
    }
    const text = node as Text;
    if (text.data === value) return text.nextSibling;
    if (text.data.startsWith(value)) return text.splitText(value.length);
    return mismatch(`text ${JSON.stringify(value)}`, node);
  };

  const hydrateInto = (
    view: Renderable,
    target: Node,
    owner: Owner,
    node: Node | null
  ): Node | null => {
    if (
      view === null ||
      view === undefined ||
      view === false ||
      view === true
    ) return node;

    if (Array.isArray(view)) {
      let next = node;
      for (const child of view) next = hydrateInto(child, target, owner, next);
      return next;
    }

    if (isLiveValue(view)) {
      if (node?.nodeType !== 8 || node.nodeValue !== TEXT_START) {
        return mismatch(`the <!--${TEXT_START}--> marker`, node);
      }
      const start = node;
      let text = start.nextSibling;
      if (text?.nodeType === 8 && text.nodeValue === TEXT_END) {
        const document = target.ownerDocument ?? (target as Document);
        text = document.createTextNode("");
        target.insertBefore(text, start.nextSibling);
      }
      if (!text || text.nodeType !== 3) {
        return mismatch("reactive text", text);
      }
      const end = text.nextSibling;
      if (end?.nodeType !== 8 || end.nodeValue !== TEXT_END) {
        return mismatch(`the <!--${TEXT_END}--> marker`, end);
      }
      const expected = formatText(view.get());
      if ((text as Text).data !== expected) {
        return mismatch(`reactive text ${JSON.stringify(expected)}`, text);
      }
      const next = end.nextSibling;
      start.parentNode?.removeChild(start);
      end.parentNode?.removeChild(end);
      attachLive(view, owner, (value) => {
        (text as Text).data = formatText(value);
      });
      return next;
    }

    if (typeof view !== "object") {
      return hydrateTextNode(formatText(view), target, node);
    }

    const vnode = view as VNode;
    if (vnode.kind === "fragment") {
      return hydrateInto(vnode.props.children as Renderable, target, owner, node);
    }
    if (vnode.kind === "component") {
      const componentOwner = new Owner(owner);
      const output = withOwner(componentOwner, () => vnode.type(vnode.props));
      return hydrateInto(output, target, componentOwner, node);
    }
    if (vnode.kind === "store-view") {
      if (!storeViews) {
        throw nexusDOMError(
          "STORE_VIEW_OUTSIDE_APP",
          "A view with store dependencies must be hydrated through createApp().hydrate()."
        );
      }
      return hydrateInto(storeViews.resolve(vnode), target, owner, node);
    }
    if (vnode.kind === "tracked-view") {
      const next = mountTrackedView({
        target,
        owner,
        vnode,
        scheduler,
        renderInto,
        reconcile: reconcileView,
        hydration: { node, hydrateInto },
      });
      return next === undefined ? node : next;
    }
    if (vnode.kind === "dynamic") {
      const next = renderRegion(
        target,
        owner,
        vnode.source,
        vnode.project,
        vnode.key,
        { node, hydrateInto }
      );
      return next === undefined ? node : next;
    }
    if (vnode.kind === "keyed") {
      const next = mountKeyedRegion({
        target,
        owner,
        vnode,
        scheduler,
        renderInto,
        hydration: { node, hydrateInto },
      });
      return next === undefined ? node : next;
    }
    if (vnode.kind === "error-boundary") {
      const next = renderBoundary(
        target,
        owner,
        vnode.children,
        vnode.fallback,
        { node, hydrateInto }
      );
      return next === undefined ? node : next;
    }
    if (!(node instanceof Element) || node.localName !== vnode.type) {
      return mismatch(`<${vnode.type}>`, node);
    }

    for (const [property, value] of Object.entries(vnode.props)) {
      if (property === "children" || property === "key") continue;
      if (property === "ref") attachRef(node, value, owner);
      else if (isEventProperty(property)) attachEvent(node, property, value, owner);
      else if (isLiveValue(value)) {
        attachLive(value, owner, (next, previous) =>
          writeProperty(node, property, next, previous)
        );
      } else {
        checkedDOMValue(node.localName, property, value);
      }
    }

    const remaining = hydrateInto(
      vnode.props.children as Renderable,
      node,
      owner,
      node.firstChild
    );
    if (remaining) mismatch(`the end of <${vnode.type}>`, remaining);
    return node.nextSibling;
  };

  const nextIdPrefix = () =>
    options.idPrefix ?? `r${(nextRootId++).toString(36)}`;

  const mountRoot = (
    view: Renderable,
    container: ParentNode,
    idPrefix: string,
    restoring = false
  ): MountedRoot => {
    const owner = new Owner(undefined, true, idPrefix);
    const document = container.ownerDocument ?? (container as Document);
    const fragment = document.createDocumentFragment();
    let nodes: Node[] = [];
    try {
      renderInto(view, fragment, owner);
      if (restoring) storeViews?.completeRestore?.();
      nodes = Array.from(fragment.childNodes);
      container.appendChild(fragment);
      owner.mount();
    } catch (error) {
      owner.dispose();
      for (const node of nodes) node.parentNode?.removeChild(node);
      throw error;
    }

    let disposed = false;
    return {
      dispose() {
        if (disposed) return;
        disposed = true;
        owner.dispose();
        for (const node of nodes) node.parentNode?.removeChild(node);
      },
    };
  };

  return {
    mount(view, container): MountedRoot {
      return mountRoot(view, container, nextIdPrefix());
    },
    hydrate(view, container): MountedRoot {
      const idPrefix = nextIdPrefix();
      const owner = new Owner(undefined, true, idPrefix);
      try {
        const remaining = hydrateInto(
          view,
          container as Node,
          owner,
          container.firstChild
        );
        if (remaining) mismatch("the end of the hydration root", remaining);
      } catch (error) {
        owner.dispose();
        if (
          error instanceof NexusDOMError &&
          error.code === "HYDRATION_MISMATCH"
        ) {
          options.onError?.(error);
          while (container.firstChild) {
            container.removeChild(container.firstChild);
          }
          return mountRoot(view, container, idPrefix, true);
        }
        throw error;
      }
      const nodes = Array.from(container.childNodes);
      try {
        storeViews?.completeRestore?.();
        owner.mount();
      } catch (error) {
        owner.dispose();
        for (const node of nodes) node.parentNode?.removeChild(node);
        throw error;
      }

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
