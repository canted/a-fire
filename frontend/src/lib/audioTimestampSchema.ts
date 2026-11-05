import type * as Tiptap from "@tiptap/core";
import { formatAudioTimestamp, normalizeAudioSeconds } from "./audioTimestamp";

type AudioTimestampAttrs = {
  audioAssetId?: string | number | null;
  audioNodeId?: string | number | null;
  sourcePath?: string | null;
  title?: string | null;
  seconds?: number | null;
  nodeId?: string | null;
};

type AudioTimestampNodeOptions = {
  renderMode: "editor" | "readonly";
};

function audioTimestampTitle(attrs: AudioTimestampAttrs) {
  return attrs.title?.trim() || "Audio";
}

function audioTimestampSeconds(attrs: AudioTimestampAttrs) {
  return normalizeAudioSeconds(attrs.seconds ?? 0);
}

function audioTimestampHtmlAttributes(attrs: AudioTimestampAttrs) {
  const htmlAttrs: Record<string, string> = { "data-audio-timestamp": "true" };
  if (attrs.audioAssetId) htmlAttrs["data-audio-asset-id"] = String(attrs.audioAssetId);
  if (attrs.audioNodeId) htmlAttrs["data-audio-node-id"] = String(attrs.audioNodeId);
  if (attrs.sourcePath) htmlAttrs["data-href"] = attrs.sourcePath;
  if (attrs.title) htmlAttrs["data-audio-title"] = attrs.title;
  if (attrs.nodeId) {
    htmlAttrs.id = attrs.nodeId;
    htmlAttrs["data-node-id"] = attrs.nodeId;
  }
  htmlAttrs["data-audio-seconds"] = String(audioTimestampSeconds(attrs));
  return htmlAttrs;
}

function waveformIconSpec() {
  return [
    "span",
    { class: "tiptap-mention__icon tiptap-audio-timestamp__icon", "aria-hidden": "true" },
    [
      "http://www.w3.org/2000/svg svg",
      { viewBox: "0 0 256 256", fill: "none" },
      ["line", { x1: "48", y1: "96", x2: "48", y2: "160", stroke: "currentColor", "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-width": "16" }],
      ["line", { x1: "88", y1: "32", x2: "88", y2: "224", stroke: "currentColor", "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-width": "16" }],
      ["line", { x1: "128", y1: "64", x2: "128", y2: "192", stroke: "currentColor", "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-width": "16" }],
      ["line", { x1: "168", y1: "96", x2: "168", y2: "160", stroke: "currentColor", "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-width": "16" }],
      ["line", { x1: "208", y1: "80", x2: "208", y2: "176", stroke: "currentColor", "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-width": "16" }],
    ],
  ];
}

export function createAudioTimestampSchema({ Node, mergeAttributes }: Pick<typeof Tiptap, "Node" | "mergeAttributes">, options?: Partial<AudioTimestampNodeOptions>) {
  const renderMode = options?.renderMode ?? "editor";

  return Node.create<AudioTimestampNodeOptions>({
    name: "audioTimestamp",
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,

    addOptions() {
      return {
        renderMode,
      };
    },

    addAttributes() {
      return {
        audioAssetId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-audio-asset-id"),
          renderHTML: (attributes) => {
            if (!attributes.audioAssetId) return {};
            return { "data-audio-asset-id": String(attributes.audioAssetId) };
          },
        },
        audioNodeId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-audio-node-id"),
          renderHTML: (attributes) => {
            if (!attributes.audioNodeId) return {};
            return { "data-audio-node-id": String(attributes.audioNodeId) };
          },
        },
        sourcePath: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-href") ?? element.getAttribute("href"),
          renderHTML: (attributes) => {
            if (!attributes.sourcePath) return {};
            return { "data-href": String(attributes.sourcePath) };
          },
        },
        title: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-audio-title"),
          renderHTML: (attributes) => {
            if (!attributes.title) return {};
            return { "data-audio-title": String(attributes.title) };
          },
        },
        seconds: {
          default: 0,
          parseHTML: (element) => normalizeAudioSeconds(element.getAttribute("data-audio-seconds")),
          renderHTML: (attributes) => ({ "data-audio-seconds": String(normalizeAudioSeconds(attributes.seconds)) }),
        },
        nodeId: {
          default: null,
          parseHTML: (element) => element.getAttribute("id") ?? element.getAttribute("data-node-id"),
          renderHTML: (attributes) => {
            if (!attributes.nodeId) return {};
            return { id: String(attributes.nodeId), "data-node-id": String(attributes.nodeId) };
          },
        },
      };
    },

    parseHTML() {
      return [{ tag: "span[data-audio-timestamp]" }, { tag: "a[data-audio-timestamp]" }];
    },

    renderHTML({ node, HTMLAttributes }) {
      const attrs = node.attrs as AudioTimestampAttrs;
      const title = audioTimestampTitle(attrs);
      const timestamp = formatAudioTimestamp(audioTimestampSeconds(attrs));
      const htmlAttrs = mergeAttributes(HTMLAttributes, audioTimestampHtmlAttributes(attrs), {
        class: "tiptap-mention tiptap-audio-timestamp",
      });
      const content = [
        waveformIconSpec(),
        ["span", { class: "tiptap-mention__label" }, title],
        ["span", { class: "tiptap-audio-timestamp__time" }, `@ ${timestamp}`],
      ];

      if (renderMode === "readonly" && attrs.sourcePath) {
        return ["a", mergeAttributes(htmlAttrs, { href: attrs.sourcePath }), ...content];
      }

      return ["span", htmlAttrs, ...content];
    },
  });
}
