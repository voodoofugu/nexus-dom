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

## Current boundaries

- Browser DOM only.
- `nexus-state` remains a peer, not copied into the renderer.
- The renderer owns DOM and lifecycle; `nexus-state` owns data and actions.
- No Virtual DOM or whole-tree reconciliation in the first experiment.
- No claim of being universally faster: subscriptions, binding objects and cleanup have their own costs.
- `Show` is the first structural experiment; keyed `For` remains deferred until branch ownership is validated.
- `styled-atom` integration should use lifecycle ownership rather than merging its runtime into this package.

## Validation questions

1. Is a stable live value in JSX easy to understand?
2. Can components execute once without making dynamic UI awkward?
3. Are selector dependency changes and cleanup correct?
4. Does provenance remain useful at the DOM commit boundary?
5. What are the memory and update costs per binding?
6. At what point is local rerender/reconciliation simpler than more bindings?
7. Is compiler-free `LiveValue.render(value => value ? A : B)` intuitive enough,
   or is a small transform/component rerun worth supporting bare JSX ternaries?

## Benchmark policy

Microbenchmarks are regression tools, not marketing evidence. Meaningful comparisons must use production browser builds and equal behavior. Measure initial mount, one-of-many updates, bulk updates, structural list changes, branch replacement, event storms, cleanup, heap retention and bundle size. Direct DOM is the lower bound; React, Preact Signals and Solid are comparison points once the model supports equivalent structural behavior.
