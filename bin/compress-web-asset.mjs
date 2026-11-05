import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
/** Shared Vite/Expo build policy; runtime HTML and private media are excluded. */
export async function compressWebAsset(name, source) {
  if (!/^(?:assets\/|_expo\/static\/).+\.(?:js|mjs|css|svg|json|txt|xml|wasm)$/.test(name) || source.length < 1024) return [];
  const variants = await Promise.all([
    brotli(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }),
    gzipAsync(source, { level: 9 }),
  ]);
  return variants.flatMap((data, index) => data.length < source.length ? [{ extension: index === 0 ? 'br' : 'gz', data }] : []);
}
