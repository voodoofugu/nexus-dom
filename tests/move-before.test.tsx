/** @jsxImportSource nexus-dom */
import { bind } from "nexus-dom/core";
import { createNexus } from "nexus-state";
import { createListHelpers } from "../src/list.js";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "nexus-dom";

describe("state-preserving keyed moves", () => {
  it("uses moveBefore when the browser supports it", () => {
    const app = createApp();
    const nexus = createNexus({
      state: {
        items: [
          { id: 1, label: "First" },
          { id: 2, label: "Second" },
          { id: 3, label: "Third" },
        ],
      },
    });
    const $ = bind(nexus);
    const { list } = createListHelpers(nexus.get, nexus.set);
    const host = document.createElement("div") as HTMLDivElement & {
      moveBefore(node: Node, reference: Node | null): void;
    };
    const moveBefore = vi.fn((node: Node, reference: Node | null) => {
      host.insertBefore(node, reference);
    });
    host.moveBefore = moveBefore;
    const root = app.render(
      $.items.each(
        (item) => item.id,
        ($item) => <span data-id={$item.id}>{$item.label}</span>
      ),
      host,
      { schedule: "manual" }
    );

    list("items").move(2, 0);
    root.flush();

    expect(moveBefore).toHaveBeenCalled();
    expect(
      Array.from(host.querySelectorAll("span"), (node) => node.dataset.id)
    ).toEqual(["3", "1", "2"]);
  });

  it("keeps the active block stationary on the insertBefore fallback", () => {
    const app = createApp();
    const nexus = createNexus({
      state: {
        items: [
          { id: 1, label: "First" },
          { id: 2, label: "Second" },
          { id: 3, label: "Third" },
        ],
      },
    });
    const $ = bind(nexus);
    const { list } = createListHelpers(nexus.get, nexus.set);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = app.render(
      $.items.each(
        (item) => item.id,
        ($item) => (
          <span data-id={$item.id} tabIndex={$item.id.get() === 2 ? 0 : -1}>
            {$item.label}
          </span>
        )
      ),
      host,
      { schedule: "manual" }
    );
    const active = host.querySelector<HTMLElement>('[data-id="2"]')!;
    active.focus();
    const insertBefore = vi.spyOn(host, "insertBefore");

    list("items").reverse();
    root.flush();

    expect(
      Array.from(host.querySelectorAll("span"), (node) => node.dataset.id)
    ).toEqual(["3", "2", "1"]);
    expect(insertBefore.mock.calls.some(([node]) => node === active)).toBe(false);
    expect(document.activeElement).toBe(active);

    insertBefore.mockClear();
    list("items").move(1, 0);
    root.flush();
    expect(
      Array.from(host.querySelectorAll("span"), (node) => node.dataset.id)
    ).toEqual(["2", "3", "1"]);
    expect(insertBefore.mock.calls.some(([node]) => node === active)).toBe(false);
    expect(document.activeElement).toBe(active);

    insertBefore.mockClear();
    list("items").move(0, 2);
    root.flush();
    expect(
      Array.from(host.querySelectorAll("span"), (node) => node.dataset.id)
    ).toEqual(["3", "1", "2"]);
    expect(insertBefore.mock.calls.some(([node]) => node === active)).toBe(false);
    expect(document.activeElement).toBe(active);

    app.dispose();
    host.remove();
  });
});
