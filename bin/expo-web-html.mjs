/** Keep install identity tied to the existing web app rather than a preview brand. */
export function expoWebHtml(exportedHtml, canonicalHtml) {
  const title = canonicalHtml.match(/<title>[\s\S]*?<\/title>/i)?.[0];
  const tags = [...canonicalHtml.matchAll(/<(?:link|meta)\b[^>]*>/gi)].map(match => match[0]).filter(tag =>
    /\brel=["'](?:manifest|icon|apple-touch-icon|apple-touch-startup-image)["']/i.test(tag) ||
    /\bname=["'](?:mobile-web-app-capable|apple-mobile-web-app-capable|apple-mobile-web-app-status-bar-style|apple-mobile-web-app-title|theme-color)["']/i.test(tag));
  if (!title || !tags.some(tag => /rel=["']manifest["']/.test(tag))) throw new Error('Canonical web install metadata is missing.');
  return exportedHtml.replace(/<meta\b[^>]*\bname=["']viewport["'][^>]*>/i, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />').replace(/<title>[\s\S]*?<\/title>/i, title)
    .replace(/<link\b[^>]*\brel=["'](?:icon|manifest|apple-touch-icon)["'][^>]*>/gi, '')
    .replace(/<\/head>/i, `${tags.join('\n')}\n</head>`);
}
