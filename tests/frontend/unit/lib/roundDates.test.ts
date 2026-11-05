import { describe, expect, it } from 'vitest';
import { isoToLocalDateTime, localDateTimeToIso } from '../../../../frontend/src/lib/roundDates';

describe('Round local deadlines', () => {
  it('uses identical local time for web and native input separators', () => {
    const expected = new Date(2026, 9, 20, 14, 35).toISOString();
    expect(localDateTimeToIso('2026-10-20T14:35')).toBe(expected);
    expect(localDateTimeToIso('2026-10-20 14:35')).toBe(expected);
    expect(isoToLocalDateTime(expected)).toBe('2026-10-20T14:35');
  });
  it.each(['', 'not a date', '2026-02-30 12:00', '2026-13-01 12:00', '2026-10-20 24:00', '2026-10-20 12:60', '2026-10-20T12:00Z'])('rejects invalid or ambiguous input %s', value => {
    expect(localDateTimeToIso(value)).toBeNull();
  });
  it('retains leap days and safely displays missing or invalid dates', () => {
    expect(localDateTimeToIso('2028-02-29 09:00')).not.toBeNull();
    expect(isoToLocalDateTime('invalid')).toBe('');
    expect(isoToLocalDateTime(null)).toBe('');
  });
});
