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

## Benchmark policy

Microbenchmarks are regression tools, not marketing evidence. Meaningful comparisons must use production browser builds and equal behavior. Measure initial mount, one-of-many updates, bulk updates, structural list changes, branch replacement, event storms, cleanup, heap retention and bundle size. Direct DOM is the lower bound; React, Preact Signals and Solid are comparison points once the model supports equivalent structural behavior.

The automated Headless Chrome benchmark covers exact row replacement, adjacent
swap, generic/LIS and exact/context last-to-first moves, full reverse and stable
dynamic branches with forced layout. Exact move is currently around `0.5 ms`
median versus `1.4 ms` for rebuilding 1,000 rows; full reverse remains roughly
equal. Keep the jsdom discrepancy as evidence that browser measurements,
identity semantics and multiple reorder shapes all matter.
