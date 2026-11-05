import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createUserCommunityFixture, ensureUser } from "../fixtures/factory";
import { prisma } from "../fixtures/database";
import { attachComposerFile, openRoomComposer, chooseSaveProject } from "../fixtures/composition";
import { E2E_MEMBER_EMAIL } from "../config";

test.use({ serviceWorkers: "block", actionTimeout: 15_000 });

test("saves a message and image to a project, preserves old replies, and keeps Chat navigation independent", async ({ page }, info) => {
  test.setTimeout(90_000);
  const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, username: "Rowan", roomName: `Chat save ${crypto.randomUUID()}`, skipEmailCleanup: true });
  await prisma.room.update({ where: { id: fixture.roomId }, data: { name: "Small Hours" } });
  await prisma.user.update({ where: { id: fixture.userId }, data: { username: "Rowan" } });
  const now = new Date(), stamp = { created_at: now, updated_at: now };
  const peer = await ensureUser(`chat-save-mira-${fixture.roomId}@example.test`, "Mira");
  await prisma.roomMembership.create({ data: { ...stamp, user_id: peer, room_id: fixture.roomId } });
  await prisma.project.deleteMany({ where: { owner_id: fixture.userId, name: "Evening studies" } });
  const project = await prisma.project.create({ data: { ...stamp, owner_id: fixture.userId, name: "Evening studies" } });
  const pendingProject = await prisma.project.create({ data: { ...stamp, owner_id: peer, name: "Unaccepted invitation" } });
  await prisma.projectParticipation.create({ data: { ...stamp, project_id: pendingProject.id, user_id: fixture.userId, invited_by_id: peer, status: "pending", invited_at: now } });
  const message = await prisma.chatMessage.create({ data: { ...stamp, room_id: fixture.roomId, author_id: peer, body: "The longer pause leaves room for the cello.", masked_alias: "", fire_at: new Date(+now + 7 * 86400000), expires_at: new Date(+now + 14 * 86400000), pinned_at: now, pinned_by_id: fixture.userId } });
  const reply = await prisma.reply.create({ data: { ...stamp, chat_message_id: message.id, user_id: fixture.userId, status: "published" } });
  await prisma.document.create({ data: { ...stamp, docable_type: "Reply", docable_id: reply.id, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "I kept the quieter take." }] }] } } });
  const captures = resolve(".impeccable/review");
  await mkdir(captures, { recursive: true });
  const capture = async (name: string) => {
    if (info.project.name === "chromium") {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: resolve(captures, `${name}.png`), animations: "disabled" });
    }
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/rooms/${fixture.roomId}/chat`);
  const row = page.locator(`#chat-${message.id}`);
  const editor = page.getByRole("textbox", { name: "Message Small Hours" });
  await expect(row.getByText(message.body)).toBeVisible();
  await expect(page.getByRole("link", { name: /^Home/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Pin up|Unpin|replies.*thread/i })).toHaveCount(0);
  // Chat intentionally supports text only; existing attachment messages remain readable and saveable.
  await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
  await expect(editor).toBeVisible();
  await capture("mobile");
  const chooseProject = () => chooseSaveProject(page, project.name);
  const openPicker = async () => {
    await row.locator('[aria-label="Message. Swipe right or press Right Arrow to reveal Save to project"]').press("ArrowRight");
    await row.getByRole("button", { name: /^Save revealed message \d+ to project$/ }).click();
    await expect(page.getByRole("dialog", { name: "Save to project" })).toBeVisible();
  };
  await openPicker();
  await expect(page.getByRole("button", { name: "Unaccepted invitation" })).toHaveCount(0);
  await capture("picker-390");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row.locator('[aria-label="Message. Swipe right or press Right Arrow to reveal Save to project"]')).toBeFocused();
  expect(await prisma.entry.count({ where: { project_id: project.id } })).toBe(0);
  await openPicker();
  await page.setViewportSize({ width: 320, height: 740 });
  await capture("user-320");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.route(`**/v1/projects/${project.id}/keep`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Saving is temporarily unavailable. Try again." }) }), { times: 1 });
  await chooseProject();
  await expect(page.getByRole("alert")).toContainText("Saving is temporarily unavailable");
  await capture("error-320");
  await chooseProject();
  await expect(page.getByRole("dialog", { name: "Save to project" })).toHaveCount(0);
  const saved = await prisma.entry.findFirstOrThrow({ where: { project_id: project.id, source_chat_message_id: message.id, status: "published" } });
  expect(saved.source_author_name).toBe("Mira");
  await openPicker();
  await chooseProject();
  await expect(page.getByRole("dialog", { name: "Save to project" })).toHaveCount(0);
  expect(await prisma.entry.count({ where: { project_id: project.id, source_chat_message_id: message.id, status: "published" } })).toBe(1);
  expect(await prisma.chatMessage.findUnique({ where: { id: message.id } })).toMatchObject({ pinned_at: now, pinned_by_id: fixture.userId });
  expect(await prisma.reply.findUnique({ where: { id: reply.id } })).toMatchObject({ status: "published" });

  await page.setViewportSize({ width: 390, height: 844 });
  await openRoomComposer(page, fixture);
  await page.getByRole("textbox", { name: "Body", exact: true }).fill("The room where we recorded the quieter take.");
  await attachComposerFile(page, resolve("frontend/.storybook/assets/wall-study.jpg"));
  await page.getByRole("button", { name: /^Share in / }).click();
  await expect(page).toHaveURL(`/app/rooms/${fixture.roomId}`);
  const imageEntry = await prisma.entry.findFirstOrThrow({ where: { room_id: fixture.roomId, status: "published", id: { not: fixture.entryId } }, orderBy: { id: "desc" } });
  const imageDocument = await prisma.document.findFirstOrThrow({ where: { docable_type: "Post", docable_id: imageEntry.id } });
  // Seed an historical attachment message; new Chat uploads are no longer a product feature.
  const imageMessage = await prisma.chatMessage.create({ data: { ...stamp, room_id: fixture.roomId, author_id: fixture.userId, body: "The room where we recorded the quieter take.", content: imageDocument.content!, entry_id: imageEntry.id, masked_alias: "", fire_at: new Date(+now + 7 * 86400000), expires_at: new Date(+now + 14 * 86400000) } });
  await page.goto(`/app/rooms/${fixture.roomId}/chat`);
  const imageRow = page.locator(`#chat-${imageMessage.id}`);
  await expect(imageRow.getByText("The room where we recorded the quieter take.", { exact: true })).toBeVisible();
  await imageRow.locator('[aria-label="Message. Swipe right or press Right Arrow to reveal Save to project"]').press("ArrowRight");
  await imageRow.getByRole("button", { name: /^Save revealed message \d+ to project$/ }).click();
  await chooseProject();
  await expect(page.getByRole("dialog", { name: "Save to project" })).toHaveCount(0);
  const savedImage = await prisma.entry.findFirstOrThrow({ where: { project_id: project.id, source_chat_message_id: imageMessage.id, status: "published" } });
  expect(await prisma.activeStorageAttachment.count({ where: { record_type: "Post", record_id: savedImage.id } })).toBeGreaterThan(0);
  await page.goto(`/app/projects/${project.id}`);
  await expect(page.getByText(message.body)).toBeVisible();
  await expect(page.getByText("The room where we recorded the quieter take.")).toBeVisible();
  // Timeline feedback is deliberately compact; inspect the durable private copy for media.
  await page.goto(`/app/projects/${project.id}/entries/${savedImage.id}`);
  const image = page.getByRole("img", { name: "Attached image", exact: true }).first();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => (element instanceof HTMLImageElement ? element : element.querySelector("img"))?.naturalWidth ?? 0)).toBeGreaterThan(0);
  await capture("saved-project-390");
  await page.goto(`/app/rooms/${fixture.roomId}/chat/messages/${message.id}`);
  await expect(page.getByText("I kept the quieter take.")).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Send message|Send reply/ })).toHaveCount(0);
  await page.goto(`/app/entries/${fixture.entryId}`);
  await expect(page.getByRole("button", { name: "Add attachment" })).toBeVisible();
  await page.goto(`/app/rooms/${fixture.roomId}/chat`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(row.getByText(message.body)).toBeVisible();
  await capture("desktop");
  await openPicker();
  await capture("picker-desktop");
});
