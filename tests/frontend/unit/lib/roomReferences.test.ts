import { sessionReturnPath, safeRoomReturn } from '../../../../frontend/src/lib/roomLinks';
import { describe, expect, it } from "vitest";
import { mentionDocument } from "../../../../frontend/src/lib/plainMentionDraft";
import { externalPreviewUrl, firstLinkPreviewUrl } from "../../../../frontend/src/lib/linkPreviewDetection";

describe("Room text and references", () => {
  it("keeps URL anchors and punctuation while turning plain text into links", () => {
    const document = mentionDocument({ text: "Look https://example.com/work#detail.\nThen talk.", mentions: [] });
    expect(document.content?.[0].content).toEqual([
      { type: "text", text: "Look " },
      { type: "text", text: "https://example.com/work#detail", marks: [{ type: "link", attrs: { href: "https://example.com/work#detail" } }] },
      { type: "text", text: "." }, { type: "hardBreak" }, { type: "text", text: "Then talk." },
    ]);
    expect(firstLinkPreviewUrl(document)).toBe("https://example.com/work");
  });
  it("never scrapes app references for private metadata", () => {
    expect(externalPreviewUrl("https://a-fire.example/app/projects/12")).toBeNull();
    expect(externalPreviewUrl("https://a-fire.example/app/entries/12")).toBeNull();
    expect(externalPreviewUrl("javascript:alert(1)")).toBeNull();
    expect(externalPreviewUrl("https://example.com/art")).toBe("https://example.com/art");
  });
});

import { isRoomNavigation } from "../../../../frontend/src/lib/roomNavigationMotion";
it("animates entering Rooms but preserves the same-room drawer transition", () => {
  expect(isRoomNavigation("/app", "/app/rooms/7")).toBe(true);
  expect(isRoomNavigation("/app/rooms/7/chat", "/app/rooms/8")).toBe(true);
  expect(isRoomNavigation("/app/rooms/7", "/app/rooms/7/chat")).toBe(false);
  expect(isRoomNavigation("/app/rooms/7/chat?message=3", "/app/rooms/7")).toBe(false);
});

it("preserves the exact Room source draft through authentication and rejects ambiguous source references", async () => {
  const { safeRoomReturn, sessionReturnPath } = await import("../../../../frontend/src/lib/roomLinks");
  const path = "/app/rooms/7/new-entry?sourceProject=12&sourceEntry=41";
  expect(safeRoomReturn(path)).toBe(path);
  expect(safeRoomReturn(`${path}&shareStarted=1`)).toBe(`${path}&shareStarted=1`);
  expect(safeRoomReturn(`${path}&shareStarted=2`)).toBe("/app");
  expect(sessionReturnPath("/app/rooms/7/new-entry", { sourceProject: "12", sourceEntry: "41" })).toBe(path);
  expect(safeRoomReturn(`${path}&sourceEntry=42`)).toBe("/app");
  expect(safeRoomReturn("/app/rooms/7/new-entry?sourceEntry=41")).toBe("/app");
  expect(safeRoomReturn(`${path}&next=https://example.com`)).toBe("/app");
});

it("keeps selective-share recovery addresses through sign-in", async () => {
  const { safeRoomReturn, sessionReturnPath } = await import("../../../../frontend/src/lib/roomLinks");
  const path = "/app/projects/12/entries/41/share";
  expect(safeRoomReturn(path)).toBe(path);
  expect(sessionReturnPath(path, { request: "request-1234", room: "7" })).toBe(`${path}?request=request-1234&room=7`);
  expect(safeRoomReturn(`${path}?request=request-1234&request=request-5678`)).toBe("/app");
  expect(safeRoomReturn(`${path}?request=request-1234&next=https://example.com`)).toBe("/app");
});

it('preserves entry allocation identity through Room and Round authentication', () => {
  const params = { sourceRequest: 'stable-source-request', sourceProject: '12', sourceEntry: '41' };
  for (const path of ['/app/rooms/7/new-entry', '/app/rounds/9', '/app/rooms/2/new-entry']) {
    expect(sessionReturnPath(path, params)).toBe(`${path}?sourceRequest=stable-source-request&sourceProject=12&sourceEntry=41`);
  }
  expect(safeRoomReturn('/app/rooms/7/new-entry?sourceRequest=stable-source-request')).toContain('sourceRequest');
  expect(safeRoomReturn('/app/rooms/7/new-entry?sourceRequest=short')).toBe('/app');
  expect(safeRoomReturn('/app/rooms/7/new-entry?sourceEntry=41')).toBe('/app');
});

it('preserves the exact Round contribution phase and rejects invalid phases', () => {
  expect(sessionReturnPath('/app/rounds/9', { contribution: 'cover', entryMode: 'new', sourceRequest: 'stable-source-request', sourceProject: '12', sourceEntry: '41' })).toBe('/app/rounds/9?contribution=cover&entryMode=new&sourceRequest=stable-source-request&sourceProject=12&sourceEntry=41');
  expect(safeRoomReturn('/app/rounds/9?contribution=unknown')).toBe('/app');
});

it('preserves the prepared Round copy through sign-in without accepting duplicate or invalid identities', () => {
  const path = '/app/rounds/9';
  expect(sessionReturnPath(path, { contribution: 'submission', entryMode: 'project', contributionDraft: '71' })).toBe(`${path}?contribution=submission&contributionDraft=71&entryMode=project`);
  expect(safeRoomReturn(`${path}?contributionDraft=71&contributionDraft=72`)).toBe('/app');
  expect(safeRoomReturn(`${path}?contributionDraft=9007199254740992`)).toBe('/app');
});

it('retains pending Chat project creation through authentication without accepting arbitrary return fields', () => {
  const path = '/app/rooms/7/chat/messages/12/save';
  expect(sessionReturnPath(path, { request: 'stable-chat-save-request', newProject: '1' })).toBe(`${path}?newProject=1&request=stable-chat-save-request`);
  expect(safeRoomReturn(`${path}?request=short`)).toBe('/app');
  expect(safeRoomReturn(`${path}?request=stable-chat-save-request&request=another-save-request`)).toBe('/app');
  expect(safeRoomReturn(`${path}?newProject=2`)).toBe('/app');
});
