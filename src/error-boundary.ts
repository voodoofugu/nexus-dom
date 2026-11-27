import type {
  ErrorBoundaryFallback,
  ErrorBoundaryVNode,
  Renderable,
} from "./types.js";

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***ErrorBoundaryProps***:
 * provides the protected children and rendering error fallback.
 */
export interface ErrorBoundaryProps {
  fallback: ErrorBoundaryFallback;
  children?: Renderable;
}

/**---
 * ## ![logo](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/nexus-dom-logo.svg)
 * ### ***ErrorBoundary***:
 * replaces a failed render subtree with local recovery UI.
 * @description
 * The fallback receives the error and a reset function. Reset renders
 * the original children using current state.
 * @param props protected children and fallback content or callback.
 * @returns an owned boundary region.
 * @example
 * ```tsx
 * <ErrorBoundary fallback={(error, reset) => (
 *   <button onClick={reset}>{String(error)}</button>
 * )}>
 *   <Editor />
 * </ErrorBoundary>
 * ```
 */
export function ErrorBoundary({
  fallback,
  children,
}: ErrorBoundaryProps): ErrorBoundaryVNode {
  return { kind: "error-boundary", fallback, children };
}
