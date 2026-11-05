---
name: visual-viewport
description: Maintain A Fire mobile composer viewport, software-keyboard docking, scrolling, focus handoff, and overlay placement. Use for bugs or changes on page-like editors that follow the visual viewport.
---

# Mobile visual viewport and composers

Read the canonical implementation registry in [AGENTS.md](../../AGENTS.md#8-canonical-implementation-registry) before changing a composer, toolbar, or shared primitive. Trace the feature's shell and editor configuration first; this behavior already has shared owners.

## Ownership map

| Responsibility | Maintained implementation |
| --- | --- |
| Viewport height, offset, keyboard inset, and open state | [useVisualViewport.ts](../../frontend/hooks/useVisualViewport.ts) |
| Document scroll suppression, one content scroll region, and toolbar portal | [VisualViewportComposerShell.tsx](../../frontend/features/entries/editor/VisualViewportComposerShell.tsx) |
| Tiptap autofocus and bounded readiness retries | [useContentEditorAutofocus.ts](../../frontend/features/content/editor/useContentEditorAutofocus.ts) |
| Focus transfer across navigation/asynchronous editor mounting | [editorFocusHandoff.ts](../../frontend/features/content/editor/editorFocusHandoff.ts) |
| Default/legacy ContentEditor keyboard offsets | [useContentEditorViewport.ts](../../frontend/features/content/editor/useContentEditorViewport.ts) |
| Overlay collision boundary from the shell's scroll region | [visual-viewport-overlay.tsx](../../frontend/components/ui/visual-viewport-overlay.tsx) |
| Dock presentation and layout | [BottomActionDock.tsx](../../frontend/components/BottomActionDock.tsx) |

## Integrate through the existing shell

Use [PostComposerPage.tsx](../../frontend/features/entries/editor/PostComposerPage.tsx) and [NoteComposer.tsx](../../frontend/features/notes/NoteComposer.tsx) as production integration references.

- Page-like keyboard-following editors render inside `VisualViewportComposerShell` and pass its render callback's `toolbarPortalTarget` to their editor/composer.
- Configure `ContentEditor` with `layoutMode="single-scroll-parent"` inside this shell; `PostComposer` forwards this through `editorLayoutMode`. This avoids adding the legacy editor's separate keyboard-offset behavior to the shell layout.
- Put content that users review while typing in the shell's designated scroll region. Render docked toolbars and prompt shelves through the toolbar portal, outside that scroll region.
- Keep `BottomActionDock` in flow when it is rendered in the shell toolbar. It is a presentation primitive and must not calculate viewport or keyboard offsets.
- Use the existing autofocus and focus-handoff owners when first-interaction focus is required. Do not copy timers, temporary focus elements, or retry loops into a leaf feature.
- Extend the shell's supported props for feature layout only when needed. Its existing structural selectors are `visual-viewport-shell*` in [frontend/site/styles/index.css](../../frontend/site/styles/index.css); feature-specific styling uses CSS Modules and design tokens.

For menus/popovers, inspect the shell's overlay provider and the existing shared primitive before changing placement. Preserve the scroll region as the collision boundary. Do not introduce a parallel viewport listener or document-scroll lock in the overlay itself.

## Verify the behavior

Extend the existing suites for the relevant owner:

- [useVisualViewport.test.tsx](../../tests/frontend/unit/hooks/useVisualViewport.test.tsx)
- [visualViewportComposerShell.test.tsx](../../tests/frontend/unit/posts/editor/visualViewportComposerShell.test.tsx)
- [visualViewportOverlay.test.tsx](../../tests/frontend/unit/components/visualViewportOverlay.test.tsx)
- [contentEditor.test.tsx](../../tests/frontend/unit/content/contentEditor.test.tsx)
- [postComposerPage.test.tsx](../../tests/frontend/unit/posts/editor/postComposerPage.test.tsx)
- [noteComposer.test.tsx](../../tests/frontend/unit/notes/noteComposer.test.tsx)

Check requested first-interaction focus, document panning suppression, independent content scrolling, dock placement outside the scroll region, and viewport resize/scroll updates. Include keyboard closing, route unmount cleanup, and bottom-navigation reservation when those behaviors are affected.

Use the [testing guide](../e2e-tests/SKILL.md) for runner setup. Unit tests can simulate viewport events and verify ownership, but a real mobile keyboard check is needed to assess browser focus/keyboard behavior accurately; report when that check has not been performed.
