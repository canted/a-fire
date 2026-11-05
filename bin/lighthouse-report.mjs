#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('tests/e2e/reports/lighthouse');
const fixture = JSON.parse(await readFile('tmp/lighthouse/fixture.json', 'utf8'));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const categories = ['performance', 'accessibility', 'best-practices'];
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const phases = {};
for (const phase of ['baseline', 'after']) {
  phases[phase] = [];
  for (const filename of (await readdir(path.join(root, phase))).sort()) {
    const match = filename.match(/^(.*)-(mobile|desktop)-(\d+)\.json$/);
    if (!match) continue;
    const report = JSON.parse(await readFile(path.join(root, phase, filename), 'utf8'));
    if (report.runtimeError || Object.values(report.categories).some(category => category.score === null)) throw new Error(`Invalid audit: ${filename}`);
    phases[phase].push({ route: match[1], device: match[2], run: Number(match[3]), filename, report });
  }
}
const rows = [];
for (const route of fixture.routes) for (const device of ['mobile', 'desktop']) {
  const row = { surface: route.id, path: route.path, device };
  for (const phase of ['baseline', 'after']) {
    const samples = phases[phase].filter(sample => sample.route === route.id && sample.device === device);
    if (!samples.length) throw new Error(`Missing ${phase} ${route.id} ${device}`);
    row[phase] = {
      count: samples.length,
      scores: Object.fromEntries(categories.map(category => [category, median(samples.map(sample => Math.round(sample.report.categories[category].score * 100)))])),
      performanceRange: [Math.min(...samples.map(sample => Math.round(sample.report.categories.performance.score * 100))), Math.max(...samples.map(sample => Math.round(sample.report.categories.performance.score * 100)))],
      metrics: Object.fromEntries(['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift'].map(metric => [metric, median(samples.map(sample => sample.report.audits[metric].numericValue))])),
      reports: samples.map(sample => `${phase}/${sample.filename.replace(/\.json$/, '.html')}`),
    };
  }
  rows.push(row);
}
const environment = JSON.parse(await readFile(path.join(root, 'after/environment.json'), 'utf8'));
const failures = [];
for (const sample of phases.after.filter(sample => sample.run === 1)) {
  for (const category of categories) for (const ref of sample.report.categories[category].auditRefs) {
    const audit = sample.report.audits[ref.id];
    if (audit.score !== null && audit.score < 1) failures.push({ surface: sample.route, device: sample.device, category, id: ref.id, title: audit.title, value: audit.displayValue, weight: ref.weight });
  }
}
const entryScripts = Object.fromEntries(['baseline', 'after'].map(phase => {
  const sample = phases[phase].find(item => item.route === 'home' && item.device === 'mobile' && item.run === 1);
  const request = sample.report.audits['network-requests'].details.items.find(item => /\/assets\/index-[^/]+\.js$/.test(item.url));
  return [phase, { url: request.url, transferBytes: request.transferSize, decodedBytes: request.resourceSize }];
}));
const summary = { generatedAt: new Date().toISOString(), environment, counts: fixture.counts, entryScripts, rows, remainingAuditFindings: failures };
await writeFile(path.join(root, 'comparison.json'), JSON.stringify(summary, null, 2));
const csv = [['surface', 'path', 'device', 'baseline_runs', 'after_runs', ...categories.flatMap(category => [`${category}_before`, `${category}_after`]), 'lcp_ms_before', 'lcp_ms_after', 'cls_before', 'cls_after'], ...rows.map(row => [row.surface, row.path, row.device, row.baseline.count, row.after.count, ...categories.flatMap(category => [row.baseline.scores[category], row.after.scores[category]]), row.baseline.metrics['largest-contentful-paint'], row.after.metrics['largest-contentful-paint'], row.baseline.metrics['cumulative-layout-shift'], row.after.metrics['cumulative-layout-shift']])].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
await writeFile(path.join(root, 'comparison.csv'), csv);
const scoreCell = (row, phase) => categories.map(category => row[phase].scores[category]).join(' / ');
const reportLinks = (row, phase) => row[phase].reports.map((url, index) => `<a href="${escape(url)}">${index + 1}</a>`).join(' · ');
const table = rows.map(row => `<tr><th scope="row">${escape(row.surface)}<small>${escape(row.path)}</small></th><td>${row.device}</td><td>${scoreCell(row, 'baseline')}</td><td>${scoreCell(row, 'after')}</td><td>${row.baseline.performanceRange.join('–')} → ${row.after.performanceRange.join('–')}</td><td>${(row.baseline.metrics['largest-contentful-paint'] / 1000).toFixed(1)} → ${(row.after.metrics['largest-contentful-paint'] / 1000).toFixed(1)}</td><td>${row.baseline.metrics['cumulative-layout-shift'].toFixed(3)} → ${row.after.metrics['cumulative-layout-shift'].toFixed(3)}</td><td>${reportLinks(row, 'baseline')} / ${reportLinks(row, 'after')}</td></tr>`).join('\n');
const selected = phases.after[0].report;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>A Fire — Lighthouse comparison</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#1a2527;background:#fff;margin:0}main{max-width:1400px;margin:auto;padding:40px 24px}h1{font-size:32px;line-height:1.15}h2{font-size:22px;margin-top:36px}p,li{max-width:90ch}small{display:block;font-weight:400;font-size:11px;color:#595959;overflow-wrap:anywhere}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #ddd;vertical-align:top}thead{background:#eff4f3}th:first-child{min-width:180px}a{color:#005a6a}code{font-size:13px}details{margin:20px 0}summary{cursor:pointer;font-weight:600}.note{border:1px solid #bacbc9;border-radius:12px;padding:16px 20px;background:#f4f8f7}.meta{color:#595959}</style></head><body><main>
<p class="meta">Local production build · ${escape(summary.generatedAt)} · baseline a044dcad</p><h1>A Fire: measured Lighthouse improvements</h1>
<p>Sixteen authenticated surfaces, both mobile and desktop, with ${phases.baseline.length} baseline and ${phases.after.length} final audits. Scores are the median where repeated, and a single result elsewhere. Raw HTML and JSON reports, screenshots, configuration, and CSV accompany this report.</p>
<div class="note"><strong>Authenticated app scope.</strong> This study targets Performance, Accessibility, and Best Practices. SEO is not applicable to these signed-in screens and is excluded from comparisons as requested. Existing indexing behavior is unchanged. Baseline raw reports contain an unused SEO category; no scored audit in the three measured categories was excluded or reweighted.</div>
<h2>Before and after</h2><p>Score order: <strong>Performance / Accessibility / Best Practices</strong>. Performance range shows all retained repetitions. LCP is simulated seconds; CLS is unitless. Report links are baseline runs / final runs.</p>
<div class="scroll"><table><thead><tr><th>Surface</th><th>Device</th><th>Before</th><th>After</th><th>Performance range</th><th>LCP seconds</th><th>CLS</th><th>Raw reports</th></tr></thead><tbody>${table}</tbody></table></div>
<h2>What changed</h2><ul><li>Feature routes load on navigation; the persistent app shell, audio player, and draft owners remain mounted.</li><li>Public hashed assets are served with negotiated gzip or Brotli and existing cache validation. API responses and private media retain their original authorization and cache policy.</li><li>Home artwork uses smaller WebP derivatives. Existing fonts use WOFF2 with unchanged glyph coverage. The original source files are retained.</li><li>Uploaded project icons retain their aspect ratio. Banner dimensions are read from validated server metadata to reserve layout space; prominent banners load eagerly. Lazy entry mosaics use their actual display slots for responsive images where supported.</li><li>Circles coordinates its first content render, while later refreshes preserve visible content. Contrast, main landmarks, and entry accessible names are corrected using existing components.</li><li>Real saved waveform peaks render immediately. Remote spectral color analysis waits for visible images and fonts, then browser idle time, and fetches at low priority; local recording previews remain immediate.</li><li>Chat presence stays on its existing websocket/cache channel instead of making an erroneous HTTP request.</li></ul>
<p>The Home mobile run records the initial JavaScript request falling from ${(entryScripts.baseline.transferBytes / 1000).toFixed(0)} kB to ${(entryScripts.after.transferBytes / 1000).toFixed(0)} kB transferred, including response overhead. Decoded JavaScript falls from ${(entryScripts.baseline.decodedBytes / 1000000).toFixed(2)} MB to ${(entryScripts.after.decodedBytes / 1000000).toFixed(2)} MB. This measures the entry script, not all route chunks or media.</p>
<h2>Method and reproducibility</h2><p>Production-built Nest API and Vite application at <code>${escape(environment.baseUrl)}</code>, backed by dedicated local PostgreSQL and local disk media. Authentication uses the real OTP verification endpoint, localStorage tokens, and the private-media cookie. No API mocks, production data, external uploads, or microphone grants.</p>
<p>Fixtures: ${escape(JSON.stringify(fixture.counts))}. Twenty-five real media attachments use committed repository imagery, canonical image variants, and an actual processed recording. Every surface has an expected-content assertion and image/HTTP/error preflight. Seeds and commands are documented in <code>tests/e2e/lighthouse/README.md</code>.</p>
<p>${escape(environment.lighthouse)} Lighthouse; Chromium ${escape(environment.chromium)}; Node ${escape(environment.node)}; ${escape(environment.platform)}; ${escape(environment.cpu)}. Standard Lighthouse mobile simulation and desktop preset; serial runs. HTTP cache, service workers, Cache Storage, and IndexedDB are cleared between navigations, while login state is retained. Six representative surfaces are repeated three times per device. No CPU-heavy build or test work ran during measured batches.</p>
<details><summary>Exact sample configuration</summary><pre>${escape(JSON.stringify(selected.configSettings, null, 2))}</pre></details>
<h2>Behavior and quality checks</h2><p>The real-browser verification exercises spectral color completion, playback that survives lazy route navigation, keyboard media activation, title/body autosave across reload, actual image upload/removal/replacement, and reopening persisted content. It runs after measurement because it edits only the reserved synthetic draft. See <a href="verification/checks.json">recorded interaction results</a> and <a href="verification/quality.json">type, lint, build, and focused-test evidence</a>. Final mobile and desktop screenshots retain the existing product design.</p>
<h2>Limits and remaining work</h2><p>These are local lab results, not field Core Web Vitals, a full accessibility certification, or production TLS/CDN measurements. Lighthouse navigation does not measure real interaction INP. Browser checks supplement keyboard, entry/media, draft, audio, and route behavior. Full recordings are still fetched for real spectral waveform colors; this eventual media cost is not removed. Some large shared JavaScript and unused code remain. Real WebSockets can prevent back/forward caching. Diagnostic source-map warnings are retained.</p>
<p>Service-worker mediated requests may report zero transfer bytes in Lighthouse despite a nonzero decoded resource size. Compare the raw request records and resource sizes as well as totals; the report does not claim that those resources cost no bandwidth. Cold HTTP-cache runs share a Chromium process within each batch; timing, connection state, decoding, and data arrival can still vary, as shown by the ranges.</p>
<details><summary>Remaining audit findings (including unweighted diagnostics)</summary><pre>${escape(JSON.stringify(failures, null, 2))}</pre></details>
<p><a href="comparison.csv">CSV comparison</a> · <a href="comparison.json">JSON comparison</a> · <a href="https://github.com/GoogleChrome/lighthouse/blob/main/docs/authenticated-pages.md">Lighthouse authenticated-page guidance</a> · <a href="https://developer.chrome.com/docs/lighthouse/performance/performance-scoring">Performance scoring and variability</a></p>
</main></body></html>`;
await writeFile(path.join(root, 'index.html'), html);
await mkdir('tmp/lighthouse', { recursive: true });
console.log(JSON.stringify({ report: path.join(root, 'index.html'), rows: rows.length, baselineRuns: phases.baseline.length, afterRuns: phases.after.length, minimumFinalAccessibility: Math.min(...rows.map(row => row.after.scores.accessibility)), minimumFinalBestPractices: Math.min(...rows.map(row => row.after.scores['best-practices'])) }, null, 2));
