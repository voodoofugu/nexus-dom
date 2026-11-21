import type {
  ErrorBoundaryFallback,
  ErrorBoundaryVNode,
  Renderable,
} from "./types.js";

export interface ErrorBoundaryProps {
  fallback: ErrorBoundaryFallback;
  children?: Renderable;
}

/** Replaces an owned subtree with a local fallback when rendering fails. */
export function ErrorBoundary({
  fallback,
  children,
}: ErrorBoundaryProps): ErrorBoundaryVNode {
  return { kind: "error-boundary", fallback, children };
}
