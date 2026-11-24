import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { preview } from "vite";

const executablePath = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((path) => path && existsSync(path));

const browser = await chromium.launch({ executablePath });
try {
  const server = await preview({
    configFile: fileURLToPath(new URL("../example/vite.config.ts", import.meta.url)),
    preview: { host: "127.0.0.1", port: 0 },
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error));
    await page.goto(server.resolvedUrls.local[0]);

    const rows = page.locator(".issue-list > li");
    const inspector = page.locator(".inspector");
    const search = page.getByRole("searchbox", { name: "Search issues" });
    await page.getByRole("button", { name: "In progress", exact: true }).first().click();
    assert.equal(await rows.count(), 2);

    const issue = page.getByRole("button", { name: /ND-19/ });
    const original = await issue.elementHandle();
    assert.ok(original);
    await issue.click();
    await page.waitForFunction(() => document.activeElement?.matches(".inspector"));

    const title = page.getByRole("textbox", { name: "Rename on blur" });
    await title.fill("Follow a commit back to its action");
    await title.press("Tab");
    await inspector.getByRole("heading", { name: "Follow a commit back to its action" }).waitFor();
    await inspector.getByRole("button", { name: "Move to top" }).click();
    assert.match(await rows.first().innerText(), /ND-19/);
    assert.equal(await rows.first().evaluate((row, node) => row.contains(node), original), true);
    await original.dispose();

    await inspector.getByRole("button", { name: "Close inspector" }).click();
    await inspector.getByRole("button", { name: "Focus search" }).click();
    assert.equal(await search.evaluate((node) => node === document.activeElement), true);
    await search.fill("no matching title");
    await page.getByText("No matching issues").waitFor();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    assert.equal(await search.inputValue(), "");
    assert.equal(await rows.count(), 2);

    await page.getByRole("button", { name: "Compact", exact: true }).click();
    await page.getByRole("button", { name: "Comfortable", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "Comfortable", exact: true }).waitFor();
    assert.equal(await rows.count(), 5);
    assert.deepEqual(errors, []);
    console.log("Chromium dogfood: filtering, editing, keyed moves, focus and persistence passed");
  } finally {
    await server.close();
  }
} finally {
  await browser.close();
}
