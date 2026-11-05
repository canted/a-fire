#!/usr/bin/env node
// Profile the actual Home -> Room interaction against the isolated Lighthouse stack.
// Run from its worktree; reports contain synthetic fixture data only.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const fixture = JSON.parse(await readFile('tmp/lighthouse/fixture.json', 'utf8'));
const base = new URL(fixture.baseUrl);
if (base.origin !== 'http://127.0.0.1:4300') throw Error('Requires the isolated local fixture server.');
const phase = process.env.AUDIT_PHASE ?? 'baseline';
if (!/^[a-z0-9-]+$/.test(phase)) throw Error('Invalid phase');
const out = `tests/e2e/reports/room-performance/${phase}`;
await mkdir(out, { recursive: true });
let session;
try { session = JSON.parse(await readFile('tmp/lighthouse/session.json', 'utf8')); } catch {
  const response = await fetch(new URL('/api/v1/auth/verify_otp', base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: fixture.login.email, token: fixture.login.otp }) });
  if (!response.ok) throw Error(`Fixture login failed: ${response.status}`);
  session = await response.json();
  await writeFile('tmp/lighthouse/session.json', JSON.stringify(session), { mode: 0o600 });
}
// Dismiss seeded walls through the real API before timing, so they cannot
// cover Chat. This changes presentation state only in the synthetic fixture.
const roomPath = fixture.routes.find(route => route.id === 'chat').path;
const roomId = roomPath.match(/circles\/(\d+)/)[1];
const headers = { Authorization: `Bearer ${session.accessToken}` };
const wallsResponse = await fetch(new URL(`/api/v1/rooms/${roomId}/walls`, base), { headers });
if (!wallsResponse.ok) throw Error(`Fixture walls failed: ${wallsResponse.status}`);
for (const wall of (await wallsResponse.json()).walls) {
  if (wall.presented) continue;
  const response = await fetch(new URL(`/api/v1/walls/${wall.id}/presentation`, base), { method: 'POST', headers });
  if (!response.ok) throw Error(`Fixture wall dismissal failed: ${response.status}`);
}
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const device of ['desktop', 'mobile']) for (let run = 1; run <= Number(process.env.AUDIT_RUNS ?? 3); run++) {
    const context = await browser.newContext({ viewport: device === 'mobile' ? { width: 390, height: 844 } : { width: 1350, height: 940 }, serviceWorkers: 'block' });
    await context.addInitScript(tokens => { localStorage.setItem('accessToken', tokens.accessToken); localStorage.setItem('refreshToken', tokens.refreshToken); }, session);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: device === 'mobile' ? 4 : 1 });
    await page.goto(new URL('/app', base).href, { waitUntil: 'networkidle' });
    const room = fixture.routes.find(route => route.id === 'chat').path.replace(/\/chat$/, '');
    const link = page.locator(`a[href="${room}"]`).first();
    await link.waitFor();
    await link.scrollIntoViewIfNeeded();
    await cdp.send('Performance.enable');
    const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    if (run === 1) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
    await page.evaluate(href => {
      window.roomPerf = { start: performance.now(), longTasks: [], ready: null };
      new PerformanceObserver(list => window.roomPerf.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask' });
      const observer = new MutationObserver(() => {
        const rows = document.querySelectorAll('article[id^="chat-"]');
        if (rows.length && !window.roomPerf.ready) requestAnimationFrame(() => requestAnimationFrame(() => { window.roomPerf.ready ??= performance.now(); observer.disconnect(); }));
      });
      observer.observe(document.body, { subtree: true, childList: true });
      document.querySelector(`a[href="${href}"]`).click();
    }, room);
    await page.waitForFunction(() => window.roomPerf.ready !== null, null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    if (run === 1) await writeFile(`${out}/${device}.cpuprofile`, JSON.stringify((await cdp.send('Profiler.stop')).profile));
    const metrics = await page.evaluate(() => ({ readyMs: window.roomPerf.ready - window.roomPerf.start, longTasks: window.roomPerf.longTasks, mountedMessages: document.querySelectorAll('article[id^="chat-"]').length, mountedEditors: [...document.querySelectorAll('.tiptap')].filter(e => e.editor).length, domNodes: document.querySelectorAll('*').length, requests: performance.getEntriesByType('resource').filter(e => e.startTime >= window.roomPerf.start && e.name.includes('/api/')).map(e => ({ path: new URL(e.name).pathname + new URL(e.name).search, duration: e.duration })) }));
    const result = { device, run, ...metrics, cpu: Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].map(k => [k, (after[k] - before[k]) * 1000])), errors };
    results.push(result);
    console.log(JSON.stringify(result));
    if (run === 1) await page.screenshot({ path: `${out}/${device}.png` });
    if (process.env.AUDIT_VERIFY === '1' && run === 1) {
      const scroller = page.getByRole('main', { name: /chat messages/ });
      await scroller.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
      await page.waitForFunction(() => document.querySelectorAll('article[id^="chat-"]').length >= 70);
      await page.waitForTimeout(500);
      assert.equal(await page.locator('[data-content-image] img').count() > 0, true, 'Historical image uses the canonical media renderer');
      await scroller.evaluate(element => { element.scrollTop = 400; element.dispatchEvent(new Event('scroll')); });
      await page.waitForTimeout(200);
      const anchor = await scroller.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const row = [...element.querySelectorAll('article[id^="chat-"]')].find(row => row.getBoundingClientRect().bottom > bounds.top && row.getBoundingClientRect().top < bounds.bottom);
        return { id: row.id, offset: row.getBoundingClientRect().top - bounds.top };
      });
      await page.getByRole('button', { name: 'Back to home', exact: true }).click();
      await page.locator(`a[href="${room}"]`).first().click();
      await page.locator(`#${anchor.id}`).waitFor();
      await page.waitForTimeout(600);
      const offset = await scroller.evaluate((element, id) => element.querySelector(`#${id}`).getBoundingClientRect().top - element.getBoundingClientRect().top, anchor.id);
      assert.ok(Math.abs(offset - anchor.offset) < 3, 'Reading position survives Home -> Room return');
      const composer = page.locator('[contenteditable="true"]').last();
      await composer.fill('Unsent performance verification');
      assert.ok(await page.locator('article[id^="chat-"]').count() >= 70);
      await composer.fill('');
      await page.getByRole('button', { name: 'Scroll to bottom', exact: true }).click();
      await page.waitForTimeout(200);
      assert.ok(await scroller.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop < 2), 'Latest message is reachable');
      result.verification = { history: await page.locator('article[id^="chat-"]').count(), media: true, restoredAnchor: true, composer: true, latest: true };
      console.log(`Verified ${device}: older history, media, reading position, composer, latest`);
    }
    assert.deepEqual(errors, [], 'No browser errors');
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
