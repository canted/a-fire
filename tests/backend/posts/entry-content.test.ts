import { validateRoundEntryContent, validateEntryPublication } from "@server/api/v1/entries/entry-content"

const doc = (...content: unknown[]) => ({ type: "doc", content })
const text = (value: string) => ({ type: "paragraph", content: [{ type: "text", text: value }] })
const image = { type: "image", attrs: { src: "/api/v1/uploads/42" } }
const audio = { type: "audio", attrs: { audioAssetId: 7 } }
const activity = { template_key: "art_before_chorus", template_config: { responseFormat: "audio_text" } }

describe("entry publication and activity content contract", () => {
  it.each([[doc(), null], [doc(text("  ")), {}], [doc({ type: "image" }), {}]])("rejects an entirely empty entry", (content, data) => {
    expect(() => validateEntryPublication(content, "mixed_media", data)).toThrow("Add a title")
  })

  it.each([[doc(), { title: "Only a title" }], [doc(text("Only a body")), {}], [doc(image), {}], [doc(audio), {}]])("allows title, body, and attachment independently", (content, data) => {
    expect(() => validateEntryPublication(content, "mixed_media", data)).not.toThrow()
  })

  it.each([
    [doc(image, text("Hidden caption")), {}],
    [doc(image), { title: "A title" }],
    [doc(image, audio), {}],
    [doc({ type: "blockquote", content: [image, text("Nested text")] }), {}],
  ])("rejects text or other media anywhere in image-only contributions", (content, data) => {
    expect(() => validateRoundEntryContent(activity, "round_activity_cover", content, "mixed_media", data)).toThrow("images only")
  })

  it.each([
    ["round_activity_cover", "audio_text"],
    ["round_activity_response", "audio"],
    ["round_activity_response", "audio_text"],
    ["round_activity_response", "any"],
  ])("rejects mention nodes in %s with %s content restrictions", (origin, responseFormat) => {
    const contribution = doc(origin === "round_activity_cover" ? image : audio,
      { type: "paragraph", content: [{ type: "mention", attrs: { targetType: "note", targetId: "1", label: "Reference" } }] })
    expect(() => validateRoundEntryContent({ ...activity, template_config: { responseFormat } }, origin, contribution, "mixed_media", {})).toThrow()
  })

  it("accepts document images and rejects retired image cards", () => {
    expect(validateRoundEntryContent(activity, "round_activity_cover", doc(text(""), image), "mixed_media", {}).images[0]).toBe("/api/v1/uploads/42")
    expect(() => validateRoundEntryContent(activity, "round_activity_cover", doc(), "image", { image_url: "/api/v1/uploads/42" })).toThrow("Unsupported post format")
  })

  it("enforces response media constraints independently of presentation format", () => {
    expect(() => validateRoundEntryContent(activity, "round_activity_response", doc(audio, text("Lyrics")), "mixed_media", {})).not.toThrow()
    expect(() => validateRoundEntryContent(activity, "round_activity_response", doc(image), "mixed_media", {})).toThrow("audio and text only")
    const audioOnly = { ...activity, template_config: { responseFormat: "audio" } }
    expect(() => validateRoundEntryContent(audioOnly, "round_activity_response", doc(audio), "mixed_media", { title: "Small sketch" })).not.toThrow()
    expect(() => validateRoundEntryContent(audioOnly, "round_activity_response", doc(audio, text("Lyrics")), "mixed_media", {})).toThrow("audio only")
    expect(() => validateRoundEntryContent(audioOnly, "round_activity_response", doc(), "mixed_media", { title: "No audio" })).toThrow("audio only")
  })
})

it("does not treat obsolete metadata as Entry content", () => {
  expect(() => validateEntryPublication(doc(), "mixed_media", { text: "Old body", image_url: "/api/v1/uploads/42", audio_asset_id: 7 })).toThrow("Add a title");
});
