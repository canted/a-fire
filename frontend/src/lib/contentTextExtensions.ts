import type StarterKit from '@tiptap/starter-kit';
import type TextAlign from '@tiptap/extension-text-align';
import type Highlight from '@tiptap/extension-highlight';
import type Link from '@tiptap/extension-link';
import type { TextStyleKit } from '@tiptap/extension-text-style';

/** Share configuration, not runtime instances, across the React 18/19 boundary. */
export function contentTextExtensions(runtime: {
  StarterKit: typeof StarterKit; TextAlign: typeof TextAlign; Highlight: typeof Highlight;
  Link: typeof Link; TextStyleKit: typeof TextStyleKit;
}) {
  return [
    runtime.TextStyleKit,
    runtime.StarterKit.configure({ link: false }),
    runtime.TextAlign.configure({ types: ['heading', 'paragraph'] }),
    runtime.Highlight.configure({ multicolor: true }),
    runtime.Link.configure({ openOnClick: false, HTMLAttributes: { target: null, rel: null } }),
  ];
}
