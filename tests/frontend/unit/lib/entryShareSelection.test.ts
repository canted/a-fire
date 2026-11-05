import { describe, expect, it } from "vitest";
import { buildEntryShareManifest, selectEntryShare, type EntryShareSource } from "../../../../frontend/src/lib/entryShareSelection";

const source = (): EntryShareSource => ({
  revision: "source-v1", intent: "Private title", question: "Whole body", lyrics: "Lyrics",
  content: { type: "doc", content: [{ type: "blockquote", content: [
    { type: "paragraph", content: [{ type: "text", text: "Nested text" }] },
    { type: "image", attrs: { nodeId: "image-1", src: "/api/v1/uploads/1" } },
    { type: "audio", attrs: { audioAssetId: 9 } },
  ] }] },
});
const choose = (input: EntryShareSource, unitIds: string[], room = 7) => selectEntryShare(input, room, { revision: input.revision, unitIds });

describe("entry share selection", () => {
  it("uses one body unit and independent title/nested media without mutating source", () => {
    const input = source(), before = JSON.stringify(input);
    const manifest = buildEntryShareManifest(input, 7);
    expect(manifest.units.map(unit => unit.kind)).toEqual(["title", "body", "media", "media"]);
    const body = choose(input, ["body"]);
    expect(JSON.stringify(body)).toContain("Whole body");
    expect(JSON.stringify(body)).toContain("Nested text");
    expect(JSON.stringify(body)).toContain("Lyrics");
    expect(JSON.stringify(body)).not.toContain("audioAssetId");
    expect(JSON.stringify(body)).not.toContain("uploads/1");
    expect(body.format_data).toEqual({});
    expect(JSON.stringify(input)).toBe(before);
  });

  it("preserves unique node identity while guarding fallback paths with source revision", () => {
    const input = source();
    const media = buildEntryShareManifest(input, 7).units.filter(unit => unit.kind === "media");
    expect(media[0].id).toBe("media:node:image-1");
    expect(media[1].id).toMatch(/^media:path:/);
    expect(choose(input, [media[0].id]).content).toEqual({ type: "doc", content: [{ type: "image", attrs: { nodeId: "image-1", src: "/api/v1/uploads/1" } }] });
    expect(() => selectEntryShare({ ...input, revision: "source-v2" }, 7, { revision: "source-v1", unitIds: [media[1].id] })).toThrow("changed");
  });

  it("selects document audio, cover and heading into independent units and drops hidden metadata", () => {
    const input: EntryShareSource = { revision: "typed-v1", content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/2" } }, { type: "audio", attrs: { audioAssetId: 11 } }] }, format: "mixed_media",
      format_data: { title: "Song", audio_asset_id: 11, image_url: "/api/v1/uploads/2" } };
    const manifest = buildEntryShareManifest(input, 7);
    expect(manifest.units.map(unit => unit.kind)).toEqual(["title", "media", "media"]);
    const audio = manifest.units.find(unit => unit.content.content?.[0].type === "audio")!;
    const result = choose(input, [audio.id]);
    expect(result.format).toBe("mixed_media");
    expect(result.format_data).toEqual({});
    expect(JSON.stringify(result)).not.toContain("uploads/2");
    expect(JSON.stringify(result)).not.toContain('"heading"');
    expect(JSON.stringify(result)).not.toContain("Song");
  });

  it("makes document video covers separately excludable, including hidden poster attributes", () => {
    const input: EntryShareSource = { revision: "video-v1", content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/cover" } }, { type: "video", attrs: { videoAssetId: 12, poster: "/api/v1/uploads/cover" } }] }, format: "mixed_media",
      format_data: { name: "Clip", video_asset_id: 12, thumbnail_url: "/api/v1/uploads/cover" } };
    const units = buildEntryShareManifest(input, 7).units;
    const video = units.find(unit => unit.content.content?.[0].type === "video")!;
    expect(units.filter(unit => unit.kind === "media")).toHaveLength(2);
    expect(JSON.stringify(choose(input, [video.id]))).not.toContain("/api/v1/uploads/cover");
  });

  it("never includes absent, empty, repeated or unselected units", () => {
    expect(() => choose(source(), [])).toThrow("meaningful");
    expect(() => choose(source(), ["title", "title"])).toThrow("valid source");
    expect(() => choose(source(), ["invented"])).toThrow("unavailable");
    expect(buildEntryShareManifest({ revision: "empty", content: { type: "doc", content: [{ type: "paragraph" }, { type: "image", attrs: { src: "" } }] } }, 7).units).toEqual([]);
    expect(choose(source(), ["title"])).toMatchObject({ content: { type: "doc", content: [] }, format_data: { title: "Private title" } });
  });

  it("selects saved replies whole, separately from material, only with original-room authorization", () => {
    const input = source();
    input.feedback = [{ id: 21, originalRoomId: 7, authorized: true, authorName: "Artist", content: { type: "doc", content: [{ type: "audio", attrs: { audioAssetId: 99 } }] } },
      { id: 22, originalRoomId: 8, authorized: true, authorName: "Other", content: { type: "doc", content: [{ type: "text", text: "Private feedback" }] } },
      { id: 23, originalRoomId: 7, authorized: false, authorName: "Former", content: { type: "doc", content: [{ type: "text", text: "Unavailable" }] } }];
    expect(buildEntryShareManifest(input, 7).units.filter(unit => unit.kind === "feedback").map(unit => [unit.eligible, unit.unavailableReason])).toEqual([[true, undefined], [false, "different-room"], [false, "source-unavailable"]]);
    expect(choose(input, ["feedback:21"])).toMatchObject({ content: { type: "doc", content: [] }, feedback: [input.feedback[0]] });
    expect(choose(input, ["body"]).feedback).toEqual([]);
    expect(() => choose(input, ["feedback:22"])).toThrow("cannot be shared");
    expect(() => choose(input, ["feedback:23"])).toThrow("cannot be shared");
    expect(() => choose(input, ["feedback:21"], 8)).toThrow("cannot be shared");
    input.feedback[0].originalRoomIds = [7, 8];
    expect(() => choose(input, ["feedback:21"])).toThrow("cannot be shared");
  });

  it("gives duplicate legacy node identities separate revision-bound paths", () => {
    const input = source();
    input.content = { type: "doc", content: [1, 2].map(id => ({ type: "image", attrs: { nodeId: "duplicate", src: `/api/v1/uploads/${id}` } })) };
    const units = buildEntryShareManifest(input, 7).units.filter(unit => unit.kind === "media");
    expect(units.map(unit => unit.id)).toEqual(["media:path:1", "media:path:2"]);
    expect(JSON.stringify(choose(input, [units[0].id]))).not.toContain("uploads/2");
  });
});
