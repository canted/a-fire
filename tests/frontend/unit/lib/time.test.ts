import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCompactRelativeTime } from "../../../../frontend/src/lib/time";

describe("formatCompactRelativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats recent times with compact units through twelve weeks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T12:00:00Z"));

    expect(formatCompactRelativeTime(new Date("2026-06-16T11:56:00Z"))).toBe("4m");
    expect(formatCompactRelativeTime(new Date("2026-06-16T08:00:00Z"))).toBe("4h");
    expect(formatCompactRelativeTime(new Date("2026-06-12T12:00:00Z"))).toBe("4d");
    expect(formatCompactRelativeTime(new Date("2026-05-19T12:00:00Z"))).toBe("4w");
    expect(formatCompactRelativeTime(new Date("2026-03-24T12:00:00Z"))).toBe("12w");
  });
});
