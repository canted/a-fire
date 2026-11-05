import type { NodeConfig } from '@tiptap/core';
import { contentFileHref as fileHref } from './contentFile';
type FileNodeAttrs = { src: string | null; filename: string | null; size: number | null; contentType: string | null };
/** Canonical document schemas. Each platform supplies its own Tiptap runtime and views. */
export function audioNodeSchema<T extends string>(renderMode: T): NodeConfig<{ renderMode: T }> {
  return {
    name: "audio",
    group: "block",
    atom: true,
    draggable: renderMode === "editor",
    selectable: renderMode === "editor",

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
        title: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-audio-title"),
          renderHTML: (attributes) => {
            if (!attributes.title) return {};
            return { "data-audio-title": String(attributes.title) };
          },
        },
        status: {
          default: "processing",
          parseHTML: (element) => element.getAttribute("data-audio-status"),
          renderHTML: (attributes) => {
            if (!attributes.status) return {};
            return { "data-audio-status": String(attributes.status) };
          },
        },
        nodeId: {
          default: null,
          parseHTML: (element) => element.getAttribute("id") ?? element.getAttribute("data-audio-node-id"),
          renderHTML: (attributes) => {
            if (!attributes.nodeId) return {};
            return { id: String(attributes.nodeId), "data-audio-node-id": String(attributes.nodeId) };
          },
        },
      };
    },

    parseHTML() {
      return [{ tag: "div[data-audio-node]" }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, "data-audio-node": "true" }];
    },

};
}

export function videoNodeSchema<T extends string>(renderMode: T): NodeConfig<{ renderMode: T }> {
  return {
    name: "video",
    group: "block",
    atom: true,
    draggable: renderMode === "editor",
    selectable: renderMode === "editor",

    addOptions() {
      return {
        renderMode,
      };
    },

    addAttributes() {
      return {
        videoAssetId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-video-asset-id"),
          renderHTML: (attributes) => {
            if (!attributes.videoAssetId) return {};
            return { "data-video-asset-id": String(attributes.videoAssetId) };
          },
        },
        title: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-video-title"),
          renderHTML: (attributes) => {
            if (!attributes.title) return {};
            return { "data-video-title": String(attributes.title) };
          },
        },
        status: {
          default: "processing",
          parseHTML: (element) => element.getAttribute("data-video-status"),
          renderHTML: (attributes) => {
            if (!attributes.status) return {};
            return { "data-video-status": String(attributes.status) };
          },
        },
        durationMs: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-video-duration-ms"),
          renderHTML: (attributes) => {
            if (!attributes.durationMs) return {};
            return { "data-video-duration-ms": String(attributes.durationMs) };
          },
        },
        width: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-video-width"),
          renderHTML: (attributes) => {
            if (!attributes.width) return {};
            return { "data-video-width": String(attributes.width) };
          },
        },
        height: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-video-height"),
          renderHTML: (attributes) => {
            if (!attributes.height) return {};
            return { "data-video-height": String(attributes.height) };
          },
        },
        thumbnailUrl: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-video-thumbnail-url"),
          renderHTML: (attributes) => {
            if (!attributes.thumbnailUrl) return {};
            return { "data-video-thumbnail-url": String(attributes.thumbnailUrl) };
          },
        },
      };
    },

    parseHTML() {
      return [{ tag: "div[data-video-node]" }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, "data-video-node": "true" }];
    },

};
}

export function noteLinkNodeSchema(): NodeConfig {
  return {
  name: "noteLink",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-note-id") ?? element.getAttribute("data-page-id"),
        renderHTML: (attributes) => {
          if (!attributes.noteId) return {};
          return { "data-note-id": String(attributes.noteId) };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-note-link]" }, { tag: "div[data-page-link]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-note-link": "true" }];
  },

};
}

export function contentSourceNodeSchema(): NodeConfig {
  return {
  name: "contentSource",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      sourceType: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-source-type"),
        renderHTML: (attributes) => {
          if (!attributes.sourceType) return {};
          return { "data-source-type": String(attributes.sourceType) };
        },
      },
      sourceId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-source-id"),
        renderHTML: (attributes) => {
          if (!attributes.sourceId) return {};
          return { "data-source-id": String(attributes.sourceId) };
        },
      },
      sourcePath: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-source-path"),
        renderHTML: (attributes) => {
          if (!attributes.sourcePath) return {};
          return { "data-source-path": String(attributes.sourcePath) };
        },
      },
      authorName: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-author-name"),
        renderHTML: (attributes) => {
          if (!attributes.authorName) return {};
          return { "data-author-name": String(attributes.authorName) };
        },
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-source-label"),
        renderHTML: (attributes) => {
          if (!attributes.label) return {};
          return { "data-source-label": String(attributes.label) };
        },
      },
      nodeId: {
        default: null,
        parseHTML: (element) => element.getAttribute("id") ?? element.getAttribute("data-node-id"),
        renderHTML: (attributes) => {
          if (!attributes.nodeId) return {};
          return { id: String(attributes.nodeId), "data-node-id": String(attributes.nodeId) };
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
    };
  },

  parseHTML() {
    return [{ tag: "div[data-content-source]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-content-source": "true" }];
  },

};
}

/** Stateless callbacks keep the schema portable across independently installed editor runtimes. */
export function fileNodeSchema(renderMode: "editor" | "readonly") {
  return {
    name: "file",
    group: "block",
    atom: true,
    draggable: renderMode === "editor",
    selectable: renderMode === "editor",
    addAttributes(this: void) {
      return {
        src: { default: null, parseHTML: element => element.getAttribute("data-src") },
        filename: { default: null, parseHTML: element => element.getAttribute("data-filename") },
        size: { default: null, parseHTML: element => element.hasAttribute("data-size") ? Number(element.getAttribute("data-size")) : null },
        contentType: { default: null, parseHTML: element => element.getAttribute("data-content-type") },
      };
    },
    parseHTML(this: void) { return [{ tag: "div[data-content-file]" }]; },
    renderHTML(this: void, { node }) {
      const attrs = node.attrs as FileNodeAttrs;
      const filename = attrs.filename || "File";
      const href = fileHref(attrs.src);
      return ["div", { "data-content-file": "true", "data-src": href, "data-filename": filename, "data-size": attrs.size, "data-content-type": attrs.contentType },
        href ? ["a", { href, download: filename }, filename] : ["span", {}, filename]];
    },
} satisfies NodeConfig;
}
