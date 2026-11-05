import { describe, expect, it, vi } from 'vitest';
import { captureReportProperties } from '../../../types/capture-analytics';
import { captureExperimentOutcome } from '../../../server/runtime/capture-analytics';
import { capturePosthogEvent } from '../../../server/runtime/posthog';
vi.mock('../../../server/runtime/posthog', () => ({ capturePosthogEvent: vi.fn() }));
const report = { attempt_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', project_id: 7, entry_id: 9, trigger: 'scheduled_reminder', acquisition: 'agent_capture', source: 'agent_session', outcome: 'saved', artifact_count: 2 } as const;
describe('capture experiment reporting', () => {
  it('requires consent and positive authenticated identity', () => {
    vi.mocked(capturePosthogEvent).mockClear();
    expect(captureExperimentOutcome(2, false, report)).toBe(false);
    expect(captureExperimentOutcome(0, true, report)).toBe(false);
    expect(capturePosthogEvent).not.toHaveBeenCalled();
  });
  it('reports workflow separately from acquisition and excludes arbitrary material', () => {
    expect(captureExperimentOutcome(2, true, { ...report, filename: 'private.wav', content: 'private', url: 'secret' } as any)).toBe(true);
    const event = vi.mocked(capturePosthogEvent).mock.calls.at(-1)![0];
    expect(event).toMatchObject({ distinctId: 2, event: 'capture_outcome', properties: { ...report, reported_by: 'agent' } });
    expect(JSON.stringify(event)).not.toMatch(/private|secret|filename/);
  });
  it('records no-entry outcomes and rejects invalid values', () => {
    expect(captureReportProperties({ ...report, entry_id: undefined, outcome: 'declined' })).not.toBeNull();
    expect(captureReportProperties({ ...report, entry_id: undefined })).toBeNull();
    expect(captureReportProperties({ ...report, trigger: 'anything' } as any)).toBeNull();
    expect(captureReportProperties({ ...report, duration_ms: -1 })).toBeNull();
  });
});
