import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const repository = path.resolve(app, '..');
// Only server/client contracts may cross the replacement frontend boundary.
const contracts = new Set(['mention-target.ts', 'round-links.ts', 'activity-templates.ts', 'audio-spectrum.ts', 'image-policy.ts', 'project-identity.ts', 'mersenne-twister.d.ts'].map(name => path.join(repository, 'types', name)));
const files = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  if (['node_modules', '.expo', 'dist', 'ios', 'android', 'site'].includes(entry.name)) return [];
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? files(file) : /\.(?:ts|tsx|js|mjs|cjs|css)$/.test(file) ? [file] : [];
});
const failures = [];
for (const file of files(app)) {
  const source = readFileSync(file, 'utf8');
  const references = [...source.matchAll(/(?:from\s*|import\s*|import\s*\(|require\s*\(|new URL\s*\(|url\s*\()["']([^"']+)["']/g)].map(match => match[1]);
  for (const reference of references) {
    if (reference.startsWith('@/')) {
      failures.push(`${path.relative(app, file)}: legacy alias ${reference}`);
      continue;
    }
    if (!reference.startsWith('.')) continue;
    const target = path.resolve(path.dirname(file), reference);
    if (target === path.join(app, 'site') || target.startsWith(path.join(app, 'site') + path.sep)) {
      failures.push(`${path.relative(app, file)}: public website runtime dependency ${reference}`);
      continue;
    }
    if (target === app || target.startsWith(app + path.sep)) continue;
    if (contracts.has(target) || contracts.has(target + '.ts')) continue;
    failures.push(`${path.relative(app, file)}: external dependency ${reference}`);
  }
}
const config = JSON.parse(readFileSync(path.join(app, 'app.json'), 'utf8')).expo;
for (const asset of [config.icon, config.web?.favicon]) {
  if (asset && !path.resolve(app, asset).startsWith(app + path.sep)) failures.push(`app.json: external asset ${asset}`);
}
if (failures.length) throw new Error(`Expo dependency boundary failed:\n${failures.join('\n')}`);
console.log('Expo source, generators and configuration use no legacy frontend files; only explicit shared contracts cross the boundary.');
