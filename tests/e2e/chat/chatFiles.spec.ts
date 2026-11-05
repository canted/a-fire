import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { TiptapDoc } from "../../../frontend/src/lib/tiptap";

async function fileReply(page: Page, filename: string, contentType: string, bytes: Buffer) {
  await page.addInitScript(() => localStorage.setItem("afire.preview.session", JSON.stringify({ accessToken: `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ sub: 1, exp: 4102444800 }))}.fixture`, refreshToken: "fixture-refresh" })));
  const now = new Date().toISOString();
  const replies: Array<Record<string, unknown>> = [];
  const uploads: string[] = [];
  const sent: Array<{ content: TiptapDoc }> = [];
  const viewer = { id: 1, username: "Rowan", avatar_url: null };
  const empty = { type: "doc", content: [{ type: "paragraph", content: [] }] };
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = {};
    if (path === "/api/v2/rooms") body = { rooms: [{ id: 77, name: "File Room" }] };
    else if (path === "/api/v1/rooms/77/home") body = { roomId: "77", members: [], viewer_access: { kind: "member", can_write: true, can_reply: true, entry_history: "all" } };
    else if (path === "/api/v2/rooms/77") body = { id: 77, name: "File Room", porosity: "masked", parent: null, access: { kind: "member" }, memberBoard: { id: 91 } };
    else if (path.endsWith("/chat/drafts")) body = { id: 201 };
    else if (path === "/api/v1/uploads" && request.method() === "POST") {
      uploads.push(request.postDataBuffer()!.toString());
      body = { success: 1, file: { url: "/api/v1/uploads/901", filename, byte_size: bytes.length, content_type: contentType } };
    } else if (path === "/api/v1/uploads/901") {
      await route.fulfill({ body: bytes, contentType, headers: { "content-disposition": `attachment; filename="${filename}"` } });
      return;
    } else if (path === "/api/v1/entries/74") body = {
      entry: { id: 74, status: "published", user: viewer, room_id: 77, room: { id: 77, name: "File Room" },
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A shared sketch." }] }] },
        format: "mixed_media", format_data: {}, created_at: now, viewer_access: { kind: "member", can_reply: true, can_write: true } },
      replies: { data: replies, pagination: { page: 1, per_page: 20, next_page: null } },
    };
    else if (path === "/api/v1/entries/74/replies" && request.method() === "POST") body = { id: 201, status: "draft", revision: 0, content: empty, user: viewer, created_at: now };
    else if (path === "/api/v1/entries/74/replies/201/publish") {
      const payload = request.postDataJSON().reply;
      sent.push(payload);
      body = { id: 201, status: "published", revision: 1, content: payload.content, user: viewer, created_at: now, published_at: now };
      replies.push(body as Record<string, unknown>);
    }
    else if (path.endsWith("/adjacent-rooms")) body = { can_create: false, adjacent_rooms: [] };
    else if (path.endsWith("/rounds/overview")) body = { recentRounds: [], currentRounds: [], activeRound: null, nextRound: null };
    else if (path.endsWith("/walls")) body = { walls: [] };
    else if (path.endsWith("/members")) body = { members: [] };
    else if (path.endsWith("/memberships")) body = { user: { id: 1, username: "Rowan" }, memberships: [] };
    else if (path.endsWith("/unseen/count")) body = { total: 0, entries: 0, replies: 0 };
    else if (path.endsWith("/notices")) body = { items: [], nextCursor: null };
    await route.fulfill({ json: body });
  });
  await page.goto("/app/entries/74");
  await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toBeVisible();
  return { uploads, sent };
}

for (const width of [320, 390]) {
  test(`Reply uploads and renders a generic file through its native picker at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const filename = width === 320 ? "field-notes-with-a-long-unbroken-filename-that-stays-inside-the-message.txt" : "field-notes.pdf";
    const mimeType = width === 320 ? "text/plain" : "application/pdf";
    const bytes = Buffer.from(width === 320 ? "Synthetic field notes." : "%PDF-1.4\n% Synthetic fixture only\n%%EOF");
    const fixture = await fileReply(page, filename, mimeType, bytes);
    await page.getByRole("button", { name: "Add attachment", exact: true }).click();
    const choose = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose photo or file", exact: true }).click();
    await (await choose).setFiles({ name: filename, mimeType, buffer: bytes });
    await expect(page.locator("body")).toContainText(filename);
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const link = page.getByRole("button", { name: `Download ${filename}`, exact: true });
    await expect(link).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove attachment" })).toHaveCount(0);
    expect(fixture.uploads).toHaveLength(1);
    expect(fixture.uploads[0]).toContain('name="reply_id"\r\n\r\n201');
    expect(fixture.uploads[0]).toContain('name="block_type"\r\n\r\nattach');
    expect(fixture.sent[0].content.content?.find(node => node.type === "file")).toEqual({ type: "file", attrs: { src: "/api/v1/uploads/901", filename, size: bytes.length, contentType: mimeType } });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const bounds = (await link.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(12);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 12);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    await writeFile(info.outputPath("file-attachment.json"), JSON.stringify({ request: fixture.sent[0], bounds }, null, 2));
    await page.screenshot({ path: info.outputPath(`generic-file-${width}.png`) });
    const download = page.waitForEvent("download");
    await link.click();
    const result = await download;
    expect(result.suggestedFilename()).toBe(filename);
    expect(result.url()).toMatch(/^blob:/);
    // Native downloads bypass page.route; byte/auth checks belong to upload endpoint tests.
    await result.cancel();
  });
}

test("Reply paste uses the same file attachment path and retains the plain caption", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const filename = "pasted-notes.txt";
  const bytes = Buffer.from("Synthetic pasted notes.");
  const fixture = await fileReply(page, filename, "text/plain", bytes);
  const editor = page.getByRole("textbox", { name: "Reply", exact: true });
  await editor.fill("A caption for the file");
  await editor.evaluate((element, values) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([values.text], values.filename, { type: "text/plain" }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, { text: bytes.toString(), filename });
  await expect(page.locator("body")).toContainText(filename);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: `Download ${filename}`, exact: true })).toBeVisible();
  expect(fixture.sent[0].content.content?.[0]).toEqual({ type: "paragraph", content: [{ type: "text", text: "A caption for the file" }] });
  expect(fixture.sent[0].content.content?.filter(node => node.type === "file")).toHaveLength(1);
  expect(fixture.uploads).toHaveLength(1);
});
