# nexus-dom

Experimental DOM rendering models for [`nexus-state`](https://github.com/voodoofugu/nexus-state).

This repository is a prototype, not a published framework. Its first hypothesis is that a Nexus selector can own a concrete DOM binding, allowing a state change to update that binding without executing the component again or reconciling the complete component subtree.

The hypothesis is intentionally replaceable. The project may move toward component reruns, local reconciliation or a hybrid renderer if experiments show a better correctness, ergonomics or performance trade-off.

## Current experiment

```tsx
import { createApp } from "nexus-dom";

const app = createApp({
  state: { count: 0 },
  refs: { canvas: null as HTMLCanvasElement | null },
  acts: (get, set, refs) => ({
    increment() {
      set({ count: get("count") + 1 });
    },
  }),
});

const { $, acts, refs } = app;

function Counter() {
  return (
    <button onClick={acts.increment}>
      Clicks: {$.count}
    </button>
  );
}

const root = app.render(<Counter />, "#app");

// Later:
root.dispose();
```

`createApp` creates Nexus state, stable bindings, non-reactive refs and the root
render facade together. State under `$` updates attached DOM bindings. Values in
`refs` are ordinary `{ current }` cells: changing them does not schedule DOM
work, which makes them suitable for elements, canvas contexts, sockets and other
runtime resources. The lower-level `createNexus`, `bind` and `render` exports
remain available independently.

`$.count` is a stable `LiveValue<number>`, not the current number. The renderer attaches it to one text node and subscribes that binding to the `count` key. The `Counter` function runs only during mounting.

Derived bindings use the existing top-level dependency model of `nexus-state`:

```tsx
const total = $.$select((state) => state.price * state.quantity);

app.render(<p>Total: {total}</p>, document.body);
```

Selectors dynamically resubscribe when the set of keys they read changes.
Calling `bind` again with the same store returns the same binding, so integration
code can safely expose or reuse it without creating duplicate wrappers.

`render` is the normal application entry point. `createDOMRenderer` remains
available for tests, custom scheduling and advanced integrations that need to
mount several roots through the same renderer.

`nexus-state` is a regular dependency and its framework-agnostic API is
re-exported by `nexus-dom`, so applications only need to install and import from
`nexus-dom`. `bind` still accepts the small structural `NexusSource` contract,
leaving room for explicit adapters without making them the primary design.

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

### Keyed lists without a control-flow component

Reactive arrays own a keyed DOM region through `.each(...)`:

```tsx
{$.tasks.each(
  (task) => task.id,
  (task) => <Task task={task} />
)}
```

Rows with unchanged keys and values keep their DOM and owner when reordered.
Removing a key disposes its row, while replacing an item under the same key
rerenders only that row. Items should be derived from the current Nexus state;
`createNexus` clones its initial state, so external pre-construction object
references are intentionally not treated as the stored values.

Keyed blocks and dynamic branches store their actual top-level nodes internally.
They do not add `nexus-item`, `nexus-dynamic` or `nexus-show` comments, wrappers
or custom attributes to user markup. Empty text nodes are used only as invisible
insertion anchors and when a rendered keyed row has no nodes.

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
- compiler-free keyed list regions through `LiveValue.each(...)`.

## Deliberately missing

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
npm run benchmark:browser
```

`npm run dev` opens a counter and keyed-list playground. It exposes component execution count, DOM commit count and update provenance so the rendering model can be judged visually instead of only through unit tests.

The current benchmark is a jsdom microbenchmark. It compares direct DOM writes, a targeted Nexus binding and a deliberately naive subtree rebuild. It is useful for detecting large regressions, not for claiming performance against React, Solid or Preact. A fair comparison requires production browser builds, equal semantics, warm-up, repeated samples, memory checks and separate mount/update/list scenarios.

The automated browser benchmark launches an installed Chrome/Chromium through
`playwright-core` (set `CHROME_PATH` when it is not in a known location). It
measures a targeted row update, adjacent swap, last-to-first move and complete
reversal with forced layout. On the first local Headless Chrome run, keyed
updates won the targeted and small-reorder cases while a full reversal was
roughly equal to rebuilding. Results are printed with browser identity and must
be treated as machine-specific evidence, not general performance claims.
