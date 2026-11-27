![nexus-dom banner](https://raw.githubusercontent.com/voodoofugu/nexus-dom/main/src/assets/01-banner-logo.svg)

<h2></h2>

### Table of contents

- [About](#about)
- [Installation](#installation)
- [Quick start](#quick-start)
- [API](#api)
- [Recipes](#recipes)
- [Security](#security)
- [Development](#development)
- [License](#license)

<h2></h2>

### About

`nexus-dom` renders JSX to the DOM with
[`nexus-state`](https://github.com/voodoofugu/nexus-state).

- **Two update paths.** Read plain `state` to track a component's dependencies,
  or pass `$` values into JSX to update individual DOM bindings.
- **Shared stores.** Components declare the stores they can use. Each app
  creates the stores its components access and disposes their resources.
- **Keyed collections.** Rows retain their DOM identity across reorder and
  update their live fields independently.
- **Server rendering.** Render HTML synchronously and hydrate the existing DOM
  with stable IDs and JSON store snapshots.

<h2></h2>

### Installation

```bash
npm install nexus-dom
```

| Import | Contents |
| --- | --- |
| `nexus-dom` | Components, stores, DOM rendering and bindings |
| `nexus-dom/server` | Synchronous HTML rendering |
| `nexus-dom/jsx-runtime` | Automatic JSX runtime |
| `nexus-dom/jsx-dev-runtime` | Development JSX runtime |

All entries ship ESM and CommonJS with TypeScript declarations.
`nexus-state` is installed as a dependency. The main entry re-exports
`createNexus`, `createActs` and `persist`.

Set the automatic JSX runtime in `tsconfig.json`.

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "nexus-dom"
  }
}
```

Add `<div id="app"></div>` to the page and load your TSX entry with your build tool.

<h2></h2>

### Quick start

Mount a counter whose text updates directly when its store changes.

<details><summary><b>Counter</b> with <code>store</code>, <code>component</code> and <code>createApp</code></summary>
<br>

```tsx
import { createApp, store, component } from "nexus-dom";

const counter = store({ state: { count: 0 } });
const Counter = component(({ $ }) => (
  <button onClick={() => $.count.set((count) => count + 1)}>
    Clicks: {$.count}
  </button>
), [counter]);

const app = createApp();
app.render(<Counter />, "#app");
```

Call `app.dispose()` when the application is removed to dispose its DOM roots
and store resources.

</details>

<h2></h2>

### API

<details><summary><b><code>nexus-dom</code></b></summary>
<br>

###### **— APPLICATION —**

<details><summary><b><code>createApp</code></b> <em>(roots, state and lifecycle)</em></summary>
<br>

```tsx
import { createApp } from "nexus-dom";

const app = createApp({
  state: { count: 0 },
  refs: { canvas: null as HTMLCanvasElement | null },
  acts: (get, set) => ({
    increment() {
      set({ count: get("count") + 1 });
    },
  }),
});

const { $, acts } = app;

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

`createApp()` owns the roots and lazy stores of one application.
`createApp({ state, refs, acts })` also creates an app-level Nexus store
and its bindings. Refs are mutable `{ current }` cells for elements, canvas
contexts, sockets and other runtime resources.

`app.dispose()` disposes every root mounted by the app and runs setup cleanups.

```tsx
const app = createApp({
  state: {},
  refs: { socket: null as WebSocket | null },
  setup({ refs, onCleanup }) {
    refs.socket.current = new WebSocket(url);
    onCleanup(() => refs.socket.current?.close());
  },
});
```

</details>

<details><summary><b><code>render / createDOMRenderer</code></b> <em>(standalone DOM rendering)</em></summary>
<br>

`render(view, target, options?)` mounts into a DOM container or selector and
returns a root with `.dispose()` and `.flush()`. Use it with function
components and existing bindings. Use `createApp().render(...)` to resolve
lazy stores declared with `store`.

`createDOMRenderer(options?)` exposes `.mount()`, `.hydrate()` and `.flush()`
when several roots need to share one scheduler.

```tsx
import { createDOMRenderer } from "nexus-dom";

const renderer = createDOMRenderer({ schedule: "manual" });
const root = renderer.mount(<p>Ready</p>, document.body);
renderer.flush();
root.dispose();
```

</details>

<details><summary><b><code>onCleanup</code></b> <em>(component resources)</em></summary>
<br>

`onCleanup(cleanup)` registers work to run when the current component owner
is disposed. Call it while the component renders. For resources shared by
the whole app, use the store's `setup` or `mount` callback.

```tsx
import { onCleanup } from "nexus-dom";

function SearchInput() {
  let observer: ResizeObserver | undefined;
  onCleanup(() => observer?.disconnect());
  return <input ref={(node) => {
    if (!node) return;
    observer = new ResizeObserver(handleResize);
    observer.observe(node);
  }} />;
}
```

</details>

###### **— STORES AND COMPONENTS —**

<details><summary><b><code>store</code></b> <em>(state, actions and refs)</em></summary>
<br>

`store(options, dependencies?)` declares state, actions and refs. Each app
creates its own instance the first time a component uses the descriptor.
The returned descriptor can be reused by as many components as needed.

Stores can declare dependencies for their actions and lifecycle callbacks.

```tsx
const session = store({ state: { currentUser: "Alex" } });

const assignments = store(
  {
    state: { assignee: "Unassigned" },
    acts: ({ set, dependencies }) => ({
      assignCurrentUser() {
        set({ assignee: dependencies.get("currentUser") });
      },
    }),
    setup({ onCleanup }) {
      const socket = connectAssignments();
      onCleanup(() => socket.close());
    },
  },
  [session]
);
```

Dependency cycles fail during mount. Each store sends its own notifications
and update contexts. The renderer coalesces synchronous updates into one pass
and uses the latest context for a queued component update. Keep invariants
that require atomic observation inside one store.

Use `mount` for client integrations that can change state, such as restoring
preferences from storage or connecting Redux DevTools. It runs once per
app-scoped store when a view that depends on it first mounts. Store
dependencies mount before their dependents. During hydration, the callback
runs after DOM adoption and snapshot validation. Storage values then reach
the component through scheduled updates.

```ts
import { persist, store } from "nexus-dom";

const preferences = store({
  state: { compact: false },
  acts: ({ reset }) => ({
    resetPreferences: () => reset("compact"),
  }),
  mount({ nexus }) {
    return persist(nexus, { key: "preferences", include: ["compact"] });
  },
});
```

Use `setup` for initialization needed during the first client render.
Both callbacks are client-only. Returned cleanup functions and callbacks
registered with `onCleanup` run on `app.dispose()`.

</details>

<details><summary><b><code>component</code></b> <em>(tracked JSX components)</em></summary>
<br>

`component(render, stores?)` defines a JSX component. Its callback receives
the store scope first and the component's props second.

```tsx
import { component, createApp, store } from "nexus-dom";

type Issue = { id: number; title: string };

const issues = store({
  state: { issues: [{ id: 1, title: "Review draft" }] as Issue[] },
  acts: ({ get, set }) => ({
    add(issue: Issue) {
      set({ issues: [...get("issues"), issue] });
    },
  }),
});

const IssueTitle = component(
  ({ state }, { issueId }: { issueId: number }) => {
    const issue = state.issues.find((item) => item.id === issueId);
    return <strong>{issue?.title}</strong>;
  },
  [issues]
);

const app = createApp();
app.render(<IssueTitle issueId={1} />, "#app");
```

The first mounted consumer resolves a descriptor to one app-scoped store.
Later components using the same descriptor receive its current values.
Each app gets an independent instance. Dependency arrays merge `state`, `$`,
`acts` and `refs`, and duplicate keys are rejected by TypeScript and again at
runtime. JSX attributes remain per-instance input, while shared mutable data
belongs to explicit store dependencies.

</details>

<details><summary><b><code>componentScope</code></b> <em>(shared store namespaces)</em></summary>
<br>

With `component(render, [stores])`, each component declares its own stores.
Rendering a child inside a parent leaves that list unchanged. If both
components declare the same descriptor, they share its instance within the app.

`componentScope(stores)` groups state, bindings, actions and refs by the names in
your store map. Each application creates its own instances when a view reads
a group.

```tsx
const workspaceComponent = componentScope({ main, preferences, issues });

const IssueTitle = workspaceComponent(
  ({ state }, { issueId }: { issueId: number }) => (
    <strong class={state.preferences.theme}>
      {state.issues.items.find((issue) => issue.id === issueId)?.title}
    </strong>
  )
);
```

This render opens `preferences` and `issues`. The first read of `main` can
happen in another component. Pass a named object directly to `component`
for a standalone component. The same syntax adds stores to a scoped component.

```tsx
const titleStates = store({ state: { text: "Title" } });
const subTitleStates = store({ state: { text: "Subtitle" } });

const Title = component(
  ({ state }) => <h1>{state.title.text}</h1>,
  { title: titleStates }
);
const titleComponent = componentScope({ title: titleStates });
const SubTitle = titleComponent(
  ({ state }) => <p>{state.title.text} · {state.subtitle.text}</p>,
  { subtitle: subTitleStates }
);
```

The keys in these objects become the names used under `state`, `$`, `acts`
and `refs`. The object in `SubTitle` adds `subtitle` to the shared `title`
scope. Names must be unique within a component. Use a descriptor array in
`component` for a flat scope.

Reading `state.preferences.theme` subscribes the view to the preferences
store. Use `$.preferences.theme` for a binding to that field alone. Reading
an action or ref opens its store without subscribing the view. Each binding
group has its own `$select` for a selector within that store. Use
`$.$select` to read several stores in one selector.

```tsx
const visibleIssues = $.$select(({ filters, issues }) =>
  issues.items.filter((issue) => issue.title.includes(filters.query))
);
```

The selector tracks the fields it reads inside each store. Here, changing
`issues.selectedIssueId` leaves the filter untouched. Reading a whole
namespace or enumerating its fields subscribes to the store as a whole.
Conditional reads update subscriptions on each run. `$select` is reserved
as a store name within a component scope.

</details>

<details><summary><b><code>id</code></b> <em>(stable component IDs)</em></summary>
<br>

```tsx
import { component, createApp } from "nexus-dom";

const Field = component(({ id }) => {
  const inputId = id("input");
  return (
    <>
      <label for={inputId}>Email</label>
      <input id={inputId} />
    </>
  );
});

createApp().render(<Field />, "#app", { idPrefix: "account" });
```

The ID survives tracked reruns and differs for each component instance.
Its format is `nxs-<7-character hash>`. Use the same `idPrefix` and initial
tree on the server and the client. Client-only roots get a unique prefix
automatically.

</details>

###### **— LIVE BINDINGS —**

<details><summary><b><code>bind / createLiveSelector / isLiveValue</code></b> <em>(bind an existing source)</em></summary>
<br>

`bind(nexus)` returns stable `LiveValue` bindings for an existing Nexus source.
Repeated calls for the same source return the same object. `$select` is
reserved for derived values. A binding reads its current value with `.get()`
and can be used as JSX text or a DOM property.

```tsx
import { bind, createNexus, render } from "nexus-dom";

const nexus = createNexus({ state: { price: 12, quantity: 2 } });
const $ = bind(nexus);
const total = $.$select((state) => state.price * state.quantity);

render(<p>Total: {total}</p>, "#app");
```

Selectors track top-level reads and update their subscriptions when those
reads change. `createLiveSelector(source, selector, isEqual?)` creates a
standalone selector. `isLiveValue(value)` narrows an unknown value to
`LiveValue`. Use `.map(project, isEqual?)` to derive a binding from one live value.

</details>

<details><summary><b><code>WritableLiveValue.set</code></b> <em>(update a store field)</em></summary>
<br>

Bindings from `store(...)` expose `.set(value)` and `.set(current => value)`.

```tsx
<button onClick={() => $.count.set((count) => count + 1)}>
  {$.count}
</button>

<button onClick={() => $.filter.set("active")}>Active</button>
```

Use a functional updater for changes that depend on the current value.
Direct updates use the `$.set` context source. Use named actions for shared
domain operations, validation and multi-key changes.

</details>

<details><summary><b><code>when / Show</code></b> <em>(conditional branches)</em></summary>
<br>

Selects a branch by the truthiness of a live value.

```tsx
import { when } from "nexus-dom";

{when($.authorized, <Profile />, <Login />)}
```

`when` retains the current branch while source truthiness stays the same, even
if the underlying value changes. Function components in the inactive VNode are
not executed until that branch mounts.

`Show` offers the JSX form, `<Show when={live} fallback={fallback}>{children}</Show>`.

</details>

<details><summary><b><code>LiveValue.render</code></b> <em>(value-dependent branches)</em></summary>
<br>

`.render(project, { key }?)` updates a local DOM branch when a live value changes.

```tsx
{$.authorized.render((authorized) =>
  authorized ? <Profile /> : <Login />
)}
```

When the live value changes, the region disposes the old branch and mounts
the selected branch. Map to the condition to retain it while the result stays
the same.

```tsx
const positive = $.count.map((count) => count >= 0);

{positive.render((isPositive) =>
  isPositive ? <Positive /> : <Negative />
)}
```

You can also keep the branch by passing a structural key.

```tsx
{$.count.render(
  (count) => count >= 0 ? <Positive /> : <Negative />,
  { key: (count) => count >= 0 }
)}
```

The project function runs again only when the key changes. Bind changing values
inside a retained branch separately instead of deriving them from a skipped
project call.

</details>

<details><summary><b><code>LiveValue.each</code></b> <em>(keyed collections)</em></summary>
<br>

Use `.each(key, project)` to render an array into a keyed DOM region.

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

Use `$field(key)` for field names that overlap a `LiveValue` method.

```tsx
{$item.$field("get")}
```

</details>

<details><summary><b><code>list</code></b> <em>(typed list operations)</em></summary>
<br>

Use `app.list(key)` for arrays declared in `createApp({ state })`. A lazy
store exposes the same typed `list(key)` helper inside its action factory.

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
longest-increasing-subsequence pass to minimize DOM moves.

</details>

###### **— ERRORS —**

<details><summary><b><code>ErrorBoundary</code></b> <em>(local recovery)</em></summary>
<br>

`ErrorBoundary` owns its rendered subtree and replaces it locally when initial
rendering or a scheduled binding or structural update throws.

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
Handle exceptions from event handlers and asynchronous callbacks at the call site.

</details>

<details><summary><b><code>RendererOptions / NexusDOMError</code></b> <em>(scheduling and diagnostics)</em></summary>
<br>

Use `schedule: "animationFrame"` to batch visual work before paint, or
`schedule: "manual"` to run queued work through `root.flush()`.
The default is `"microtask"`.

```tsx
app.render(<CanvasView />, "#app", { schedule: "animationFrame" });
```

Scheduled binding or structural errors can be observed without aborting the
remaining bindings in the same commit.

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
a stable code.

```text
nexus-dom: [RENDER_TARGET_NOT_FOUND]
Render target "#app" was not found.
```

They are instances of the exported `NexusDOMError`. Exceptions thrown by user
components or callbacks keep their original type and message, so the renderer
does not mislabel application failures as library failures.

`onCommit({ updates, contexts })` reports completed jobs and their Nexus update
contexts.

</details>

</details>

<details><summary><b><code>nexus-dom/server</code></b></summary>
<br>

<details><summary><b><code>renderToString / hydrate</code></b> <em>(HTML and client adoption)</em></summary>
<br>

The synchronous server entry renders current state without a browser DOM.
Enable hydration markers when the client will reuse that markup.

```tsx
import { renderToString } from "nexus-dom/server";

const html = renderToString(<Field />, {
  hydration: true,
  idPrefix: "account",
});

// In the browser, after the server HTML is in target:
app.hydrate(<Field />, target, { idPrefix: "account" });
```

Elements, fragments, components, standalone store views, keyed lists, dynamic
regions, error boundaries and current `LiveValue` values are supported. Lazy
stores are isolated for each call, and `setup` is skipped because browser
resources such as sockets and DOM refs are not server-safe by default. Passing
the same explicit `idPrefix` to `renderToString` and `app.hydrate` produces the
same component IDs for the same initial tree.

When hydration resolves lazy stores, the server appends one versioned
`<!--nxs:s...-->` JSON payload to the root. `app.hydrate(...)` restores those
stores before their client `setup` functions run and removes the payload.
Stores are matched in deterministic lazy-resolution order and guarded by their
exact top-level key shape, so server and client must render the same view build.
State transfer accepts finite JSON values, arrays and plain objects.
`Date`, `Map`, `Set`, functions, `undefined`, `BigInt`, cycles and custom class
instances require an application-level serialization policy. Refs and setup
resources are intentionally never serialized. A store's `mount` runs after
DOM adoption, so it can load local preferences without changing the
state used to match server HTML.

Hydration reuses stable elements and text, then attaches live text/property
subscriptions, events, refs and tracked store-view reconciliation. Dynamic and
`when(...)` branches, keyed multi-node/empty rows and error-boundary fallbacks
are accepted into their normal ownership model, so later updates use the same
cleanup and reconciliation paths as a client mount.

Reactive text uses short paired comments in the server response; hydration
removes them after creating or adopting the concrete text node. Other
structural regions need no server markers because the expected VNode traversal
provides their boundaries. A tag/text mismatch produces `HYDRATION_MISMATCH`,
disposes partial client behavior, reports the error through `onError` and
replaces the complete root using the same `idPrefix` and restored store values.

</details>

</details>

<h2></h2>

### Recipes

<details><summary><b>Read plain state in a component</b></summary>
<br>

Use `component` to render a branch from ordinary state reads. In a flat
component scope, the renderer tracks the top-level keys the callback reads.

```tsx
const Inspector = component(
  ({ state, acts, refs }) => {
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
  },
  [issuesStore]
);
```

The callback reruns through the renderer scheduler only when a state key it
read changes. Dependency sets can change between runs. `$` remains available
for direct text/property bindings and `.each(...)` remains the keyed collection
path, so one region can mix ordinary expressions with fine-grained updates.
Reading `acts` or `refs` does not subscribe the view.

For a stable local shape made of ordinary DOM elements, text and the same
`LiveValue` instances, the renderer patches text, properties, events and refs
in place. Element identity, focus and uncontrolled DOM state survive these
updates. A changed element type, key or child shape — or a component, keyed or
dynamic subtree at the reconciliation boundary — falls back to atomic owned
branch replacement. Reconciliation is positional and limited to this local
DOM shape. Update errors follow owner cleanup and local `ErrorBoundary`
propagation.

Refs can use a callback or a store's object cells.

```tsx
<input ref={refs.search} />
```

</details>

<details><summary><b>Choose between <code>state</code> and <code>$</code></b></summary>
<br>

| Read | Result | What updates |
| --- | --- | --- |
| `state.count` | Plain value | The component reruns when the observed key changes in a flat scope |
| `state.preferences.theme` | Plain value | The component reruns when the observed store changes in a named scope |
| `$.count` or `$.preferences.theme` | Live value | Each attached binding updates directly |

Use `state` for ordinary expressions or grouped changes. Use `$` for
frequently changing text, properties and keyed collections. The writable
bindings and named actions update the same store. Refs hold mutable runtime
resources such as DOM nodes without subscribing the component.

</details>

<h2></h2>

### Security

Use application-owned JSX templates and pass untrusted text as children
of ordinary elements. The browser writes text nodes and the server escapes
text and attribute values.

The renderer rejects `innerHTML`, `outerHTML`, `srcdoc` and
`dangerouslySetInnerHTML`. Use function handlers such as `onClick` for
events. The browser and server reject inline event attributes such as `onclick`.

The URL check covers `href`, `src`, `action`, `formAction`, `poster`,
SVG `xlink:href` and `data` on `object` elements. These accept relative
URLs and the `http:`, `https:`, `mailto:` and `tel:` schemes. A rejected
live update leaves the previous URL in place and follows the renderer's
error handling path.

Apply your own origin and resource rules before binding untrusted URLs.
Keep arbitrary property maps, CSS, executable element content and markup
from untrusted sources outside your templates. Hydrate HTML generated from
trusted templates and state.

Hydration sends lazy-store snapshots to the browser in the HTML. Treat
that state as public to the recipient and keep credentials and server-only
data outside those stores. Authorize actions on your server and treat state
received from the client as untrusted.

<h2></h2>

### Development

Run `npm run dev` from a checkout to open the issue-triage playground.

<details><summary><b>Build and browser checks</b></summary>
<br>

```bash
npm install
npm run dev
npm run check
npm run smoke:package
npm run smoke:dogfood
npm run smoke:dogfood:ssr
```

`npm run build` uses Rollup to produce Terser-minified ESM and CJS graphs for
the main entry, both JSX runtimes and the server entry. Declarations are emitted
for ESM and CommonJS, and `npm run smoke:dist` loads every built runtime
entry in both module formats.

`npm run smoke:dogfood` builds the playground and checks filtering, editing,
keyed moves, focus and persisted preferences in Chromium. Set `CHROME_PATH`
to use a specific browser executable.

`npm run smoke:dogfood:ssr` serves the same workspace through Vite's SSR
loader. It checks that hydration adopts the server DOM, keeps the focused
search input and applies persisted preferences after hydration. Set
`NEXUS_DOM_BROWSER` to `firefox` or `webkit` to run with those browsers.

</details>

<details><summary><b>Benchmarks</b></summary>
<br>

| Command | What it measures |
| --- | --- |
| `npm run benchmark` | jsdom microbenchmarks for writes, bindings and subtree rebuilds |
| `npm run benchmark:browser` | Keyed updates and reorders, forced layout and disposal |
| `npm run benchmark:compare:matrix` | Production builds against React, Solid and Preact Signals in Chromium, Firefox and WebKit |
| `npm run benchmark:compare:mobile` | The Chromium comparison with 4× CPU throttling |
| `npm run benchmark:heap` | Retained allocations per keyed row in Chromium |
| `npm run benchmark:density` | Sparse and dense updates through `$` and `state` |
| `npm run benchmark:selector-selection` | Field-level selector tracking in namespaced stores |
| `npm run benchmark:bundle` | Tree-shaken ESM entry sizes before and after gzip |

The browser comparison checks keyed order, DOM identity and focus before
timing. Heap runs measure retained JavaScript objects. CPU throttling covers
a slower CPU workload on the host machine. See
[project measurements](https://github.com/voodoofugu/nexus-dom/blob/main/PROJECT.md#benchmark-policy)
for sample counts, hardware-specific results and caveats.

</details>

<h2></h2>

### License

[MIT](./LICENSE)
