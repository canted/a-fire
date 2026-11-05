import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const selected = {
  surface: '--color-surface',
  red: '--color-red',
  orange: '--color-orange',
  green: '--color-green',
  yellow: '--color-yellow',
  blue: '--color-blue',
  purple: '--color-purple',
  roundEventSurface: '--color-round-event-surface',
  roundEventAccent: '--color-round-event-accent',
  roundEventMuted: '--color-round-event-muted',
  roundEventBorder: '--color-round-event-border',
  aqua: '--color-aqua',
  projectEntryAction: '--color-project-entry-action',
  newPostAction: '--color-new-post-action',
  coolStrong: '--color-cool-strong',
  radiusActionSquare: '--radius-action-square',
  bright: '--color-bright',
  fire: '--color-fire',
  cool: '--color-cool',
  coolPale: '--color-cool-pale',
  surfaceMuted: '--color-surface-muted',
  mediaTileControl: '--color-media-tile-control',
  waveformPlaceholder: '--color-waveform-placeholder',
  coolDarker: '--color-cool-darker',
  coolSoft: '--color-cool-soft',
  warning: '--color-warning-dark',
  danger: '--color-danger-strong',
  paper: '--color-paper',
  focus: '--color-purple',
  radius: '--radius-lg',
  radiusDefault: '--radius-sm',
  radiusField: '--radius-md',
  ink: '--color-ink',
  muted: '--color-ink-subtle',
  inkMuted: '--color-ink-muted',
  border: '--color-border',
  borderStrong: '--color-border-strong',
  gutter: '--space-sm',
  toolbarControlPadding: '--bottom-toolbar-control-padding',
  viewportContentClearance: '--viewport-content-bottom-clearance',
  gap: '--space-lg',
  section: '--space-2xl',
  bodySize: '--text-size-base',
  titleSize: '--text-size-3xl',
};
const tokens = Object.fromEntries(Object.entries(selected).map(([name, variable]) => {
  const value = source.match(new RegExp(`${variable}:\\s*([^;]+);`))?.[1].trim();
  if (!value || !/^(#[\da-f]{6}|[\d.]+rem|rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\))$/i.test(value)) throw new Error(`Unsupported token: ${variable}`);
  return [name, value.endsWith('rem') ? Number.parseFloat(value) * 16 : value];
}));
const output = `// Generated from frontend/src/styles/tokens.css by scripts/generate-tokens.mjs.\n// Native dimensions use the web baseline of 16 px per rem.\nexport const tokens = ${JSON.stringify(tokens, null, 2)} as const;\n`;
const target = new URL('../src/styles/tokens.ts', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Expo tokens are stale. Run pnpm expo:tokens.');
} else writeFileSync(target, output);
