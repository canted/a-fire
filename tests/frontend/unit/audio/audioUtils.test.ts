import { describe, expect, it } from "vitest";
import {
  displayAudioTitle,
  formatAudioAttachmentDate,
  formatAudioShortDuration,
  formatAudioTime,
} from "../../../../frontend/src/lib/audioPresentation";

describe("audioUtils", () => {
  it("formats player timestamps", () => {
    expect(formatAudioTime(125)).toBe("2:05");
  });

  it("formats attachment dates for audio blocks", () => {
    expect(formatAudioAttachmentDate(new Date(2017, 7, 4, 12, 4))).toMatch(
      /August 4, 2017.*12:04/,
    );
    expect(formatAudioAttachmentDate("not a date")).toBeNull();
  });

  it("formats short attachment durations", () => {
    expect(formatAudioShortDuration(19_000)).toBe("19s");
    expect(formatAudioShortDuration(122_000)).toBe("2m");
    expect(formatAudioShortDuration(null)).toBeNull();
  });

  it("removes common audio filename suffixes from display titles", () => {
    expect(displayAudioTitle("Field note.m4a")).toBe("Field note");
    expect(displayAudioTitle("Field note.MP3")).toBe("Field note");
    expect(displayAudioTitle("Field note")).toBe("Field note");
  });
});
