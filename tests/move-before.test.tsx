/** @jsxImportSource nexus-dom */
import { describe, expect, it, vi } from "vitest";
import { createApp } from "nexus-dom";

describe("state-preserving keyed moves", () => {
  it("uses moveBefore when the browser supports it", () => {
    const app = createApp({
      state: {
        items: [
          { id: 1, label: "First" },
          { id: 2, label: "Second" },
          { id: 3, label: "Third" },
        ],
      },
    });
    const host = document.createElement("div") as HTMLDivElement & {
      moveBefore(node: Node, reference: Node | null): void;
    };
    const moveBefore = vi.fn((node: Node, reference: Node | null) => {
      host.insertBefore(node, reference);
    });
    host.moveBefore = moveBefore;
    const root = app.render(
      app.$.items.each(
        (item) => item.id,
        ($item) => <span data-id={$item.id}>{$item.label}</span>
      ),
      host,
      { schedule: "manual" }
    );

    app.list("items").move(2, 0);
    root.flush();

    expect(moveBefore).toHaveBeenCalled();
    expect(
      Array.from(host.querySelectorAll("span"), (node) => node.dataset.id)
    ).toEqual(["3", "1", "2"]);
  });
});
