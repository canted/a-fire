#!/usr/bin/env node
// Production app audits only. The fixture server and credentials must be local.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { chromium } from '@playwright/test';

const toolsRoot = path.resolve(process.env.LIGHTHOUSE_TOOLS || 'tmp/lighthouse-tools/node_modules');
const { default: lighthouse } = await import(pathToFileURL(path.join(toolsRoot, 'lighthouse/core/index.js')));
const { default: desktopConfig } = await import(pathToFileURL(path.join(toolsRoot, 'lighthouse/core/config/desktop-config.js')));
const { launch } = await import(pathToFileURL(path.join(toolsRoot, 'chrome-launcher/dist/index.js')));
const fixture = JSON.parse(await readFile('tmp/lighthouse/fixture.json', 'utf8'));
const base = new URL(fixture.baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Audits require a loopback fixture server.');
const phase = process.env.AUDIT_PHASE || 'baseline';
if (!/^[a-z0-9-]+$/.test(phase)) throw new Error('Invalid audit phase.');
const filter = process.env.AUDIT_ROUTES?.split(',');
const routes = fixture.routes.filter(route => !filter || filter.includes(route.id));
const devices = (process.env.AUDIT_DEVICES || 'mobile,desktop').split(',');
const runs = Number(process.env.AUDIT_RUNS || 1);
const out = path.resolve('tests/e2e/reports/lighthouse', phase);
await mkdir(out, { recursive: true });
const sessionPath = 'tmp/lighthouse/session.json';
let session;
try { session = JSON.parse(await readFile(sessionPath, 'utf8')); } catch { /* First login uses fixture OTP. */ }
if (!session) {
  const response = await fetch(new URL('/api/v1/auth/verify_otp', base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: fixture.login.email, token: fixture.login.otp }) });
  if (!response.ok) throw new Error(`Local fixture login failed (${response.status}). Rerun the seed command to issue a new OTP.`);
  session = await response.json();
  await writeFile(sessionPath, JSON.stringify(session), { mode: 0o600 });
}
const chrome = await launch({ chromePath: process.env.CHROME_PATH || chromium.executablePath(), chromeFlags: ['--headless=new', '--disable-dev-shm-usage', '--no-first-run'], logLevel: 'silent' });
let browser;
const results = [];
try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`);
  const context = browser.contexts()[0];
  const page = await context.newPage();
  await page.goto(new URL('/auth', base).href);
  await page.evaluate(({ accessToken, refreshToken }) => { localStorage.setItem('accessToken', accessToken); localStorage.setItem('refreshToken', refreshToken); }, session);
  await writeFile(path.join(out, 'environment.json'), JSON.stringify({ phase, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()), chromium: browser.version(), lighthouse: JSON.parse(await readFile(path.join(toolsRoot, 'lighthouse/package.json'), 'utf8')).version, node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, baseUrl: base.href, authentication: 'Real local verify_otp session; localStorage tokens and media auth cookie retained. No auth bypass.', cache: 'Cold HTTP cache, service workers, Cache Storage and IndexedDB before each navigation; localStorage/cookies retained for login.', measurement: 'Lighthouse default simulated mobile throttling and standard desktop preset; serial runs; no request interception or API mocks.' }, null, 2));
  for (const device of devices) {
    if (!['mobile', 'desktop'].includes(device)) throw new Error(`Unknown device ${device}`);
    await page.setViewportSize(device === 'mobile' ? { width: 412, height: 823 } : { width: 1350, height: 940 });
    for (const route of routes) {
      const url = new URL(route.path, base).href;
      if (new URL(url).origin !== base.origin) throw new Error('Route must remain local.');
      const prefix = `${route.id}-${device}`;
      for (let run = 1; run <= runs; run++) {
        const file = path.join(out, `${prefix}-${run}.json`);
        try { await access(file); const previous = JSON.parse(await readFile(file, 'utf8')); if (!previous.runtimeError) { results.push({ route: route.id, device, run, scores: Object.fromEntries(Object.entries(previous.categories).map(([key, value]) => [key, Math.round(value.score * 100)])) }); console.log(`SKIP ${prefix}-${run}`); continue; } } catch { /* Missing report. */ }
        if (run === 1) {
          const errors = [], failedResponses = [];
          const onError = error => errors.push(error.message);
          const onResponse = response => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); };
          page.on('pageerror', onError); page.on('response', onResponse);
          await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
          if (route.expectText) await page.getByText(route.expectText, { exact: false }).first().waitFor({ timeout: 20000 });
          await page.waitForTimeout(1000);
          if (!new URL(page.url()).pathname.startsWith('/app')) throw new Error(`Unauthenticated redirect for ${route.id}: ${page.url()}`);
          const preflight = await page.evaluate(() => ({ title: document.title, url: location.href, text: document.body.innerText.slice(0, 12000), overflow: document.documentElement.scrollWidth > innerWidth, images: [...document.images].map(img => ({ src: img.currentSrc || img.src, alt: img.alt, loaded: img.complete && img.naturalWidth > 0, width: img.naturalWidth, height: img.naturalHeight, displayWidth: img.getBoundingClientRect().width, displayHeight: img.getBoundingClientRect().height, loading: img.loading, visible: img.getBoundingClientRect().top < innerHeight && img.getBoundingClientRect().bottom > 0 })) }));
          await page.screenshot({ path: path.join(out, `${prefix}.png`), fullPage: true });
          await writeFile(path.join(out, `${prefix}-preflight.json`), JSON.stringify({ ...preflight, errors, failedResponses }, null, 2));
          page.off('pageerror', onError); page.off('response', onResponse);
          const broken = preflight.images.filter(img => img.visible && img.displayWidth > 0 && !img.loaded);
          if (errors.length || broken.length || failedResponses.length) console.log(`PREFLIGHT ${prefix}: ${errors.length} page errors, ${broken.length} unloaded visible images, ${failedResponses.length} HTTP errors (see evidence).`);
        }
        await page.goto('about:blank');
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.clearBrowserCache');
        await cdp.send('Storage.clearDataForOrigin', { origin: base.origin, storageTypes: 'service_workers,cache_storage,indexeddb' });
        await cdp.detach();
        console.log(`RUN ${prefix}-${run}`);
        const result = await lighthouse(url, { port: chrome.port, disableStorageReset: true, output: ['json', 'html'], onlyCategories: ['performance', 'accessibility', 'best-practices'], logLevel: 'error' }, device === 'desktop' ? desktopConfig : undefined);
        if (!result) throw new Error(`No Lighthouse result for ${prefix}`);
        await writeFile(file, JSON.stringify(result.lhr, null, 2));
        await writeFile(path.join(out, `${prefix}-${run}.html`), result.report[1]);
        const scores = Object.fromEntries(Object.entries(result.lhr.categories).map(([key, value]) => [key, Math.round(value.score * 100)]));
        results.push({ route: route.id, device, run, scores, runtimeError: result.lhr.runtimeError, warnings: result.lhr.runWarnings });
        await writeFile(path.join(out, 'summary.json'), JSON.stringify(results, null, 2));
        console.log(`DONE ${prefix}-${run} ${JSON.stringify(scores)}`);
        if (result.lhr.runtimeError) throw new Error(JSON.stringify(result.lhr.runtimeError));
      }
    }
  }
} finally {
  // Keep rotated refresh tokens local so a later comparable batch can reuse the session.
  if (browser?.isConnected()) {
    try {
      const page = await browser.contexts()[0].newPage();
      await page.goto(new URL('/api/client-build', base).href);
      const tokens = await page.evaluate(() => ({ accessToken: localStorage.getItem('accessToken'), refreshToken: localStorage.getItem('refreshToken') }));
      if (tokens.accessToken && tokens.refreshToken) await writeFile(sessionPath, JSON.stringify(tokens), { mode: 0o600 });
      await page.close();
    } catch { console.error('Could not retain the local session; run the fixture auth command if login expires.'); }
  }
  await browser?.close();
  await chrome.kill();
}
