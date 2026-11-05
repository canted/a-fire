import { readVapidPublicKey, type VapidEnv } from "./vapid";

const VAPID_META_PATTERN =
  /<meta\b(?=[^>]*\bname=(["'])vapid-public-key\1)(?=[^>]*\bcontent=(["'])[^"']*\2)[^>]*>/i;
const CLIENT_BUILD_META_PATTERN =
  /<meta\b(?=[^>]*\bname=(["'])afire-build-id\1)(?=[^>]*\bcontent=(["'])[^"']*\2)[^>]*>/i;

export function renderFrontendIndexHtml(
  html: string,
  env: VapidEnv = process.env,
  options: { buildId?: string | null } = {},
): string {
  const withBuildId = injectMetaContent(html, CLIENT_BUILD_META_PATTERN, "afire-build-id", options.buildId);
  const publicKey = readVapidPublicKey(env);
  if (!publicKey) return withBuildId;

  return injectMetaContent(withBuildId, VAPID_META_PATTERN, "vapid-public-key", publicKey);
}

function injectMetaContent(html: string, pattern: RegExp, name: string, value?: string | null): string {
  if (!value) return html;

  const escapedValue = escapeHtmlAttribute(value);
  if (pattern.test(html)) {
    return html.replace(pattern, (tag) =>
      tag.replace(/\bcontent=(["'])(.*?)\1/i, (_match, quote: string) => `content=${quote}${escapedValue}${quote}`),
    );
  }

  return html.replace(/<\/head>/i, `    <meta name="${name}" content="${escapedValue}" />\n  </head>`);
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
