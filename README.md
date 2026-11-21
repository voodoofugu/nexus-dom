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

`app.dispose()` disposes every root mounted by the app and runs setup cleanups:

```tsx
const app = createApp({
  state,
  refs: { socket: null as WebSocket | null },
  setup({ refs, onCleanup }) {
    refs.socket.current = new WebSocket(url);
    onCleanup(() => refs.socket.current?.close());
  },
});
```

`$.count` is a stable `LiveValue<number>`, not the current number. The renderer attaches it to one text node and subscribes that binding to the `count` key. The `Counter` function runs only during mounting.

Derived bindings use the existing top-level dependency model of `nexus-state`:

```tsx
const total = $.$select((state) => state.price * state.quantity);

app.render(<p>Total: {total}</p>, document.body);
```

Selectors dynamically resubscribe when the set of keys they read changes.
Calling `bind` again with the same store returns the same binding, so integration
code can safely expose or reuse it without creating duplicate wrappers.

`app.render` is the normal application entry point. `createDOMRenderer` remains
available for tests, custom scheduling and advanced integrations that need to
mount several roots through the same renderer.

### Tracked views with ordinary expressions

`app.view(...)` creates an owned reactive region and passes the complete app
scope into its callback. Reads from `state` are plain values and determine the
region's top-level Nexus subscriptions dynamically:

```tsx
function Inspector() {
  return app.view(({ state, $, acts, refs }) => {
    const issue = state.issues.find(
      (candidate) => candidate.id === state.selectedIssueId
    );

    return issue ? (
      <aside ref={(node) => (refs.inspector.current = node)}>
        <h2>{issue.title}</h2>
        <button onClick={() => acts.closeIssue(issue.id)}>Close</button>
      </aside>
    ) : (
      <p>Select an issue</p>
    );
  });
}
```

The callback reruns through the renderer scheduler only when a state key it
read changes. Dependency sets can change between runs. `$` remains available
for direct text/property bindings and `.each(...)` remains the keyed collection
path, so one region can mix ordinary expressions with fine-grained updates.
Reading `acts` or `refs` does not subscribe the view.

The current experiment atomically replaces the view's local DOM region after a
rerun; it does not reconcile two arbitrary JSX results yet. Keep views small
when DOM identity, selection or input state must survive, and use `$` or keyed
rows for those hot paths. Update errors still follow owner cleanup and local
`ErrorBoundary` propagation.

`nexus-state` is a regular dependency and its framework-agnostic API is
re-exported by `nexus-dom`, so applications only need to install and import from
`nexus-dom`. `bind` still accepts the small structural `NexusSource` contract,
leaving room for explicit adapters without making them the primary design.

### Runtime ternaries without a compiler

The common boolean case can use a plain function rather than a control-flow
component:

```tsx
import { when } from "nexus-dom";

{when($.authorized, <Profile />, <Login />)}
```

`when` retains the current branch while source truthiness stays the same, even
if the underlying value changes. Function components in the inactive VNode are
not executed until that branch mounts.

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

The same optimization can stay local to the region through a structural key:

```tsx
{$.count.render(
  (count) => count >= 0 ? <Positive /> : <Negative />,
  { key: (count) => count >= 0 }
)}
```

The project function runs again only when the key changes. Bind changing values
inside a retained branch separately instead of deriving them from a skipped
project call.

The prototype still includes `Show` as a correctness baseline for branch ownership. A literally bare `{authorized ? A : B}` would require a JSX transform or component rerun because plain JavaScript evaluates it once during a one-shot component mount. Whether `.render(...)` is sufficiently intuitive remains an explicit usability question rather than a settled API decision.

### Keyed lists without a control-flow component

Reactive arrays own a keyed DOM region through `.each(...)`:

```tsx
{$.tasks.each(
  (task) => task.id,
  ($task) => <Task task={$task} />
)}
```

Rows with unchanged keys and values keep their DOM and owner when reordered.
Removing a key disposes its row. Replacing an item under the same key updates
the row's `$item` bindings without rerunning its component or replacing its DOM.
On browsers with `ParentNode.moveBefore()`, keyed moves also preserve focus and
other state associated with moved DOM nodes; older browsers use `insertBefore()`
as a compatibility fallback. On that fallback, the general diff keeps the
focused block in its increasing subsequence and exact moves rearrange neighbors
around it, so the active element itself is not detached.
Use `$item.title` in JSX and `$item.id.get()` when an event needs the current
plain value. Items should be derived from the current Nexus state;
`createNexus` clones its initial state, so external pre-construction object
references are intentionally not treated as the stored values.

Fields that collide with LiveValue methods use the explicit escape hatch:

```tsx
{$item.$field("get")}
```

`createApp` also exposes typed list operations:

```tsx
app.list("tasks").append(task);
app.list("tasks").replace(index, nextTask);
app.list("tasks").move(from, to);
app.list("tasks").remove(index);

app.list("tasks").batch((tasks) => {
  tasks.move(9, 0);
  tasks.replace(2, nextTask);
  tasks.remove(5);
});
```

They update Nexus state normally and attach an operation description to the
existing `UpdateContext.meta`. Every operation receives a unique provenance id;
`batch` carries an ordered operation list through one Nexus notification. A
direct array binding can then apply insert, remove, move or replace without
rediscovering the operation by scanning every key. Arbitrary `set({ tasks })`
calls remain supported and use a general keyed diff with a
longest-increasing-subsequence pass to minimize DOM moves. An id alone cannot
describe an arbitrary diff, so it would not remove that O(n) fallback.

Keyed blocks and dynamic branches store their actual top-level nodes internally.
They do not add `nexus-item`, `nexus-dynamic` or `nexus-show` comments, wrappers
or custom attributes to user markup. Empty text nodes are used only as invisible
insertion anchors and when a rendered keyed row has no nodes.

## Local error recovery

`ErrorBoundary` owns its rendered subtree and replaces it locally when initial
rendering or a scheduled binding/structural update throws:

```tsx
<ErrorBoundary
  fallback={(error, reset) => (
    <section role="alert">
      <p>{String(error)}</p>
      <button onClick={reset}>Try again</button>
    </section>
  )}
>
  <Editor />
</ErrorBoundary>
```

The failed owner is disposed before the fallback mounts. `reset()` remounts the
original children from current state; if a fallback itself fails, the error
continues to the next surrounding boundary and then to renderer `onError`.
Like React error boundaries, this scope covers rendering work, not exceptions
thrown later by event handlers or arbitrary asynchronous callbacks.

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
- fine-grained live item fields that preserve row DOM and focus on replacement;
- LIS-based general keyed reordering and exact context-driven list operations;
- integrated app root and resource disposal through `app.dispose()`.
- local owned error boundaries with fallback propagation and manual reset;
- tracked `app.view(...)` regions with plain state expressions and injected
  bindings, actions and refs;
- SVG namespace support, including HTML descendants of `foreignObject`;
- animation-frame scheduling for paint-aligned updates.

## Deliberately missing

- SSR and hydration;
- portals, suspense or transitions;
- a style adapter;
- full cold-navigation measurements including resource loading.

These should only be added after the basic binding model proves understandable and useful.

## Development

```bash
npm install
npm run dev
npm run check
npm run benchmark
npm run benchmark:browser
npm run benchmark:compare
npm run benchmark:compare:mobile
npm run benchmark:compare:matrix
npm run benchmark:heap
npm run benchmark:bundle
```

`npm run build` uses Rollup to produce Terser-minified ESM and CJS graphs for
the main entry and both JSX runtimes. Declarations are emitted separately to
`dist/types`, and `npm run smoke:dist` loads every built runtime entry in both
module formats.

Visual workloads can opt into frame batching:

```tsx
app.render(<CanvasView />, "#app", { schedule: "animationFrame" });
```

Scheduled binding or structural errors can be observed without aborting the
remaining bindings in the same commit:

```tsx
app.render(<App />, "#app", {
  onError(error) {
    report(error);
  },
});
```

Initial mount errors remain synchronous, but the renderer disposes the partial
owner before rethrowing. A failed dynamic replacement is prepared off-DOM, so
the previous working branch remains mounted.

Errors raised by the library itself have a recognizable, searchable format and
a stable code:

```text
nexus-dom: [RENDER_TARGET_NOT_FOUND]
Render target "#app" was not found.
```

They are instances of the exported `NexusDOMError`. Exceptions thrown by user
components or callbacks keep their original type and message, so the renderer
does not mislabel application failures as library failures.

`npm run dev` opens a counter and keyed-list playground. It exposes component execution count, DOM commit count and update provenance so the rendering model can be judged visually instead of only through unit tests.

The current benchmark is a jsdom microbenchmark. It compares direct DOM writes, a targeted Nexus binding and a deliberately naive subtree rebuild. It is useful for detecting large regressions, not for claiming performance against React, Solid or Preact. A fair comparison requires production browser builds, equal semantics, warm-up, repeated samples, memory checks and separate mount/update/list scenarios.

The automated browser benchmark launches an installed Chrome/Chromium through
`playwright-core` (set `CHROME_PATH` when it is not in a known location). It
measures an exact row replacement, general and context-described moves, adjacent
swap, complete reversal and stable dynamic branches with forced layout. On the
current local Headless Chrome run, an exact last-to-first move measured about
`0.5 ms` median versus `1.4 ms` for rebuilding 1,000 rows; a full reversal was
roughly equal to rebuilding. Results are printed with browser identity and must
be treated as machine-specific evidence, not general performance claims.

The Chrome runner also performs a coarse retention probe: it repeatedly mounts,
updates and disposes 1,000-row apps, forces garbage collection through CDP and
reports both remaining fixture nodes and heap delta. The first 20-cycle run left
zero fixture nodes and roughly `7 KiB` of heap delta after warm-up; this is a
regression signal, not proof that every user graph is leak-free.

`npm run benchmark:compare` production-builds a separate equal-semantics
comparison against React, Solid and Preact Signals. Before timing, every adapter
must prove that it mounted 1,000 rows, updated the requested text, retained row
DOM identity and focus, and produced the requested keyed order. Framework-specific
flushes are included in the measured work and every sample ends with a forced
layout. Mount samples use equal warm-up and balanced execution orders. First-call
mount is measured separately in fresh pages so it is not confused with warm
steady state. The comparison is intended to expose trade-offs, not produce a
single winner.

The same runner measures the first mount in fresh pages and compares JS heap at
1,000 and 10,000 mounted rows after forced garbage collection. It separates
one-field and two-field keyed rows, then measures again after disposal. These
heap values cover JavaScript objects, not complete native DOM memory.

`npm run benchmark:compare:matrix` repeats correctness and timing in Chromium,
Firefox and WebKit. Chromium and Firefox currently expose `moveBefore()`;
WebKit exercises the `insertBefore()` fallback. All three preserve nexus-dom row
identity, keyed order and focus in the tested reorder sequence. Heap diagnostics
remain Chromium-only because they use CDP.

`npm run benchmark:heap` runs a focused CDP sampling heap profile for static,
keyed-static and one-/two-field keyed rows. It keeps source function names and
reports retained sampled allocations per row, making it useful for locating
the structures behind changes in the forced-GC totals.

`npm run benchmark:compare:mobile` repeats the Chromium comparison with 4x CDP
CPU throttling. This is a stable low-CPU regression workload, not a substitute
for a real phone: it does not emulate mobile memory, thermals, GPU or network
conditions. In the current local run, fresh-page first mount was about `16.9
ms` for nexus-dom, `23.2 ms` for React, `20.6 ms` for Solid and `22.5 ms` for
Preact Signals. Warm 1,000-row mount was `6.4 / 6.9 / 7.3 / 9.0 ms` in the same
order; nexus-dom full reverse was `6.7 ms`, close to Solid at `6.3 ms` and below
React at `11.0 ms` and Preact Signals at `17.6 ms`. These are machine-specific
measurements, not universal rankings.

The Rollup bundle benchmark builds isolated, Terser-minified ESM entries with
`nexus-state` externalized and also builds the full entry with the dependency
included. The current local measurement is approximately `5.54 KB gzip` for
low-level core exports, `6.53 KB` for `createApp`, `6.77 KB` for the complete
main entry, and `8.34 KB` for that entry plus the tree-shaken `nexus-state`
runtime. The larger playground bundle also contains the example UI and
diagnostics, so it is not a library-size measurement.
