import {
  formatChatTimestamp,
  formatCompactRelativeTime,
  formatRelativeTime,
  parseTimestamp,
} from "../../../../frontend/src/lib/time";

describe("time utils", () => {
  it("formats relative minutes, hours, and days", () => {
    const now = Date.now();
    const minuteAhead = new Date(now + 2 * 60 * 1000);
    const hourAhead = new Date(now + 3 * 60 * 60 * 1000);
    const dayAhead = new Date(now + 2 * 24 * 60 * 60 * 1000);

    expect(formatRelativeTime(minuteAhead)).toMatch(/minute/i);
    expect(formatRelativeTime(hourAhead)).toMatch(/hour/i);
    expect(formatRelativeTime(dayAhead)).toMatch(/day/i);
  });

  it("formats compact relative post and reply times", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));

    try {
      expect(formatCompactRelativeTime(new Date("2026-06-15T11:59:45Z"))).toBe("now");
      expect(formatCompactRelativeTime(new Date("2026-06-15T11:56:00Z"))).toBe("4m");
      expect(formatCompactRelativeTime(new Date("2026-06-15T08:00:00Z"))).toBe("4h");
      expect(formatCompactRelativeTime(new Date("2026-06-12T12:00:00Z"))).toBe("3d");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows chat clock times for 24 hours, then switches to compact age", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));

    try {
      const recent = new Date("2026-06-14T12:00:01Z");
      const oneDayOld = new Date("2026-06-14T12:00:00Z");
      const oneWeekOld = new Date("2026-06-08T12:00:00Z");

      expect(formatChatTimestamp(recent)).toBe(
        new Intl.DateTimeFormat(undefined, {
          hour: "numeric",
          minute: "2-digit",
        }).format(recent),
      );
      expect(formatChatTimestamp(oneDayOld)).toBe("1d");
      expect(formatChatTimestamp(oneWeekOld)).toBe("1w");
    } finally {
      vi.useRealTimers();
    }
  });

  it("parses dates and handles invalid values", () => {
    const date = new Date("2024-01-01T00:00:00Z");
    expect(parseTimestamp(date)).toBe(date);
    expect(parseTimestamp("2024-01-01T00:00:00Z")?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(parseTimestamp("not-a-date")).toBeNull();
  });

  it("coerces timestamps without timezone to UTC", () => {
    const parsed = parseTimestamp("2024-01-01T00:00:00");
    expect(parsed?.getTime()).toBe(new Date("2024-01-01T00:00:00").getTime());
  });
});
