import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { analyticsRoute } from '../../../../frontend/src/lib/analyticsRoute';
const ph = vi.hoisted(() => ({ init: vi.fn(), register: vi.fn(), capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), get_distinct_id: vi.fn(() => 'anonymous') }));
vi.mock('../../../../frontend/node_modules/posthog-js', () => ({ default: ph }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); ph.get_distinct_id.mockReturnValue('anonymous'); vi.stubEnv('EXPO_PUBLIC_POSTHOG_KEY', 'test-key'); vi.stubEnv('EXPO_PUBLIC_POSTHOG_ENABLE_IN_DEV', 'true'); });
afterEach(() => vi.unstubAllEnvs());
describe('Expo analytics', () => {
  it('redacts invitation tokens, unknown paths, and queries while preserving entity IDs', () => {
    expect(analyticsRoute('/auth/invite/secret?email=private')).toEqual({ route_name: '/auth/invite/[token]' });
    expect(analyticsRoute('/app/projects/7/entries/new')).toEqual({ route_name: '/app/projects/[projectId]/entries/new', project_id: 7 });
    expect(analyticsRoute('/unknown/private')).toEqual({ route_name: 'unknown' });
    expect(analyticsRoute('/app/projects/7/entries/9/share?draftId=secret')).toEqual({ route_name: '/app/projects/[projectId]/entries/[entryId]/share', project_id: 7, entry_id: 9 });
  });
  it('identifies the server user, resets between accounts, and deduplicates remounts', async () => {
    const { syncAnalyticsIdentity, trackScreen } = await import('../../../../frontend/src/lib/analytics.web');
    syncAnalyticsIdentity('12'); trackScreen('/app/projects/7'); trackScreen('/app/projects/7');
    expect(ph.identify).toHaveBeenCalledWith('12');
    expect(ph.capture).toHaveBeenCalledTimes(1);
    syncAnalyticsIdentity('13'); trackScreen('/app/projects/7');
    expect(ph.reset).toHaveBeenCalledTimes(1);
    expect(ph.capture).toHaveBeenCalledTimes(2);
    syncAnalyticsIdentity(null);
    expect(ph.reset).toHaveBeenCalledTimes(2);
  });
  it('preserves a returning identity across a page reload', async () => {
    ph.get_distinct_id.mockReturnValue('12');
    const mod = await import('../../../../frontend/src/lib/analytics.web');
    mod.syncAnalyticsIdentity('12');
    expect(ph.reset).not.toHaveBeenCalled();
    mod.syncAnalyticsIdentity('13');
    expect(ph.reset).toHaveBeenCalledTimes(1);
  });
  it('does not collect when disabled or interrupt navigation when the SDK fails', async () => {
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_KEY', '');
    const mod = await import('../../../../frontend/src/lib/analytics.web');
    mod.trackScreen('/app'); expect(ph.init).not.toHaveBeenCalled();
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_KEY', 'test-key');
    ph.init.mockImplementationOnce(() => { throw new Error('blocked'); });
    expect(() => mod.trackScreen('/app')).not.toThrow();
  });
  it('removes SDK URL properties and disables replay and implicit content capture', async () => {
    const mod = await import('../../../../frontend/src/lib/analytics.web'); mod.syncAnalyticsIdentity('12');
    const options = ph.init.mock.calls[0][1];
    expect(options).toMatchObject({ autocapture: false, disable_session_recording: true, capture_pageview: false });
    const event = options.before_send({ properties: { '$current_url': 'secret', '$referrer': 'private', utm_campaign: 'private', route_name: '/app' } });
    expect(event.properties).toEqual({ route_name: '/app' });
  });
});
