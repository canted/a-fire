import { normalizeMentionTargetType } from "../../../types/mention-target";
import type { Range } from "@tiptap/core";
import type * as Tiptap from "@tiptap/core";
import type Mention from "@tiptap/extension-mention";
import type { PluginKey } from "@tiptap/pm/state";
import type { SuggestionKeyDownProps, SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";

import type { MentionTarget } from "./api/mentions";
import { filterMentionTargets } from "./mentionTargets";

export type ContentMentionSuggestionState = {
  range: Range;
  query: string;
  text: string;
  clientRect?: (() => DOMRect | null) | null;
  command: (target: MentionTarget) => void;
};

export type ContentMentionSuggestionOptions = {
  getTargets?: () => MentionTarget[];
  onStart?: (state: ContentMentionSuggestionState) => void;
  onUpdate?: (state: ContentMentionSuggestionState) => void;
  onExit?: () => void;
  onKeyDown?: (props: SuggestionKeyDownProps) => boolean;
  shouldShow?: NonNullable<SuggestionOptions<MentionTarget, MentionTarget>["shouldShow"]>;
};

type CreateMentionNodeOptions = {
  renderMode: "editor" | "readonly";
  suggestion?: ContentMentionSuggestionOptions;
};

type MentionAttrs = {
  id?: string | null;
  label?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  avatarUrl?: string | null;
  icon?: string | null;
  href?: string | null;
};



function mentionText(attrs: MentionAttrs) {
  return attrs.label || attrs.id || "mention";
}

function mentionHtmlAttributes(attrs: MentionAttrs) {
  const htmlAttrs: Record<string, string> = { "data-type": "mention" };
  if (attrs.targetType) htmlAttrs["data-target-type"] = attrs.targetType;
  if (attrs.targetId) htmlAttrs["data-target-id"] = attrs.targetId;
  if (attrs.avatarUrl) htmlAttrs["data-avatar-url"] = attrs.avatarUrl;
  if (attrs.icon) htmlAttrs["data-icon"] = attrs.icon;
  if (attrs.href) htmlAttrs["data-href"] = attrs.href;
  return htmlAttrs;
}

function mentionIconSpec(attrs: MentionAttrs) {
  if (attrs.targetType === "user" && attrs.avatarUrl) {
    return [
      "span",
      { class: "tiptap-mention__icon", "aria-hidden": "true" },
      ["img", { class: "tiptap-mention__avatar", src: attrs.avatarUrl, alt: "", draggable: "false" }],
    ];
  }

  if (normalizeMentionTargetType(attrs.targetType) === "note" && attrs.icon) {
    return ["span", { class: "tiptap-mention__icon", "aria-hidden": "true" }, attrs.icon];
  }

  return null;
}

function toSuggestionState(props: SuggestionProps<MentionTarget, MentionTarget>): ContentMentionSuggestionState {
  return {
    range: props.range,
    query: props.query,
    text: props.text,
    clientRect: props.clientRect,
    command: props.command,
  };
}

export function createContentMentionRuntime({ Mention: MentionRuntime, PluginKey: PluginKeyRuntime, mergeAttributes }: { Mention: typeof Mention; PluginKey: typeof PluginKey; mergeAttributes: typeof Tiptap.mergeAttributes }) {
const contentMentionPluginKey = new PluginKeyRuntime("contentMention");
const ContentMentionNode = MentionRuntime.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      targetType: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-target-type"),
        renderHTML: (attributes) => {
          if (!attributes.targetType) return {};
          return { "data-target-type": String(attributes.targetType) };
        },
      },
      targetId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-target-id"),
        renderHTML: (attributes) => {
          if (!attributes.targetId) return {};
          return { "data-target-id": String(attributes.targetId) };
        },
      },
      href: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-href") ?? element.getAttribute("href"),
        renderHTML: (attributes) => {
          if (!attributes.href) return {};
          return { "data-href": String(attributes.href) };
        },
      },
      avatarUrl: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-avatar-url"),
        renderHTML: (attributes) => {
          if (!attributes.avatarUrl) return {};
          return { "data-avatar-url": String(attributes.avatarUrl) };
        },
      },
      icon: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-icon"),
        renderHTML: (attributes) => {
          if (!attributes.icon) return {};
          return { "data-icon": String(attributes.icon) };
        },
      },
    };
  },
});

function createMentionNode({ renderMode, suggestion }: CreateMentionNodeOptions) {
  return ContentMentionNode.configure({
    HTMLAttributes: {
      class: "tiptap-mention",
      "data-type": "mention",
    },
    deleteTriggerWithBackspace: true,
    renderText: ({ node }) => mentionText(node.attrs as MentionAttrs),
    renderHTML: ({ node, options }) => {
      const attrs = node.attrs as MentionAttrs;
      const text = mentionText(attrs);
      const htmlAttrs = mergeAttributes(options.HTMLAttributes, mentionHtmlAttributes(attrs));
      const icon = mentionIconSpec(attrs);
      const content = icon
        ? [icon, ["span", { class: "tiptap-mention__label" }, text]]
        : [["span", { class: "tiptap-mention__label" }, text]];

      if (renderMode === "readonly" && attrs.href) {
        return ["a", mergeAttributes(htmlAttrs, { href: attrs.href }), ...content];
      }

      return ["span", htmlAttrs, ...content];
    },
    suggestion: {
      char: "@",
      pluginKey: contentMentionPluginKey,
      items: ({ query }) => filterMentionTargets(suggestion?.getTargets?.() ?? [], query),
      command: ({ editor, range, props }) => {
        const target = props as MentionTarget;
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            {
              type: "mention",
              attrs: {
                id: target.id,
                targetType: target.targetType,
                targetId: target.targetId,
                label: target.label,
                avatarUrl: target.avatarUrl,
                icon: target.icon,
                href: target.href,
              },
            },
            { type: "text", text: " " },
          ])
          .run();
      },
      render: () => ({
        onStart: (props) => suggestion?.onStart?.(toSuggestionState(props)),
        onUpdate: (props) => suggestion?.onUpdate?.(toSuggestionState(props)),
        onExit: () => suggestion?.onExit?.(),
        onKeyDown: (props) => suggestion?.onKeyDown?.(props) ?? false,
      }),
      ...(suggestion?.shouldShow ? { shouldShow: suggestion.shouldShow } : {}),
    },
  });
}

return { createMentionNode, contentMentionPluginKey };
}
