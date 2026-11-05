import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// Exercise the running catalog, including every story's own play assertions.
// This uses Storybook 10's installed preview/channel lifecycle, not fixed sleeps.
const baseUrl = process.env.STORYBOOK_URL || "http://127.0.0.1:6007";
const output = process.env.STORYBOOK_SMOKE_OUTPUT || "tmp/storybook-smoke.json";
const filter = process.env.STORYBOOK_SMOKE_FILTER;
const index = await fetch(`${baseUrl}/index.json`).then(response => {
  if (!response.ok) throw new Error(`Story index returned ${response.status}`);
  return response.json();
});
const stories = Object.values(index.entries).filter(entry => entry.type === "story" && (!filter || new RegExp(filter).test(entry.id)));
if (!stories.length) throw new Error("No indexed stories matched the smoke check");
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const results = [];
try {
  for (const story of stories) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      try { localStorage.clear(); sessionStorage.clear(); } catch { /* The initial blank document has no origin. */ }
      window.__catalogSmoke = { finished: null, failures: [] };
      const timer = setInterval(() => {
        const channel = window.__STORYBOOK_ADDONS_CHANNEL__ || window.__STORYBOOK_PREVIEW__?.channel;
        if (!channel?.on) return;
        clearInterval(timer);
        channel.on("storyFinished", payload => { window.__catalogSmoke.finished = payload; });
        for (const event of ["storyThrewException", "storyErrored", "playFunctionThrewException", "unhandledErrorsWhilePlaying"]) {
          channel.on(event, payload => window.__catalogSmoke.failures.push({ event, message: payload?.message || JSON.stringify(payload) }));
        }
      }, 10);
    });
    let result;
    try {
      await page.goto(`${baseUrl}/iframe.html?id=${story.id}&viewMode=story`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForFunction(() => window.__catalogSmoke?.finished || window.__STORYBOOK_PREVIEW__?.currentRender?.phase === "finished" || document.body.classList.contains("sb-show-errordisplay"), null, { timeout: 45_000 });
      const state = await page.evaluate(() => ({
        finished: window.__catalogSmoke.finished ? { storyId: window.__catalogSmoke.finished.storyId, status: window.__catalogSmoke.finished.status } : null,
        failures: window.__catalogSmoke.failures,
        phase: window.__STORYBOOK_PREVIEW__?.currentRender?.phase,
        errorDisplay: document.body.classList.contains("sb-show-errordisplay") ? document.querySelector(".sb-errordisplay")?.textContent : null,
        rendered: Boolean(document.querySelector("#storybook-root")?.childElementCount || document.querySelector('[role="dialog"]')),
      }));
      const passed = !errors.length && !state.failures.length && !state.errorDisplay && state.finished?.status !== "error" && state.rendered;
      result = { id: story.id, title: story.title, name: story.name, passed, errors, ...state };
    } catch (error) {
      result = { id: story.id, title: story.title, name: story.name, passed: false, errors: [...errors, error.message] };
    }
    results.push(result);
    process.stdout.write(`${result.passed ? "PASS" : "FAIL"} ${story.id}\n`);
    await page.close();
  }
} finally {
  await browser.close();
  await mkdir(output.slice(0, output.lastIndexOf("/")) || ".", { recursive: true });
  await writeFile(output, `${JSON.stringify({ baseUrl, total: stories.length, passed: results.filter(result => result.passed).length, results }, null, 2)}\n`);
}
if (results.some(result => !result.passed)) process.exitCode = 1;
