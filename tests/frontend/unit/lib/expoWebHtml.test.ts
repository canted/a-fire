import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { expoWebHtml } from '../../../../bin/expo-web-html.mjs';
it('uses Expo-owned installation identity without importing the Vite boot or placeholder key', () => {
  const canonical = readFileSync('frontend/web-metadata.html', 'utf8');
  const result = expoWebHtml('<html><head><title>A Fire</title><link rel="icon" href="/favicon.ico"><meta name="viewport" content="expo"></head><body><script src="/_expo/entry.js"></script></body></html>', canonical);
  expect(result).toContain('<title>A Fire</title>');
  expect(result).toContain('rel="manifest" href="/manifest.json"');
  expect(result).toContain('apple-touch-icon');
  expect(result).toContain('apple-mobile-web-app-capable');
  expect(result).toContain('src="/_expo/entry.js"');
  expect(result).toContain('content="width=device-width, initial-scale=1, viewport-fit=cover"');
  expect(result).not.toContain('/main.tsx');
  expect(result).not.toContain('%VITE_VAPID_PUBLIC_KEY%');
  expect(result).not.toContain('/favicon.ico');
});
it('fails visibly when canonical installation metadata is missing', () => {
  expect(() => expoWebHtml('<head></head>', '<title>A Fire</title>')).toThrow('Canonical web install metadata is missing');
});

it('lets the shell paint the web safe area', () => {
  const result = expoWebHtml('<head><title>Expo</title><meta name="viewport" content="width=device-width"></head>', '<title>A Fire</title><link rel="manifest" href="/manifest.json">');
  expect(result).toContain('viewport-fit=cover');
  expect(result.match(/name="viewport"/g)).toHaveLength(1);
});
