import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
vi.mock('../../../../frontend/src/components/Icon', () => ({ Icon: () => null }));
vi.mock('../../../../frontend/src/components/PopupMenu', () => ({ PopupMenu: () => null }));
const bridge = vi.hoisted(() => ({ props: undefined as undefined | Record<string, unknown>, unchanged: true, document: { type: 'doc', content: [{ type: 'audio', attrs: { audioAssetId: 1, status: 'processing', nodeId: null } }] } }));
vi.mock('../../../../frontend/src/hooks/useEditorAudio', () => ({ useEditorAudio: () => ({ trigger: vi.fn() }) }));
vi.mock('../../../../frontend/src/hooks/useEditorVideo', () => ({ useEditorVideo: () => ({ trigger: vi.fn() }) }));
vi.mock('../../../../frontend/src/hooks/useAudioPlayback', () => ({ useAudioPlayback: () => ({}) }));
vi.mock('../../../../frontend/src/hooks/useEditorImage', () => ({ useEditorImage: () => ({ load: vi.fn(), active: true }) }));
vi.mock('../../../../frontend/src/hooks/useContentLink', () => ({ useContentLink: () => ({ open: vi.fn() }) }));
vi.mock('../../../../frontend/src/hooks/useMentionTargets', () => ({ useMentionTargets: () => ({}) }));
vi.mock('../../../../frontend/src/features/content/DocumentContent', () => ({ DocumentContent: () => null }));
vi.mock('../../../../frontend/src/features/content/DocumentMedia', () => ({ DocumentMedia: () => null }));
vi.mock('../../../../frontend/src/components/ViewportToolbar', async () => {
  const path = '../../../../frontend/node_modules/react/index.js';
  const { createElement } = await import(path);
  return { ViewportToolbar: ({ children }: { children: unknown }) => createElement('div', { 'data-testid': 'docked-toolbar' }, children) };
});
vi.mock('../../../../frontend/src/components/Input', () => ({ Input: () => null }));
vi.mock('../../../../frontend/src/components/Button', () => ({ Button: () => null }));
vi.mock('../../../../frontend/node_modules/react-native', async () => {
  const path = '../../../../frontend/node_modules/react/index.js';
  const React = await import(path);
  return { StyleSheet: { create: (value: unknown) => value }, Platform: { OS: 'web' }, ActivityIndicator: () => null, ScrollView: ({ children }: { children: unknown }) => React.createElement('div', null, children), Text: () => null, View: ({ children }: { children: unknown }) => React.createElement('div', null, children) };
});
vi.mock('../../../../frontend/src/features/content/RichDocumentEditor', async () => {
  const path = '../../../../frontend/node_modules/react/index.js';
  const { useEffect } = await import(path);
  return { default: (props: { flushRequest: number; onFlush: (...args: unknown[]) => Promise<void> }) => {
    bridge.props = props;
    useEffect(() => { if (props.flushRequest) void props.onFlush(props.flushRequest, bridge.document, undefined, null, bridge.unchanged); }, [props.flushRequest]);
    return null;
  } };
});
const expo = '../../../../frontend';
const { act, createElement, createRef } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { DocumentEditor } = await import(`${expo}/src/features/content/DocumentEditor.tsx`);
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; });
it('preserves untouched input on flush while inspection retains schema-normalized content', async () => {
  const content = { type: 'doc', content: [{ type: 'audio', attrs: { audioAssetId: 1 } }] };
  const ref = createRef<{ flush: () => Promise<unknown>; inspect: () => Promise<{ content: unknown }> }>();
  root = createRoot(document.createElement('div'));
  await act(async () => { root!.render(createElement(DocumentEditor, { ref, content, onChange: vi.fn() })); });
  let flushed!: Promise<unknown>;
  await act(async () => { flushed = ref.current!.flush(); });
  expect(await flushed).toEqual(content);
  let snapshot!: Promise<{ content: unknown }>;
  await act(async () => { snapshot = ref.current!.inspect(); });
  expect((await snapshot).content).toEqual(bridge.document);
  bridge.unchanged = false;
  await act(async () => { flushed = ref.current!.flush(); });
  expect(await flushed).toEqual(bridge.document);
});

it('keeps Notes docked by default and gives Entry formatting to the bubble without a second viewport toolbar', async () => {
  const container = document.createElement('div');
  root = createRoot(container);
  const content = { type: 'doc', content: [{ type: 'paragraph' }] };
  await act(async () => { root!.render(createElement(DocumentEditor, { content, onChange: vi.fn() })); });
  expect(container.querySelector('[data-testid="docked-toolbar"]')).not.toBeNull();
  expect(bridge.props?.bubble).toBe(false);
  await act(async () => { root!.render(createElement(DocumentEditor, { content, onChange: vi.fn(), toolbarMode: 'bubble', accessibilityLabel: 'Body' })); });
  expect(container.querySelector('[data-testid="docked-toolbar"]')).toBeNull();
  expect(bridge.props?.bubble).toBe(true);
  expect(bridge.props?.accessibilityLabel).toBe('Body');
  expect(bridge.props?.onFormat).toBeTypeOf('function');
});
