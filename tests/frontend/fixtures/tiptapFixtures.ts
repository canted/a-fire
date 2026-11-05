import type { Attributes, Node, NodeConfig } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";
import type { ComponentType } from "react";

function extensionContext<Options, Storage>(extension: Node<Options, Storage>) {
  return {
    name: extension.name,
    options: extension.options,
    storage: extension.storage,
    parent: undefined,
  };
}

export function nodeAttributes<Options, Storage>(extension: Node<Options, Storage>): Attributes {
  return extension.config.addAttributes?.call(extensionContext(extension)) ?? {};
}

export function nodeParseHtml<Options, Storage>(extension: Node<Options, Storage>) {
  return extension.config.parseHTML?.call(extensionContext(extension));
}

export function nodeRenderHtml<Options, Storage>(
  extension: Node<Options, Storage>,
  props: Parameters<NonNullable<NodeConfig<Options, Storage>["renderHTML"]>>[0],
) {
  const output = extension.config.renderHTML?.call(extensionContext(extension), props);
  if (!Array.isArray(output)) throw new Error(`${extension.name} did not render an HTML array`);
  return output;
}

type NodeViewFixtureProps = {
  node: Pick<NodeViewProps["node"], "attrs">;
  selected?: boolean;
  editor?: Pick<NodeViewProps["editor"], "isEditable">;
  deleteNode?: NodeViewProps["deleteNode"];
  updateAttributes?: NodeViewProps["updateAttributes"];
};

/** For tests whose ReactNodeViewRenderer mock returns the React component unchanged. */
export function mockedNodeView<Options, Storage>(extension: Node<Options, Storage>) {
  const render = extension.config.addNodeView;
  if (!render) throw new Error(`${extension.name} has no node view`);
  // These node factories close over their options and do not read an editor or
  // schema from this context. The renderer is deliberately replaced by the test.
  const context = extensionContext(extension) as ThisParameterType<typeof render>;
  return render.call(context) as unknown as ComponentType<NodeViewFixtureProps>;
}

export function attributeElement(attributes: Record<string, string>): HTMLElement {
  const element = document.createElement("div");
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}
