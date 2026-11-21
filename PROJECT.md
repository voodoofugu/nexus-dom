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

`app.view(({ state, $, acts, refs }) => JSX)` is the first hybrid-rendering
experiment. It tracks ordinary top-level state reads, reruns only the owned
region through the renderer scheduler, and injects the complete application
scope so the component tree does not have to transport state, actions or
runtime refs. The current implementation replaces the local region atomically;
fine-grained `$` bindings and keyed `.each(...)` remain the identity-preserving
paths until local reconciliation is justified by dogfood evidence.

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
9. Does `app.view(...)` make ordinary application code clear enough without a
   compiler, and what is the smallest useful reconciliation boundary?
10. Should app-scoped imperative refs get an explicit `afterCommit` hook for
    commands such as focus, rather than relying on scheduler timing?

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
- Local error boundaries dispose failed owned subtrees, render recovery UI and
  can remount their original children from current state.
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
`app.view(...)` makes that scope available at the rendering boundary, so plain
tracked state, actions, fine-grained bindings and runtime refs do not need prop
drilling or a provider hierarchy.

### Limitations

- Boolean conditional UI has compiler-free `when(live, truthy, fallback)`;
  value-dependent branches still require `.render(...)`. Bare reactive JSX
  expressions cannot work with one-shot components without a compiler or
  component reruns.
- Tracked views support ordinary expressions but currently replace their whole
  local branch after a relevant update. They need local reconciliation before
  they can safely own focus-sensitive editor trees.
- Arbitrary array replacement needs O(n) keyed reconciliation. Fast exact
  operations require `app.list(...)` metadata.
- SSR, hydration, portals, suspense, transitions,
  style integration and renderer devtools do not exist yet.
- Empty text anchors are still internal structural nodes, even though comments,
  wrappers and custom attributes were removed.
- `moveBefore()` preserves state in Chromium and Firefox. WebKit currently uses
  `insertBefore()`; the renderer keeps the active block stationary during
  general and exact moves, preserving focus in the tested cases, but cannot
  promise every other stateful-move behavior of the native primitive.
- The complete tree-shaken renderer and `nexus-state` runtime currently measure
  about `8.34 KB gzip`; actual application cost still depends on imported APIs
  and bundler behavior.

### Current problems and likely solutions

1. **Cold mount and tail latency.** A fresh-page, first-call measurement now
   runs each renderer in a new page with balanced order. The current Chrome
   median is about `13.2 ms` for nexus-dom, `15.4 ms` for React, `14.4 ms` for
   Solid and `16.0 ms` for Preact Signals. This excludes network loading and is
   not a full cold-navigation metric; p95 and other browsers still matter.
2. **Per-row allocation.** Every keyed row owns an Owner, mutable LiveItem,
   Proxy, field storage and subscriptions. A focused sampling heap benchmark now
   separates keyed-static infrastructure from one and two DOM bindings. Single
   cleanup/field storage, a shared Proxy handler and scheduler token, a
   prototype row controller, and scalar storage for single-node rows reduced
   one-field rows from roughly `979` to `686 B/row` and two-field rows from
   `1,287` to `996 B/row`. The current ref-mount lifecycle measures keyed-static
   infrastructure at `313 B/row`, Preact Signals at `755 B/row` and Solid at
   `566 B/row`. The remaining gap to Solid is primarily binding/subscription
   state rather than retained leaks; disposal still returns to baseline.
3. **Control-flow ergonomics.** The first dogfood workspace now uses tracked
   `app.view(...)` regions for plain conditionals, array methods and derived
   summaries while retaining `$` and `.each(...)` for hot identity-sensitive
   paths. The next question is whether small local reconciliation can preserve
   inputs and focus without turning the runtime into a general VDOM renderer.
4. **Generic list fallback.** Keep O(n) reconciliation for arbitrary `set` and
   improve exact operations instead of hiding scans behind structural hashes.
5. **Error recovery.** The local owned boundary now has explicit fallback,
   reset and outward propagation semantics. Event-handler and arbitrary async
   errors intentionally remain outside its rendering scope; global `onError`
   remains the final renderer-level reporting hook.
6. **Compatibility and evidence.** Chromium, Firefox and WebKit now share the
   same correctness gates and broad relative result. A 4x CPU-throttled Chrome
   run and total bundled dependency cost are recorded; real mobile hardware and
   full network-cold navigation remain necessary before public claims.

## Benchmark policy

Microbenchmarks are regression tools, not marketing evidence. Meaningful comparisons must use production browser builds and equal behavior. Measure initial mount, one-of-many updates, bulk updates, structural list changes, branch replacement, event storms, cleanup, heap retention and bundle size. Direct DOM is the lower bound; React, Preact Signals and Solid are comparison points once the model supports equivalent structural behavior.

The automated Headless Chrome benchmark covers exact row replacement, adjacent
swap, generic/LIS and exact/context last-to-first moves, full reverse and stable
dynamic branches with forced layout. Exact move is currently around `0.5 ms`
median versus `1.4 ms` for rebuilding 1,000 rows; full reverse remains roughly
equal. Keep the jsdom discrepancy as evidence that browser measurements,
identity semantics and multiple reorder shapes all matter.

The isolated Rollup/Terser ESM benchmark currently measures roughly `5.54 KB
gzip` for core, `6.53 KB` for `createApp`, and `6.77 KB` for the full main entry
with `nexus-state` externalized. The same full entry is `8.34 KB gzip` when the
tree-shaken dependency is bundled. Track both separately from the playground
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
Signals. Fresh-page first-call mount is reported separately from this warm
steady-state result; full network-cold navigation is still unmeasured.

Initial keyed rows now share one staging `DocumentFragment` instead of creating
and transferring one fragment per row. On the balanced Chrome mount benchmark,
the A/B median improved from roughly `2.0 ms` to `1.6 ms` for 1,000 reactive
rows at a cost of about `0.11 KB gzip`.

The comparison runner also measures JS heap after forced GC at 1,000 and 10,000
rows, and again after disposal. The current optimized one-field keyed model uses
about `6.5 MiB` for 10,000 mounted rows and returns to baseline after disposal;
native DOM memory is not represented by `JSHeapUsedSize`, so direct-DOM values
are only a JS-object baseline.

The same production workload passes in Firefox and WebKit. Firefox exposes
`moveBefore()` and retains focus naturally. WebKit does not; a constrained LIS
and neighbor-shifting exact move keep the focused block stationary. WebKit now
retains focus for nexus-dom in the benchmark where Solid and Preact Signals do
not. Absolute Firefox/WebKit timings have coarser resolution than Chrome and are
used mainly for relative behavior and regression detection.

The CPU-throttled Chrome workload uses a 4x CDP slowdown. In the current run,
nexus-dom had the lowest fresh-page first-mount median (`16.9 ms`) and its warm
1,000-row mount (`6.4 ms`) stayed near React (`6.9 ms`) and Solid (`7.3 ms`).
Full reverse was `6.7 ms`, compared with Solid `6.3 ms`, React `11.0 ms` and
Preact Signals `17.6 ms`. This isolates CPU pressure on the desktop browser; it
does not model a phone's memory, GPU, thermal limits or network.
