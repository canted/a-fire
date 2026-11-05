// @vitest-environment node
import { expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import legacy from "./retired-route-inventory.json";
import { expoRouteAlias } from '../../../../frontend/src/lib/expoRouteAlias';

it('retains non-retired destinations while removing Board and Square routes', () => {
  const example = (value: string) => value.replace(/:templateKey/g, 'feedback').replace(/:postType/g, 'text').replace(/:[^/]+/g, '7');
  const expo = new Set(readdirSync(path.resolve('frontend/src/app'), { recursive: true })
    .filter((file): file is string => typeof file === 'string' && file.endsWith('.tsx') && !file.includes('_layout') && !file.includes('[...'))
    .map(file => example('/' + file.replace(/\.tsx$/, '').replace(/(?:^|\/)index$/, '').replace(/\[([^\]]+)\]/g, ':$1'))));
  // Guard against an AST/configuration change silently turning this into an empty audit.
  expect(legacy.length).toBeGreaterThan(50);
  const retired = legacy.filter(route => /^\/app\/(square|board)\//.test(route));
  expect(retired.length).toBeGreaterThan(0);
  for (const route of retired) expect(expo.has(example(route))).toBe(false);
  const missing = legacy.filter(route => !retired.includes(route)).filter(route => { const sample = example(route); return !expo.has(expoRouteAlias(sample) ?? sample); });
  expect(missing).toEqual([]);
});
