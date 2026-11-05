export function contentFileHref(src: unknown) {
  return typeof src === 'string' && /^\/api\/v1\/uploads\/[1-9]\d*$/.test(src) ? src : undefined;
}

export function contentFileSize(size: unknown) {
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Number((size / 1024).toFixed(1))} KB`;
  return `${Number((size / (1024 * 1024)).toFixed(1))} MB`;
}
