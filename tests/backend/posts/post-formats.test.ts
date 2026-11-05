import { describe, expect, it } from "vitest";
import { parseEntryFormat, parseEntryFormatData } from "@server/api/v1/entries/entry-formats";

describe("post formats", () => {
  it("defaults Entries to the shared document format", () => {
    expect(parseEntryFormat(undefined)).toBe("mixed_media");
  });

  it.each(["image", "audio", "video", "link", "text"])("rejects the retired %s entry type", format => {
    expect(() => parseEntryFormat(format)).toThrow("Unsupported post format");
  });

  it("rejects unsupported formats and non-object presentation data", () => {
    expect(() => parseEntryFormat("gallery")).toThrow("Unsupported post format");
    expect(() => parseEntryFormatData([])).toThrow("Post format data must be an object");
  });
});
