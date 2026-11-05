import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

// Exercise production owners in independent browser realms, sharing real localStorage/Web Locks.
const bundle = await build({
  stdin: { contents: `
    import { SessionTransport } from './frontend/src/lib/api/transport';
    import { sessionStorage } from './frontend/src/lib/sessionStorage.web';
    window.client = new SessionTransport(location.origin, sessionStorage);
    window.client.observeExternalSession();
    window.storage = sessionStorage;
  `, resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'browser', format: 'iife',
});
const tokens = revision => ({ accessToken: `header.${Buffer.from(JSON.stringify({ sub: '123', exp: 1, revision })).toString('base64url')}.signature`, refreshToken: revision });
let rotations = 0;
let releaseRefresh;
let refreshStarted;
const started = new Promise(resolve => { refreshStarted = resolve; });
const release = new Promise(resolve => { releaseRefresh = resolve; });
const server = createServer(async (request, response) => {
  if (request.url === '/client.js') {
    response.setHeader('content-type', 'application/javascript');
    response.end(bundle.outputFiles[0].text);
  } else if (request.url === '/v1/auth/refresh') {
    rotations++;
    refreshStarted();
    await release;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(tokens('successor')));
  } else {
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><script src="/client.js"></script>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  await Promise.all(pages.map(page => page.goto(`http://127.0.0.1:${server.address().port}`)));
  await pages[0].evaluate(value => window.client.setSession(value), tokens('original'));
  // Wait for the other realm's initial sign-in event before starting requests.
  await pages[1].waitForFunction(() => localStorage.getItem('afire.preview.session')?.includes('original'));
  const first = pages[0].evaluate(() => window.client.getAccessToken());
  await started;
  const second = pages[1].evaluate(() => window.client.getAccessToken());
  await pages[1].waitForFunction(async () => (await navigator.locks.query()).pending.length === 1);
  releaseRefresh();
  assert.deepEqual(await Promise.all([first, second]), [tokens('successor').accessToken, tokens('successor').accessToken]);
  assert.equal(rotations, 1);
  await pages[0].evaluate(() => window.client.setSession(null));
  await pages[1].waitForFunction(() => localStorage.getItem('afire.preview.session') === null);
  assert.equal(await pages[1].evaluate(() => window.client.getAccessToken()), null);
  console.log('PASS: two browser realms, one refresh rotation, shared successor, cross-tab logout.');
} finally {
  releaseRefresh();
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
