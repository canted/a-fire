import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ params: {} as Record<string,string>, values: [] as unknown[], index: 0, signedIn: false, replace: vi.fn(), request: vi.fn(), verify: vi.fn() }));
vi.mock('../../../../frontend/node_modules/react', () => ({ useState: (initial: unknown) => [state.values[state.index++] ?? initial, vi.fn()] }));
vi.mock('../../../../frontend/node_modules/expo-router', () => ({ Redirect: 'Redirect', useLocalSearchParams: () => state.params, useRouter: () => ({ replace: state.replace }) }));
vi.mock('../../../../frontend/node_modules/react-native', () => ({ KeyboardAvoidingView: 'View', ScrollView: 'ScrollView', Text: 'Text', View: 'View', Platform: { OS: 'web' }, StyleSheet: { create: (value: unknown) => value } }));
vi.mock('../../../../frontend/node_modules/react-native-safe-area-context', () => ({ SafeAreaView: 'View' }));
vi.mock('../../../../frontend/node_modules/expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('../../../../frontend/src/components/Button', () => ({ Button: 'Button' }));
vi.mock('../../../../frontend/src/components/Input', () => ({ Input: 'Input' }));
vi.mock('../../../../frontend/src/components/Fire', () => ({ Fire: 'Fire' }));
vi.mock('../../../../frontend/src/styles/layout', () => ({ layout: {} }));
vi.mock('../../../../frontend/src/hooks/useSession', () => ({ useSession: () => ({ ready: true, signedIn: state.signedIn }), useAuthentication: () => ({ request: { trigger: state.request }, verify: { trigger: state.verify } }) }));
const { SignInScreen } = await import('../../../../frontend/src/features/auth/SignInScreen');
function elements(node: any): any[] { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(elements)] : []; }
afterEach(() => { state.params = {}; state.values = []; state.index = 0; state.signedIn = false; vi.clearAllMocks(); });
it('moves a successful code request to the reloadable verification URL with safe intent', async () => {
  state.params = { next: '/app/rooms/9/members/7/introductions?introduction=8' }; state.values = ['test@example.com'];
  elements(SignInScreen()).find(item => item.type === 'Button' && item.props.children === 'Continue').props.onPress();
  await Promise.resolve();
  expect(state.request).toHaveBeenCalledWith({ email: 'test@example.com' });
  expect(state.replace).toHaveBeenCalledWith({ pathname: '/auth/verify', params: { email: 'test@example.com', next: state.params.next } });
});
it('verifies an existing code link without sending another code', async () => {
  state.params = { email: 'test@example.com', next: '/app/board/7' }; state.values = ['test@example.com', '123456'];
  elements(SignInScreen({ initialVerify: true })).find(item => item.type === 'Button' && item.props.children === 'Sign in').props.onPress();
  await Promise.resolve();
  expect(state.verify).toHaveBeenCalledWith({ email: 'test@example.com', token: '123456' });
  expect(state.request).not.toHaveBeenCalled();
});
it('rejects external signed-in return destinations', () => {
  state.signedIn = true; state.params = { next: 'https://outside.example' };
  expect(SignInScreen().props.href).toBe('/app');
});
it('requests a code when a verification link is missing its email', () => {
  state.values = ['test@example.com'];
  const buttons = elements(SignInScreen({ initialVerify: true })).filter(item => item.type === 'Button');
  expect(buttons.some(item => item.props.children === 'Continue')).toBe(true);
  expect(buttons.some(item => item.props.children === 'Sign in')).toBe(false);
});
