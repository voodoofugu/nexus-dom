/** @jsxImportSource nexus-dom */
import { createNexus, type UpdateContext } from "nexus-state";
import { bind, createDOMRenderer } from "nexus-dom";
import "./style.css";

const counter = createNexus({
  state: {
    count: 0,
    step: 1,
    enabled: true,
  },
  acts: (get, set) => ({
    increment() {
      set({ count: get("count") + get("step") });
    },
    decrement() {
      set({ count: get("count") - get("step") });
    },
    reset() {
      set({ count: 0 });
    },
    toggle() {
      set({ enabled: !get("enabled") });
    },
  }),
});

const $ = bind(counter);
const doubled = $.count.map((count) => count * 2);
const parity = $.count.map((count) => (count % 2 === 0 ? "even" : "odd"));
const positive = $.count.map((count) => count >= 0);

let appExecutions = 0;
let commitCount = 0;
let commitValue: HTMLOutputElement | null = null;
let history: HTMLOListElement | null = null;
let surface: HTMLElement | null = null;

const renderer = createDOMRenderer<UpdateContext>({
  onCommit(event) {
    commitCount++;
    if (commitValue) commitValue.value = String(commitCount);

    const source = event.contexts.at(-1)?.source ?? "manual";
    if (history) {
      const entry = document.createElement("li");
      entry.textContent = `${source} → ${event.updates} DOM update${
        event.updates === 1 ? "" : "s"
      }`;
      history.prepend(entry);
      while (history.children.length > 8) history.lastElementChild?.remove();
    }

    if (surface) {
      surface.dataset.committed = "true";
      requestAnimationFrame(() => {
        if (surface) delete surface.dataset.committed;
      });
    }
  },
});

function App() {
  appExecutions++;

  return (
    <main class="surface" ref={(node) => (surface = node as HTMLElement | null)}>
      <header>
        <p class="eyebrow">Rendering experiment</p>
        <h1>nexus-dom playground</h1>
        <p class="lede">
          The component mounts once. Live values update individual DOM bindings.
        </p>
      </header>

      <section class="counter-card" aria-label="Counter example">
        <div class="counter-readout">
          <span>Count</span>
          <output class={parity.map((value) => `count count--${value}`)}>
            {$.count}
          </output>
        </div>

        <div class="controls">
          <button
            disabled={$.enabled.map((enabled) => !enabled)}
            onClick={counter.acts.decrement}
          >
            Decrease
          </button>
          <button
            class="primary"
            disabled={$.enabled.map((enabled) => !enabled)}
            onClick={counter.acts.increment}
          >
            Increase
          </button>
          <button onClick={counter.acts.reset}>Reset</button>
        </div>

        <label class="step-control">
          <span>Step</span>
          <input
            type="range"
            min="1"
            max="10"
            value={$.step}
            onInput={(event) => {
              const input = event.currentTarget as HTMLInputElement;
              counter.set({ step: Number(input.value) }, "changeStep");
            }}
          />
          <output>{$.step}</output>
        </label>

        <dl class="derived-grid">
          <div>
            <dt>Doubled</dt>
            <dd>{doubled}</dd>
          </div>
          <div>
            <dt>Parity</dt>
            <dd>{parity}</dd>
          </div>
        </dl>

        {positive.render((isPositive) =>
          isPositive ? (
            <p class="branch branch--positive">Positive branch is mounted</p>
          ) : (
            <p class="branch branch--negative">Negative branch is mounted</p>
          )
        )}

        <button class="toggle" onClick={counter.acts.toggle}>
          Toggle counter controls
        </button>
      </section>

      <aside class="diagnostics">
        <div class="metrics">
          <p>
            <span>App executions</span>
            <output>{appExecutions}</output>
          </p>
          <p>
            <span>DOM commits</span>
            <output
              ref={(node) =>
                (commitValue = node as HTMLOutputElement | null)
              }
            >
              0
            </output>
          </p>
        </div>

        <div>
          <h2>Commit provenance</h2>
          <ol
            class="history"
            ref={(node) => (history = node as HTMLOListElement | null)}
          >
            <li>Waiting for an update</li>
          </ol>
        </div>

        <div class="syntax">
          <h2>Runtime ternary</h2>
          <pre><code>{`{positive.render((isPositive) =>
  isPositive
    ? <Positive />
    : <Negative />
)}`}</code></pre>
        </div>
      </aside>
    </main>
  );
}

const host = document.querySelector("#app");
if (!host) throw new Error("Playground root was not found.");

renderer.mount(<App />, host);
