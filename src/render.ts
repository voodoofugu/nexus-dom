import { createDOMRenderer } from "./renderer.js";
import type {
  Renderable,
  RendererOptions,
  RenderRoot,
} from "./types.js";

function resolveTarget(target: ParentNode | string): ParentNode {
  if (typeof target !== "string") return target;

  const element = document.querySelector(target);
  if (!element) {
    throw new Error(`[nexus-dom] Render target "${target}" was not found.`);
  }
  return element;
}

/** Mounts a view using an isolated DOM renderer. */
export function render<C = unknown>(
  view: Renderable,
  target: ParentNode | string,
  options: RendererOptions<C> = {}
): RenderRoot {
  const renderer = createDOMRenderer(options);
  const root = renderer.mount(view, resolveTarget(target));

  return {
    dispose: root.dispose,
    flush: renderer.flush,
  };
}
