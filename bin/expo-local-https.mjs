import { createServer } from 'node:https';
import { request } from 'node:http';
import { appendFile, readFile, stat, rename } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Local test transport only. Keep the API/database process separate, and never
// bind a public interface or disable certificate verification in clients.
const root = resolve(process.env.AFIRE_EXPO_ROOT || 'frontend/dist');
const certRoot = resolve('frontend/.expo/local-https');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
function upstream(req) {
  return request({ hostname: '127.0.0.1', port: 4000, method: req.method, path: req.url,
    headers: { ...req.headers, host: 'localhost:4000', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'localhost:8443' } });
}
const server = createServer({
  cert: await readFile(resolve(certRoot, 'localhost.pem')),
  key: await readFile(resolve(certRoot, 'localhost-key.pem')),
}, async (req, res) => {
  if (req.url === '/api/client-build' && ['GET', 'HEAD'].includes(req.method)) {
    const metadata = await readFile(resolve(root, 'client-build.json'), 'utf8').then(JSON.parse).catch(() => null);
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store, max-age=0' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ buildId: metadata?.buildId ?? null, checkedAt: Date.now() }));
    return;
  }
  if (req.url?.startsWith('/api/') || req.url?.startsWith('/socket.io/')) {
    const started = performance.now();
    // A local control file can stall only paginated history, leaving live reads,
    // sends and sockets untouched. Disabled unless explicitly configured.
    const historyControl = process.env.AFIRE_HISTORY_DELAY_FILE;
    if (historyControl && req.method === 'GET' && /\/chat\/messages\?before=/.test(req.url)) {
      const milliseconds = Number(await readFile(historyControl, 'utf8').catch(() => '0'));
      if (Number.isFinite(milliseconds) && milliseconds > 0) await delay(Math.min(milliseconds, 12000));
    }
    // Opt-in local benchmark evidence: never record headers, tokens or bodies.
    const auditPath = process.env.AFIRE_HTTPS_AUDIT;
    if (auditPath && req.url?.startsWith('/api/v2/rooms')) {
      res.once('finish', () => {
        void appendFile(auditPath, JSON.stringify({ at: new Date().toISOString(), method: req.method,
          path: req.url, status: res.statusCode, durationMs: Math.round(performance.now() - started) }) + '\n').catch(error => console.error('Cannot write benchmark evidence:', error.message));
      });
    }
    // Explicit one-shot faults for isolated Chat, Note and Wall recovery tests.
    // Claim the file atomically; auth and arbitrary routes are never eligible.
    let fault;
    const faultFile = process.env.AFIRE_CHAT_FAULT_FILE;
    const chatFault = req.method === 'POST' && (req.url === '/api/v1/uploads' || /^\/api\/v2\/rooms\/\d+\/chat\/messages$/.test(req.url));
    const noteFault = ['GET', 'PATCH'].includes(req.method) && /^\/api\/v2\/notes\/[1-9]\d*$/.test(req.url)
      || req.method === 'PUT' && /^\/api\/v2\/notes\/[1-9]\d*\/content$/.test(req.url);
    const wallFault = req.method === 'POST' && /^\/api\/v1\/walls\/[1-9]\d*\/presentation$/.test(req.url);
    if (faultFile && (chatFault || noteFault || wallFault)) {
      try {
        const configured = JSON.parse(await readFile(faultFile, 'utf8'));
        if ((configured.method || 'POST') === req.method && configured.path === req.url && ['reject-before', 'drop-after'].includes(configured.mode)) {
          await rename(faultFile, `${faultFile}.consumed`);
          fault = configured.mode;
        }
      } catch { /* No fault armed. */ }
    }
    const failedAcknowledgement = () => { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: 'Synthetic connection interruption. Retry this message.' })); };
    if (fault === 'reject-before') { req.resume(); failedAcknowledgement(); return; }
    const proxy = upstream(req);
    proxy.on('response', response => {
      if (fault === 'drop-after') { response.resume(); response.on('end', failedAcknowledgement); return; }
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Local test API unavailable'); });
    req.on('aborted', () => proxy.destroy());
    req.pipe(proxy);
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'https://localhost:8443').pathname);
    const assetRoot = root;
    let file = resolve(assetRoot, `.${pathname}`);
    if (file !== assetRoot && !file.startsWith(assetRoot + sep)) { res.writeHead(403); res.end(); return; }
    if (!(await stat(file).catch(() => null))?.isFile()) {
      if (pathname !== '/' && !/^\/(?:app|auth)(?:\/|$)/.test(pathname)) { res.writeHead(404); res.end('Not found'); return; }
      file = resolve(root, 'index.html');
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404); res.end('Export the Expo web app first.'); }
});
server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/socket.io/')) { socket.destroy(); return; }
  const proxy = upstream(req);
  proxy.on('upgrade', (response, remote, remoteHead) => {
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
    if (head.length) remote.write(head);
    if (remoteHead.length) socket.write(remoteHead);
    remote.on('error', () => socket.destroy());
    socket.on('error', () => remote.destroy());
    socket.on('close', () => remote.destroy());
    remote.pipe(socket).pipe(remote);
  });
  proxy.on('response', () => socket.destroy());
  proxy.on('error', () => socket.destroy());
  proxy.end();
});
server.listen(8443, '127.0.0.1', () => console.log('Local Expo export + test API: https://localhost:8443 (API upstream localhost:4000)'));
