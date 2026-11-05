import { describe, expect, it } from 'vitest';
import { roomRoundsModel } from '../../../../frontend/src/lib/roomRoundsModel';
import type { RoundSummary, RoomRoundsResponse } from "../../../../frontend/src/lib/api/rounds";

const round = (id: string, extra: Partial<RoundSummary> = {}): RoundSummary => ({ id, roomId: '1', hostId: '1', name: id, status: 'active', feedbackRequest: { reply_mode: 'simple', requested_feedback_types: [], idea_guidance: null }, ...extra });
const response = (extra: Partial<RoomRoundsResponse>): RoomRoundsResponse => ({ activeRound: null, nextRound: null, recentRounds: [], ...extra });
describe('Room rounds model', () => {
  it('scopes current/recent rounds and orders participation newest first', () => {
    const data = response({ currentRounds: [round('current', { viewerContributions: [{ entryId: '3', kind: 'reply', replyId: '4', occurredAt: '2026-10-14' }] }), round('other', { roomId: '2', })], recentRounds: [round('previous', { viewerContributions: [{ entryId: '2', kind: 'submission', occurredAt: '2026-10-15' }] })] });
    const result = roomRoundsModel(data, '1', true);
    expect(result.current.map(item => item.id)).toEqual(['current']);
    expect(result.contributions.map(item => item.contribution.entryId)).toEqual(['2', '3']);
  });
  it('uses archived fallback only when history is omitted and hides personal sections from visitors', () => {
    const data = response({ activeRound: round('active'), recentRounds: [round('past', { status: 'archived', closedAt: '2026-10-14' })] });
    expect(roomRoundsModel(data, '1', true).history[0]?.label).toBe('past completed');
    expect(roomRoundsModel({ ...data, roomHistory: [] }, '1', true).history).toEqual([]);
    expect(roomRoundsModel(data, '1', false).history).toEqual([]);
    expect(roomRoundsModel(data, '1', false).contributions).toEqual([]);
  });
  it('uses bounded previews and exposes history only to authorized full-history visitors', () => {
    const data = response({ roomId: '1', currentRounds: [round('current')],
      participationPreview: [{ id: '0:3', round: { id: 'current', name: 'Current' }, contribution: { entryId: '3', kind: 'submission', occurredAt: '2026-10-14' } }],
      roomHistory: [{ id: 'event', label: 'Completed', occurredAt: '2026-10-14' }],
      viewerAccess: { kind: 'visitor', canParticipate: false, scope: 'all' },
    });
    expect(roomRoundsModel(data, '1', true).contributions).toEqual(data.participationPreview);
    expect(roomRoundsModel(data, '1', false).history).toEqual(data.roomHistory);
    expect(roomRoundsModel(data, '1', false).contributions).toEqual([]);
    expect(roomRoundsModel({ ...data, viewerAccess: { kind: 'visitor', canParticipate: false, scope: 'active_published_only' } }, '1', false).history).toEqual([]);
    expect(roomRoundsModel(data, '2', true)).toEqual({ current: [], all: [], contributions: [], history: [] });
  });

});
