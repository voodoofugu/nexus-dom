# nexus-dom

Experimental DOM rendering models for [`nexus-state`](https://github.com/voodoofugu/nexus-state).

This repository is a prototype, not a published framework. Its first hypothesis is that a Nexus selector can own a concrete DOM binding, allowing a state change to update that binding without executing the component again or reconciling the complete component subtree.

The hypothesis is intentionally replaceable. The project may move toward component reruns, local reconciliation or a hybrid renderer if experiments show a better correctness, ergonomics or performance trade-off.

## Current experiment

```tsx
import { createNexus } from "nexus-state";
import { bind, createDOMRenderer } from "nexus-dom";

const counter = createNexus({
  state: { count: 0 },
  acts: (get, set) => ({
    increment() {
      set({ count: get("count") + 1 });
    },
  }),
});

const $ = bind(counter);
const renderer = createDOMRenderer();

function Counter() {
  return (
    <button onClick={counter.acts.increment}>
      Clicks: {$.count}
    </button>
  );
}

const root = renderer.mount(<Counter />, document.body);

// Later:
root.dispose();
```

`$.count` is a stable `LiveValue<number>`, not the current number. The renderer attaches it to one text node and subscribes that binding to the `count` key. The `Counter` function runs only during mounting.

Derived bindings use the existing top-level dependency model of `nexus-state`:

```tsx
const total = $.$select((state) => state.price * state.quantity);

renderer.mount(<p>Total: {total}</p>, document.body);
```

Selectors dynamically resubscribe when the set of keys they read changes.

### Runtime ternaries without a compiler

An ordinary ternary can run inside a live structural region without an extra compiler:

```tsx
{$.authorized.render((authorized) =>
  authorized ? <Profile /> : <Login />
)}
```

`render` owns only this local DOM region. When the live value changes, the old branch is disposed and the selected branch is mounted. Mapping to the actual condition first avoids replacing the branch for unrelated source values:

```tsx
const positive = $.count.map((count) => count >= 0);

{positive.render((isPositive) =>
  isPositive ? <Positive /> : <Negative />
)}
```

The prototype still includes `Show` as a correctness baseline for branch ownership. A literally bare `{authorized ? A : B}` would require a JSX transform or component rerun because plain JavaScript evaluates it once during a one-shot component mount. Whether `.render(...)` is sufficiently intuitive remains an explicit usability question rather than a settled API decision.

## Implemented

- automatic JSX runtime;
- elements, fragments and function components;
- text and DOM property bindings;
- static and live event handlers;
- selector dependency tracking;
- microtask update deduplication;
- manual flushing for deterministic tests and measurements;
- owner-based subscription, event and component cleanup;
- update contexts carried into renderer commit events.
- an experimental owned `Show` branch with deterministic cleanup.
- compiler-free `LiveValue.render(...)` regions with normal ternary expressions.

## Deliberately missing

- keyed list reconciliation;
- SSR and hydration;
- portals, boundaries, suspense or transitions;
- a style adapter;
- a production scheduler;
- browser-level comparative benchmarks.

These should only be added after the basic binding model proves understandable and useful.

## Development

```bash
npm install
npm run dev
npm run check
npm run benchmark
```

`npm run dev` opens a small counter playground. It exposes component execution count, DOM commit count and update provenance so the rendering model can be judged visually instead of only through unit tests.

The current benchmark is a jsdom microbenchmark. It compares direct DOM writes, a targeted Nexus binding and a deliberately naive subtree rebuild. It is useful for detecting large regressions, not for claiming performance against React, Solid or Preact. A fair comparison requires production browser builds, equal semantics, warm-up, repeated samples, memory checks and separate mount/update/list scenarios.
