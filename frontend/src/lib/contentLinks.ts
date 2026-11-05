/** Shared URL boundary for document renderers; never execute document-supplied schemes. */
export function contentLink(value: unknown): string | undefined {
  if (typeof value !== 'string' || /[\u0000-\u0020\\]/.test(value)) return undefined;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

export function mediaLink(value: unknown, origin: string): string | undefined {
  const safe = contentLink(value);
  if (!safe) return undefined;
  const url = new URL(safe, origin);
  return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
}

/** Keep app URLs on the active browser origin, including local development aliases. */
export function localAppLink(href: string, origin: string): string {
  if (href.startsWith("/")) return href;
  try {
    const target = new URL(href);
    const current = new URL(origin);
    const loopback = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
    const sameApp = target.origin === current.origin || (loopback(target.hostname) && loopback(current.hostname) && target.port === current.port && target.protocol === current.protocol);
    return sameApp && !target.username && !target.password && /^\/app(?:\/|$)/.test(target.pathname)
      ? `${target.pathname}${target.search}${target.hash}` : href;
  } catch { return href; }
}
