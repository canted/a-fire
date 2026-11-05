import type { TiptapDoc, TiptapMark, TiptapNode } from "./tiptap";

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi;

export function firstLinkPreviewUrl(doc?: TiptapDoc | null, suppressedUrls: string[] = []): string | null {
  if (!doc?.content) return null;
  const suppressed = new Set(suppressedUrls.map(urlIdentity));
  const links: string[] = [];

  const add = (value: unknown) => {
    const url = normalizedHttpUrl(value);
    if (!url || suppressed.has(urlIdentity(url))) return;
    if (!links.includes(url)) links.push(url);
  };

  const walk = (node: TiptapNode) => {
    if (node.type === "text") {
      collectLinkMarks(node.marks).forEach(add);
      if (typeof node.text === "string") {
        for (const match of node.text.matchAll(URL_PATTERN)) {
          add(match[0]);
        }
      }
    }

    node.content?.forEach(walk);
  };

  doc.content.forEach(walk);
  return links[0] ?? null;
}

export function normalizedHttpUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = trimUrlCandidate(input.trim());
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

function trimUrlCandidate(value: string): string {
  let candidate = value.replace(/[.,!?;:]+$/g, "");
  candidate = trimUnmatchedTrailing(candidate, "(", ")");
  candidate = trimUnmatchedTrailing(candidate, "[", "]");
  candidate = trimUnmatchedTrailing(candidate, "{", "}");
  return candidate;
}

function trimUnmatchedTrailing(value: string, opening: string, closing: string): string {
  let candidate = value;
  while (candidate.endsWith(closing) && countCharacter(candidate, closing) > countCharacter(candidate, opening)) {
    candidate = candidate.slice(0, -1);
  }
  return candidate;
}

function countCharacter(value: string, character: string): number {
  return value.split(character).length - 1;
}

export function urlIdentity(url: string): string {
  return normalizedHttpUrl(url) ?? url.trim();
}

function collectLinkMarks(marks?: TiptapMark[]): string[] {
  if (!marks?.length) return [];
  return marks
    .filter((mark) => mark.type === "link")
    .map((mark) => (typeof mark.attrs?.href === "string" ? mark.attrs.href : null))
    .filter((href): href is string => Boolean(href));
}

/** Plain composers retain URL references as links, without creating media nodes. */
export function plainTextLinkNodes(text: string): TiptapNode[] {
  const nodes: TiptapNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index!;
    const label = trimUrlCandidate(match[0]);
    if (!normalizedHttpUrl(label)) continue;
    if (start > cursor) nodes.push({ type: "text", text: text.slice(cursor, start) });
    nodes.push({ type: "text", text: label, marks: [{ type: "link", attrs: { href: label } }] });
    cursor = start + label.length;
  }
  if (cursor < text.length) nodes.push({ type: "text", text: text.slice(cursor) });
  return nodes;
}

/** App references must resolve through their authorized destination, never public scraping. */
export function externalPreviewUrl(value: string | null): string | null {
  const url = normalizedHttpUrl(value);
  if (!url || /^\/app(?:\/|$)/.test(new URL(url).pathname)) return null;
  return url;
}
