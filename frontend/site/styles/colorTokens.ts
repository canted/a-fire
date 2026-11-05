import source from "./tokens.css?raw";

/** Literal colors for APIs that cannot consume CSS variables. CSS remains the source. */
export function colorToken(name: string): string {
  const match = [...source.matchAll(/--color-([a-z-]+):\s*(#[\da-f]{6})\s*;/gi)].find(value => value[1] === name);
  if (!match) throw new Error("Missing literal color token: " + name);
  return match[2];
}
