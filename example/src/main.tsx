/** @jsxImportSource nexus-dom */
import { createNexus } from "nexus-state";
import { bind, render } from "nexus-dom";
import { createPlaygroundDiagnostics } from "./diagnostics.js";
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
const diagnostics = createPlaygroundDiagnostics();

function App() {
  appExecutions++;

  return (
    <main class="surface" ref={diagnostics.surfaceRef}>
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
          ),
        )}

        <button class="toggle" onClick={counter.acts.toggle}>
          Toggle counter controls
        </button>
      </section>

      <diagnostics.Panel appExecutions={appExecutions} />
    </main>
  );
}

render(<App />, "#app", { onCommit: diagnostics.onCommit });
