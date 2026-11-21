import { isLiveValue } from "./live.js";
import { Owner, withOwner } from "./owner.js";
import type {
  CommitEvent,
  DOMRenderer,
  LiveValue,
  MountedRoot,
  Renderable,
  RendererOptions,
  VNode,
} from "./types.js";

interface PendingUpdate<C> {
  run: () => void;
  context?: C;
}

const eventName = (property: string) => property.slice(2).toLowerCase();

const isEventProperty = (property: string) => /^on[A-Z]/.test(property);

const formatText = (value: unknown) =>
  value === null || value === undefined || value === false ? "" : String(value);

function writeStyle(
  element: HTMLElement,
  value: unknown,
  previous: unknown
) {
  if (typeof value === "string") {
    element.style.cssText = value;
    return;
  }

  if (!value || typeof value !== "object") {
    element.removeAttribute("style");
    return;
  }

  if (previous && typeof previous === "object") {
    for (const property of Object.keys(previous)) {
      if (!(property in value)) {
        element.style.removeProperty(property);
        (element.style as unknown as Record<string, string>)[property] = "";
      }
    }
  }

  for (const [property, next] of Object.entries(value)) {
    if (property.startsWith("--")) {
      element.style.setProperty(property, String(next));
    } else {
      (element.style as unknown as Record<string, string | number>)[property] =
        next as string | number;
    }
  }
}

function writeProperty(
  element: Element,
  property: string,
  value: unknown,
  previous: unknown
) {
  if (property === "className" || property === "class") {
    if (value === null || value === undefined || value === false) {
      element.removeAttribute("class");
    } else {
      element.setAttribute("class", String(value));
    }
    return;
  }

  if (property === "style" && element instanceof HTMLElement) {
    writeStyle(element, value, previous);
    return;
  }

  if (property === "htmlFor") {
    if (value === null || value === undefined || value === false) {
      element.removeAttribute("for");
    } else {
      element.setAttribute("for", String(value));
    }
    return;
  }

  const shouldUseAttribute =
    property.startsWith("aria-") ||
    property.startsWith("data-") ||
    element.namespaceURI === "http://www.w3.org/2000/svg";

  if (!shouldUseAttribute && property in element) {
    (element as unknown as Record<string, unknown>)[property] =
      value === null || value === undefined ? "" : value;
    return;
  }

  if (value === null || value === undefined || value === false) {
    element.removeAttribute(property);
  } else if (value === true) {
    element.setAttribute(property, "");
  } else {
    element.setAttribute(property, String(value));
  }
}

export function createDOMRenderer<C = unknown>(
  options: RendererOptions<C> = {}
): DOMRenderer<C> {
  const schedule = options.schedule ?? "microtask";
  const pending = new Map<object, PendingUpdate<C>>();
  let scheduled = false;

  const enqueue = (
    token: object,
    run: () => void,
    context: C | undefined
  ) => {
    pending.set(token, {
      run,
      ...(context === undefined ? {} : { context }),
    });

    if (schedule === "manual" || scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  };

  const cancel = (token: object) => {
    pending.delete(token);
  };

  function flush() {
    scheduled = false;
    if (pending.size === 0) return;

    let updates = 0;
    const contexts: C[] = [];

    while (pending.size > 0) {
      const batch = Array.from(pending.values());
      pending.clear();

      for (const update of batch) {
        update.run();
        updates++;
        if (update.context !== undefined) contexts.push(update.context);
      }
    }

    options.onCommit?.({ updates, contexts } satisfies CommitEvent<C>);
  }

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
      enqueue(
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
      cancel(token);
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

  const renderVNode = (vnode: VNode, target: Node, owner: Owner) => {
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
    flush,
  };
}
