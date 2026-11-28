import assert from "node:assert/strict";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright-core";
import { build, preview } from "vite";

export async function smokePackageBrowser(directory) {
  await mkdir(join(directory, "src"));
  for (const file of ["crash.html", "src/crash.tsx"]) {
    await copyFile(new URL(`../example/${file}`, import.meta.url), join(directory, file));
  }
  const config = {
    configFile: false,
    root: directory,
    oxc: { jsx: { runtime: "automatic", importSource: "nexus-dom" } },
    build: { rolldownOptions: { input: join(directory, "crash.html") } },
  };
  await build(config);

  const browserName = process.env.NEXUS_DOM_BROWSER ?? "chromium";
  const engine = { chromium, firefox, webkit }[browserName];
  assert.ok(engine, `Unknown browser: ${browserName}`);
  const browser = await engine.launch();
  try {
    const server = await preview({ ...config, preview: { host: "127.0.0.1", port: 0 } });
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(5_000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error));
      const url = new URL("crash.html", server.resolvedUrls.local[0]);
      assert.ok((await page.goto(url.href))?.ok());

      const draft = page.getByRole("textbox", { name: "Draft" });
      await draft.fill("Uncontrolled draft");
      const original = await draft.elementHandle();
      assert.ok(original);
      await page.locator("#move").evaluate((button) => button.click());
      await page.waitForFunction(() => document.querySelector("li")?.dataset.task === "2");
      assert.ok(await draft.evaluate((node, before) => node === before, original));
      assert.equal(await draft.inputValue(), "Uncontrolled draft");
      assert.ok(await draft.evaluate((node) => node === document.activeElement));
      await original.dispose();

      await page.getByRole("button", { name: "Break editor" }).click();
      const alert = page.getByRole("alert").filter({ hasText: "Editor render failed" });
      await alert.waitFor();
      assert.equal(await page.locator("li").count(), 0);
      await alert.getByRole("button", { name: "Reset editor" }).click();
      await draft.waitFor();
      assert.equal(await page.locator("li").first().getAttribute("data-task"), "2");

      await page.getByRole("button", { name: "Summary", exact: true }).click();
      await page.locator('[data-first="2"]').filter({ hasText: "Tasks: 2" }).waitFor();
      assert.equal(await page.locator("#cleanups").textContent(), "1");

      await page.goBack();
      await page.getByRole("heading", { name: "Task editor" }).waitFor();
      assert.equal(await page.locator("li").first().getAttribute("data-task"), "2");

      await page.getByRole("button", { name: "Dispose application" }).click();
      assert.equal(await page.locator("#app").textContent(), "");
      assert.equal(await page.locator("#cleanups").textContent(), "2");
      assert.deepEqual(errors, []);
      console.log(`smoke: packaged app passed keyed moves, error recovery, history and cleanup in ${browserName}`);
    } finally {
      await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
    }
  } finally {
    await browser.close();
  }
}
