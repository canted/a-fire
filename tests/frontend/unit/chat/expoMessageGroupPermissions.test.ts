import { afterEach, expect, it, vi } from 'vitest';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock('../../../../frontend/node_modules/react-native', async () => {
  const React = await import(String('../../../../frontend/node_modules/react/index.js')) as typeof import('react');
  const View = ({ children }: any) => React.createElement('div', null, children);
  return { View, Text: View, Image: () => null, Platform: { OS: 'web' }, StyleSheet: { create: (styles: unknown) => styles } };
});
vi.mock('../../../../frontend/node_modules/react-native-svg', () => ({ SvgXml: () => null }));
vi.mock('../../../../frontend/src/hooks/useIdentityImage', () => ({ useIdentityImage: () => undefined }));
vi.mock('../../../../frontend/src/hooks/useRoomExposure', async () => {
  const React = await import(String('../../../../frontend/node_modules/react/index.js')) as typeof import('react');
  return { RoomExposure: React.createContext(() => {}) };
});
vi.mock('../../../../frontend/src/features/rooms/MessageContent', async () => {
  const React = await import(String('../../../../frontend/node_modules/react/index.js')) as typeof import('react');
  return { MessageContent: ({ message }: any) => React.createElement('span', null, message.body) };
});
vi.mock('../../../../frontend/src/features/rooms/MessageActions', async () => {
  const React = await import(String('../../../../frontend/node_modules/react/index.js')) as typeof import('react');
  return { MessageActions: ({ children }: any) => React.createElement('section', null, children, React.createElement('button', null, 'Save')) };
});
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`);
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`);
const { MessageGroup } = await import(`${expo}/src/features/rooms/MessageGroup.tsx`);
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); });
it('removes the save gesture owner when membership access is lost, keeping visible text', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const group = { key: 'one', entries: [{ id: 1, kind: 'message', body: 'Visible visitor message', author: { display_username: 'Host' } }] };
  const render = async (canSaveMessage?: boolean) => act(async () => root.render(createElement(MessageGroup, { room: '7', group, canSaveMessage })));
  await render(true);
  expect(container.querySelector('button')?.textContent).toBe('Save');
  await render(false);
  expect(container.textContent).toContain('Visible visitor message');
  expect(container.querySelector('section')).toBeNull();
  expect(container.querySelector('button')).toBeNull();
  await render();
  expect(container.querySelector('button')).toBeNull();
});
