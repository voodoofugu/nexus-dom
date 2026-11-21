# nexus-dom — experiment context

_Started: 2026-11-21 · status: exploratory_

## Goal

Test whether the subscription and provenance model of `nexus-state` can support a small, understandable DOM renderer with precise updates and reliable resource ownership.

This is not currently a framework project. Fine-grained DOM binding is the first hypothesis, not a locked architecture. Component reruns, local reconciliation and hybrid approaches remain valid outcomes of the experiment.

## First hypothesis

A component executes once to create DOM. Stable `LiveValue` objects connect Nexus keys or selectors to concrete text/property bindings. Nexus updates invalidate only those bindings; a scheduler deduplicates them and commits the latest values.

```text
nexus.set
→ subscribed LiveValue
→ dirty binding set
→ DOM commit
```

The renderer preserves the Nexus update context so tooling can explain which state transition caused each DOM commit.

The public application path is deliberately small: `bind(store)` creates (and
caches) the reactive view of Nexus state, while `render(view, target)` owns the
renderer instance. `createDOMRenderer` is a low-level escape hatch rather than a
required setup step.

`createApp({ state, refs, acts })` is the primary integrated facade. It creates
Nexus and bindings internally, exposes reactive values under `$`, non-reactive
`{ current }` cells under `refs`, actions under `acts`, and owns the convenient
`app.render(...)` entry point.

## Current boundaries

- Browser DOM only.
- `nexus-state` is a regular dependency, not copied into the renderer runtime.
- The renderer owns DOM and lifecycle; `nexus-state` owns data and actions.
- No Virtual DOM or whole-tree reconciliation in the first experiment.
- No claim of being universally faster: subscriptions, binding objects and cleanup have their own costs.
- `Show` established branch ownership; keyed lists now reuse the same owner and
  cleanup model without introducing a component-like `<For>` primitive.
- Keyed arrays use `liveArray.each(key, project)` rather than a component-like
  `<For>` control flow. Unchanged rows preserve DOM identity and ownership;
  changed values update `$item` bindings without rerunning or replacing the row.
- General reorders use LIS to minimize physical moves. `app.list(key)` attaches
  insert/remove/move/replace metadata to the existing Nexus `UpdateContext`, so
  direct array bindings can skip the O(n) key scan for known operations.
- Keyed blocks prefer `ParentNode.moveBefore()` so modern browsers retain focus
  and DOM state during moves; `insertBefore()` remains the compatibility path.
- `app.list(key).batch(...)` preserves an ordered set of operations and unique
  operation ids through one automatically batched Nexus notification. Arbitrary
  array replacement still uses O(n) reconciliation because identity alone does
  not describe a diff.
- Keyed blocks and dynamic branches retain their actual top-level nodes. No
  item/dynamic/show comments, wrapper elements or custom Nexus attributes are
  injected into user markup.
- DOM block references remain private renderer ownership. They are not stored in
  Nexus state, because one store may feed several roots and DOM resources must
  follow root disposal. `app.refs` is reserved for explicit user runtime values.
- `nexus-state` is a regular dependency and the default data model. Its core API
  is re-exported so applications can install and import only `nexus-dom`; the
  small structural `NexusSource` contract remains available for future adapters.
- `styled-atom` integration should use lifecycle ownership rather than merging its runtime into this package.
- `app.dispose()` owns all roots and setup cleanups; `setup({ onCleanup })`
  provides lifecycle for sockets and other user runtime refs.
- SVG elements use their native namespace, and `animationFrame` scheduling is
  available for paint-aligned canvas/scroll-style workloads.
- Initial mount failures dispose partial owners before rethrowing. Dynamic
  branches are prepared off-DOM and retain the previous branch on failure;
  scheduled errors can be observed through renderer `onError` without blocking
  unrelated bindings in the same commit.
- Library-owned failures use exported `NexusDOMError` with the visual format
  `nexus-dom: [CODE]` followed by an actionable message. Errors thrown by user
  code remain untouched.

## Structural hash decision

A hash of serialized list or DOM structure is not used as an update protocol.
An order-sensitive hash can show that an arbitrary tree changed, but it cannot
describe which rows moved or which DOM operations restore the new order. A
per-row hash still requires an O(n) pass, duplicates keyed identity and needs a
collision check. Maintaining hashes incrementally would itself require precise
mutation metadata, which `app.list(...)` already provides without losing the
operation. Hashes may still be useful later for hydration or immutable-subtree
memoization, but they do not reduce the physical work of a full reverse.

## Validation questions

1. Is a stable live value in JSX easy to understand?
2. Can components execute once without making dynamic UI awkward?
3. Are selector dependency changes and cleanup correct?
4. Does provenance remain useful at the DOM commit boundary?
5. What are the memory and update costs per binding?
6. At what point is local rerender/reconciliation simpler than more bindings?
7. Is compiler-free `LiveValue.render(value => value ? A : B)` intuitive enough,
   or is a small transform/component rerun worth supporting bare JSX ternaries?
8. Can keyed reordering preserve identity without making worst-case full-list
   permutations disproportionately expensive?

## Current assessment

### Strengths

- Fine-grained bindings update concrete DOM nodes without rerunning a component
  or diffing its complete subtree.
- Nexus update contexts reach the DOM commit boundary, so state provenance can
  support diagnostics and future developer tools.
- Keyed rows retain DOM identity, ownership and focus; exact list operations
  avoid rediscovering a diff that the application already knows.
- Components, runtime ternaries and keyed lists work without a compiler beyond
  the normal JSX runtime transform.
- The renderer has explicit ownership, deterministic cleanup, atomic dynamic
  branch replacement and actionable library errors.
- Update and reorder performance is already close to Solid in the current
  browser benchmark, while the API remains centered on `nexus-state`.

### Developer value

The current model is most promising for applications with long-lived DOM and
frequent sparse updates: editors, dashboards, interactive tables, task boards,
streaming status screens, scroll-driven interfaces and canvas-adjacent tools.
It is especially useful when focus, selection, element identity or explicit
update provenance matters more than recreating component trees. `createApp`
also gives existing Nexus users one integrated state, action, ref and render
lifecycle instead of another reactive runtime to coordinate.

### Limitations

- Conditional UI requires `.render(...)`; bare reactive JSX expressions cannot
  work with one-shot components without a compiler or component reruns.
- Arbitrary array replacement needs O(n) keyed reconciliation. Fast exact
  operations require `app.list(...)` metadata.
- SSR, hydration, portals, local error boundaries, suspense, transitions,
  style integration and renderer devtools do not exist yet.
- Empty text anchors are still internal structural nodes, even though comments,
  wrappers and custom attributes were removed.
- `moveBefore()` preserves state in modern browsers, but the compatibility
  `insertBefore()` path cannot promise identical focus behavior everywhere.
- The measured library entry excludes the installed `nexus-state` dependency;
  total application cost must be reported separately before publication.

### Current problems and likely solutions

1. **Cold mount and tail latency.** Warm mount is now competitive, but first-run
   cost and p95 need separate pages and allocation/GC profiling. Keep static JSX,
   keyed ownership and field subscriptions as separate diagnostic layers.
2. **Per-row allocation.** Every keyed row owns an Owner, mutable LiveItem,
   Proxy, field map and subscriptions. Measure retained bytes per 1,000/10,000
   rows before considering lazy owners, flatter cleanup records or fewer wrapper
   objects; do not pool mutable ownership without evidence.
3. **Control-flow ergonomics.** Test `.render(...)` in a real application before
   deciding between the current compiler-free API, a small optional transform or
   a controlled component-rerun mode.
4. **Generic list fallback.** Keep O(n) reconciliation for arbitrary `set` and
   improve exact operations instead of hiding scans behind structural hashes.
5. **Error recovery.** Add a local owned boundary only when its fallback,
   reset and propagation semantics are clear; global `onError` is reporting, not
   local recovery UI.
6. **Compatibility and evidence.** Add Firefox/WebKit and mobile-class runs,
   cold-start measurements, total bundle cost and heap-per-binding tests before
   making public performance claims.

## Benchmark policy

Microbenchmarks are regression tools, not marketing evidence. Meaningful comparisons must use production browser builds and equal behavior. Measure initial mount, one-of-many updates, bulk updates, structural list changes, branch replacement, event storms, cleanup, heap retention and bundle size. Direct DOM is the lower bound; React, Preact Signals and Solid are comparison points once the model supports equivalent structural behavior.

The automated Headless Chrome benchmark covers exact row replacement, adjacent
swap, generic/LIS and exact/context last-to-first moves, full reverse and stable
dynamic branches with forced layout. Exact move is currently around `0.5 ms`
median versus `1.4 ms` for rebuilding 1,000 rows; full reverse remains roughly
equal. Keep the jsdom discrepancy as evidence that browser measurements,
identity semantics and multiple reorder shapes all matter.

The isolated Rollup/Terser ESM benchmark currently measures roughly `4.16 KB
gzip` for core, `5.07 KB` for `createApp`, and `5.27 KB` for the full main entry
with `nexus-state` externalized. Track these separately from the playground
bundle.

The browser runner includes a forced-GC retention probe. The first warm 20-cycle
mount/update/dispose run left zero fixture nodes and about `7 KiB` heap delta;
use it only as a regression baseline because browser heap measurements vary.

The separate production comparison runner covers nexus-dom, React, Solid and
Preact Signals. Each adapter has correctness gates for row count, text update,
DOM identity, focus and keyed order before timing. Mount samples are warmed and
run through balanced permutations so one renderer does not consistently pay for
JIT or preceding allocation. After batching initial keyed construction into one
staging fragment, the current warm Chrome median for 1,000 rows is roughly `1.6
ms` for nexus-dom, `1.5 ms` for React, `1.6 ms` for Solid and `1.9 ms` for Preact
Signals. Cold first mount remains a separate unanswered question.

Initial keyed rows now share one staging `DocumentFragment` instead of creating
and transferring one fragment per row. On the balanced Chrome mount benchmark,
the A/B median improved from roughly `2.0 ms` to `1.6 ms` for 1,000 reactive
rows at a cost of about `0.11 KB gzip`.
