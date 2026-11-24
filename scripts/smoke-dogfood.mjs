import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright-core";
import { createServer, preview } from "vite";

const executablePath = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((path) => path && existsSync(path));

const ssr = process.argv.includes("--ssr");
const browserName = process.env.NEXUS_DOM_BROWSER ?? "chromium";
const browserType = { chromium, firefox, webkit }[browserName];
assert.ok(browserType, `Unknown browser: ${browserName}`);
const configFile = fileURLToPath(new URL("../example/vite.config.ts", import.meta.url));
const browser = await browserType.launch(browserName === "chromium" ? { executablePath } : {});
try {
  const server = ssr
    ? await createServer({
        configFile,
        server: { host: "127.0.0.1", port: 0 },
        plugins: [{
          name: "dogfood-ssr-smoke",
          configureServer(server) {
            server.middlewares.use(async (request, response, next) => {
              if (request.url !== "/") return next();
              try {
                const template = await readFile(new URL("../example/index.html", import.meta.url), "utf8");
                const { renderWorkspace } = await server.ssrLoadModule("/src/server.tsx");
                const html = template.replace("<div id=\"app\"></div>", () =>
                  `<div id="app" data-ssr>${renderWorkspace()}</div>
                  <script>
                    window.serverShell = document.querySelector("#app > main");
                    window.serverRow = document.querySelector(".issue-list > li");
                    window.serverSearch = document.querySelector('input[type="search"]');
                    window.serverSearch.focus();
                  </script>`
                );
                response.setHeader("Content-Type", "text/html; charset=utf-8");
                response.end(await server.transformIndexHtml("/", html));
              } catch (error) {
                next(error);
              }
            });
          },
        }],
      })
    : await preview({ configFile, preview: { host: "127.0.0.1", port: 0 } });
  try {
    if ("listen" in server) await server.listen();
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error));
    const response = await page.goto(server.resolvedUrls.local[0]);
    assert.ok(response?.ok());

    const rows = page.locator(".issue-list > li");
    const inspector = page.locator(".inspector");
    const search = page.getByRole("searchbox", { name: "Search issues" });
    const assertHydrated = async () => {
      assert.equal(await page.evaluate(() => Boolean(
        window.serverShell &&
        window.serverShell === document.querySelector("#app > main") &&
        window.serverRow === document.querySelector(".issue-list > li") &&
        window.serverSearch === document.activeElement &&
        !Array.from(document.querySelector("#app").childNodes).some(
          (node) => node.nodeType === 8 && node.nodeValue.startsWith("nxs:s")
        )
      )), true, "Hydration should reuse the server shell and rows and keep focus");
    };
    if (ssr) await assertHydrated();
    const issue = page.getByRole("button", { name: /ND-19/ });
    const original = await issue.elementHandle();
    assert.ok(original);
    await page.getByRole("button", { name: "In progress", exact: true }).first().click();
    assert.equal(await rows.count(), 2);
    assert.equal(await issue.evaluate((node, previous) => node === previous, original), true);
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
    await search.fill("Follow a commit");
    assert.equal(await rows.count(), 1);
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
    if (ssr) await assertHydrated();
    assert.equal(await rows.count(), 5);
    assert.deepEqual(errors, []);
    console.log(`${browserName} dogfood (${ssr ? "SSR" : "client"}): filtering, editing, keyed moves, focus and persistence passed`);
  } finally {
    await server.close();
  }
} finally {
  await browser.close();
}
