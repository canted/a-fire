import type Image from '@tiptap/extension-image';
import type { mergeAttributes } from '@tiptap/core';
import { imagePresentation } from './imagePresentation';

export function createContentImageSchema(runtime: { Image: typeof Image; mergeAttributes: typeof mergeAttributes }, editable: boolean) {
  return runtime.Image.extend({
    selectable: editable,
    renderHTML({ HTMLAttributes }) {
      return ['img', runtime.mergeAttributes(HTMLAttributes, imagePresentation({ src: HTMLAttributes.src ?? '', width: HTMLAttributes.width, height: HTMLAttributes.height }))];
    },
  });
}
