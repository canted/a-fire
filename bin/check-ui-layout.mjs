import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const gutterTokens = {
  '--app-page-inline-inset': 'var(--space-sm)',
  '--app-page-inset-start': 'max(var(--app-page-inline-inset), env(safe-area-inset-left, 0px))',
  '--app-page-inset-end': 'max(var(--app-page-inline-inset), env(safe-area-inset-right, 0px))',
  '--app-content-inline-inset': 'var(--app-page-inline-inset)',
  '--app-bar-inline-inset': 'var(--app-page-inline-inset)',
  '--bottom-toolbar-inline-inset': 'var(--app-page-inline-inset)',
};
const sourceEntries = dir => readdirSync(dir, { withFileTypes: true }).filter(entry => !['node_modules', '.expo', 'dist', 'ios', 'android'].includes(entry.name));
const cssFiles = dir => sourceEntries(dir).flatMap(entry => entry.isDirectory() ? cssFiles(join(dir, entry.name)) : entry.name.endsWith('.css') ? [join(dir, entry.name)] : []);
for (const file of cssFiles(join(root, 'frontend'))) {
  const relative = file.slice(join(root, 'frontend').length + 1);
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [token, value] of Object.entries(gutterTokens)) {
    const declarations = [...css.matchAll(new RegExp(`${token}\\s*:\\s*([^;]+);`, 'g'))];
    if (['site/styles/tokens.css', 'src/styles/tokens.css'].includes(relative)) {
      if (declarations.length !== 1 || declarations[0][1].trim() !== value) {
        failures.push(`${relative}: ${token} must retain the canonical shared 12px/safe-area gutter contract (${value}).`);
      }
    } else if (declarations.length) {
      failures.push(`${relative}: do not override ${token}; use the shared page boundary once.`);
    }
  }
  // Deliberately limited to flat declarations, including rules inside media queries.
  for (const [, selectorText, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = selectorText.split(',').map(value => value.trim());
    if (selectorText.includes(':focus') && /outline-offset\s*:\s*-|outline(?:-color)?\s*:[^;]*(?:var\(--color-(?:ink|black|accent)(?:-strong)?\)|#(?:000(?:000)?|1a2527)\b|\bblack\b)/i.test(declarations)) {
      failures.push(`${relative}: ${selectors.join(', ')} uses a black or inset focus outline. Use the shared outward accent focus treatment.`);
    }
  }
}
for (const owner of ['frontend/site/styles/tokens.css', 'frontend/src/styles/tokens.css']) {
  const tokens = readFileSync(join(root, owner), 'utf8');
  if (/--focus-ring\s*:\s*var\(--color-(?:ink|black|accent)/.test(tokens)) failures.push(`${owner}: focus must not alias the black ink/accent palette.`);
}

// Inspect JSX, not prose: documentation may name Home, but a bottom toolbar
// must never render a Home link, label, or house glyph, even behind a condition.
const tsxFiles = dir => sourceEntries(dir).flatMap(entry => entry.isDirectory() ? tsxFiles(join(dir, entry.name)) : entry.name.endsWith('.tsx') && !entry.name.includes('.stories.') ? [join(dir, entry.name)] : []);
const bottomToolbarNames = new Set(['ViewportToolbar', 'BottomToolbar']);
for (const file of tsxFiles(join(root, 'frontend'))) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node, insideBottomToolbar = false) => {
    const element = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (element) {
      const name = element.tagName.getText(source);
      const attributes = element.attributes.properties.filter(ts.isJsxAttribute);
      const label = attributes.find(attribute => attribute.name.getText(source) === 'aria-label')?.initializer?.getText(source) ?? '';
      insideBottomToolbar ||= bottomToolbarNames.has(name) || /bottom.*(?:toolbar|navigation)/i.test(label);
      if (insideBottomToolbar && attributes.some(attribute => {
        const attributeName = attribute.name.getText(source);
        const value = attribute.initializer?.getText(source) ?? '';
        return ((attributeName === 'to' || attributeName === 'href') && /appRoutes\.home\s*\(|["']\/app\/?["']/.test(value)) ||
          ((attributeName === 'aria-label' || attributeName === 'title') && /^["']Home(?:[\s,"']|$)/.test(value)) ||
          (name === 'Icon' && attributeName === 'name' && /["']house(?:Line)?(?:Fill)?["']/.test(value));
      })) {
        const position = source.getLineAndCharacterOfPosition(element.getStart(source));
        failures.push(`${file.slice(root.length)}:${position.line + 1}: Home navigation belongs in the top AppBar, never in a bottom toolbar.`);
      }
    }
    ts.forEachChild(node, child => visit(child, insideBottomToolbar));
  };
  visit(source);
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log('Shared 12px page boundaries, bottom toolbar navigation, and outward accent focus checks passed.');
