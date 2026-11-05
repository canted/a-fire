import { audioTimestampTarget, buildAudioTimestampDoc } from "../../../../frontend/src/lib/audioTimestamp";

describe("audioTimestamp", () => {
  it("builds timestamp replies as an inline audio mention chip", () => {
    expect(
      buildAudioTimestampDoc({
        href: "/app/entries/107?audio=11&t=2.6",
        seconds: 2.6,
        audioAssetId: "11",
        title: "Bridge idea",
      }),
    ).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "audioTimestamp",
              attrs: {
                audioAssetId: "11",
                audioNodeId: null,
                sourcePath: "/app/entries/107?audio=11&t=2.6",
                title: "Bridge idea",
                seconds: 2.6,
                nodeId: null,
              },
            },
            { type: "text", text: " " },
          ],
        },
      ],
    });
  });
});

it('parses the shared timestamp URL contract without accepting invalid asset ids', () => {
  expect(audioTimestampTarget(new URLSearchParams('audio=11&t=2.66&audioNode=phrase-2'))).toEqual({ audioAssetId: '11', seconds: 2.7, audioNodeId: 'phrase-2' });
  expect(audioTimestampTarget(new URLSearchParams('audio=javascript:bad&t=4'))).toBeNull();
  expect(audioTimestampTarget(new URLSearchParams('audio=11&t=-4'))?.seconds).toBe(0);
});
