import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { E2E_API_ORIGIN, E2E_MEMBER_EMAIL } from "../config";
import { createUserCommunityFixture, ensureUser } from "../fixtures/factory";
import { prisma } from "../fixtures/database";

test.use({ serviceWorkers: "block" });

test("activity replies keep media in their circle copy and save separate project objects after their source", async ({ page }) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const suffix = crypto.randomUUID().slice(0, 8);
  const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: `Entry circle ${suffix}`, skipEmailCleanup: true });
  const now = new Date();
  const stamp = { created_at: now, updated_at: now };
  const makeDocument = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  const sourceText = `A private rehearsal note ${suffix}`;
  const replyText = `The image leaves more room for the last voice ${suffix}`;
  const peerText = `Let the first pause last longer ${suffix}`;
  const peer = await ensureUser(`entry-mara-${suffix}@example.test`, "Mara");
  await prisma.roomMembership.create({ data: { ...stamp, user_id: peer, room_id: fixture.roomId, username_override: "Mara in circle" } });
  const project = await prisma.project.create({ data: { ...stamp, owner_id: fixture.userId, name: `Room score ${suffix}` } });
  const otherProject = await prisma.project.create({ data: { ...stamp, owner_id: peer, name: `Shared studies ${suffix}` } });
  await prisma.projectParticipation.create({ data: { ...stamp, project_id: otherProject.id, user_id: fixture.userId, invited_by_id: peer, status: "accepted", invited_at: now, responded_at: now } });
  const sourceEntry = await prisma.entry.create({ data: { ...stamp, user_id: fixture.userId, project_id: project.id, creation_origin: "project_material", status: "published", published_at: new Date(+now - 600_000), format: "mixed_media", project_intent: "Room study" } });
  const sourceDocument = await prisma.document.create({ data: { ...stamp, docable_type: "Post", docable_id: sourceEntry.id, content: makeDocument(sourceText) } });
  const newerEntry = await prisma.entry.create({ data: { ...stamp, user_id: fixture.userId, project_id: project.id, creation_origin: "project_material", status: "published", published_at: new Date(+now - 300_000), format: "mixed_media", project_intent: "A later entry" } });
  await prisma.document.create({ data: { ...stamp, docable_type: "Post", docable_id: newerEntry.id, content: makeDocument("Another independent entry") } });
  const activity = await prisma.round.create({ data: { ...stamp, room_id: fixture.roomId, host_id: fixture.userId, name: `Room studies ${suffix}`, status: "active", template_key: "feedback", started_at: now } });
  await prisma.entry.update({ where: { id: fixture.entryId }, data: { round_id: activity.id, source_entry_id: sourceEntry.id, project_id: null, format: "mixed_media", format_data: { title: "Room study" }, reply_mode: "guided", requested_feedback_types: ["impression"] } });
  await prisma.document.updateMany({ where: { docable_type: "Post", docable_id: fixture.entryId }, data: { content: makeDocument(sourceText) } });
  const peerReply = await prisma.reply.create({ data: { ...stamp, entry_id: fixture.entryId, user_id: peer, status: "published", published_at: now } });
  await prisma.document.create({ data: { ...stamp, docable_type: "Reply", docable_id: peerReply.id, content: makeDocument(peerText) } });

  await page.goto(`/app/entries/${fixture.entryId}`);
  const entryCard = page.locator(`#post-${fixture.entryId}`);
  const feedback = page.getByLabel("Discussion and replies", { exact: true });
  await expect(entryCard.getByRole("heading", { name: "Room study" })).toBeVisible();
  await expect(entryCard.getByText(sourceText)).toBeVisible();
  await expect(feedback.getByText(peerText)).toBeVisible();
  expect(await entryCard.evaluate(node => node.contains(document.querySelector('[aria-label="Feedback"]')))).toBe(false);
  const composer = page.getByRole("textbox", { name: "Reply", exact: true });
  await expect(composer).toBeVisible();
  await expect(page.getByLabel("Choose a feedback type")).toHaveCount(0);
  // The owner can star the author card directly; saving into another permitted
  // project must be rejected when that project does not contain the source.
  expect(await prisma.entry.count({ where: { source_reply_id: peerReply.id } })).toBe(0);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("afire.preview.session") || "null")?.accessToken);
  const retained = await page.request.post(`${E2E_API_ORIGIN}/api/v1/projects/${otherProject.id}/keep`, {
    headers: { Authorization: `Bearer ${token}` }, data: { reply_id: peerReply.id },
  });
  expect(retained.status()).toBe(400);
  expect(await retained.json()).toMatchObject({ message: "This entry has no available source in this project. Feedback cannot be assigned to a different entry." });
  expect(await prisma.entry.count({ where: { project_id: otherProject.id, source_reply_id: peerReply.id } })).toBe(0);

  await page.getByRole("button", { name: "Add attachment", exact: true }).click();
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose photo or file", exact: true }).click();
  await (await picker).setFiles(resolve("frontend/.storybook/assets/wall-study.jpg"));
  // The closing drawer retains its Modal focus trap until the exit completes.
  await expect(page.getByRole("dialog", { name: "Add attachment", exact: true })).toBeHidden();
  await composer.fill(replyText);
  await expect(composer).toHaveValue(replyText);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(feedback.getByText(replyText, { exact: true })).toBeVisible();
  const ownReply = await prisma.reply.findFirstOrThrow({ where: { entry_id: fixture.entryId, user_id: fixture.userId, status: "published" } });
  expect(ownReply.feedback_type).toBeNull();
  const replyAttachment = await prisma.activeStorageAttachment.findFirstOrThrow({ where: { record_type: "Reply", record_id: ownReply.id } });
  expect(await prisma.reply.count({ where: { entry_id: sourceEntry.id } })).toBe(0);
  expect(await prisma.document.findUniqueOrThrow({ where: { id: sourceDocument.id } })).toMatchObject({ content: makeDocument(sourceText) });
  const ownRow = page.locator(`#reply-${ownReply.id}`);
  await expect(ownRow.getByRole("img")).toBeVisible();
  const ownGroup = ownRow.locator("xpath=ancestor::*[.//button[@aria-label='Save replies to source']][1]");
  await ownGroup.getByRole("button", { name: "Save replies to source", exact: true }).click();
  await expect(ownGroup.getByRole("button", { name: "Remove saved replies from source" })).toBeVisible();
  const saved = await prisma.entry.findFirstOrThrow({ where: { project_id: project.id, source_reply_id: ownReply.id, status: "published" } });
  expect(saved).toMatchObject({ creation_origin: "project_feedback", source_entry_id: sourceEntry.id, source_shared_entry_id: fixture.entryId, room_id: null });
  const savedAttachment = await prisma.activeStorageAttachment.findFirstOrThrow({ where: { record_type: "Post", record_id: saved.id } });
  expect(savedAttachment.id).not.toBe(replyAttachment.id);
  // Re-reading the saved state must not allocate another retained block.
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove saved replies from source" })).toBeVisible();
  expect(await prisma.entry.count({ where: { project_id: project.id, source_reply_id: ownReply.id, status: "published" } })).toBe(1);

  await page.goto(`/app/projects/${project.id}`);
  const sourceCard = page.locator(`#entry-${sourceEntry.id}`);
  const savedCard = page.locator(`#entry-${saved.id}`);
  await expect(sourceCard.getByText(sourceText)).toBeVisible();
  await expect(savedCard.getByText(replyText, { exact: false })).toBeVisible();
  expect(await sourceCard.evaluate((node, savedId) => ({ inside: node.contains(document.getElementById(savedId)), follows: Boolean(node.compareDocumentPosition(document.getElementById(savedId)!) & Node.DOCUMENT_POSITION_FOLLOWING) }), `entry-${saved.id}`)).toEqual({ inside: false, follows: true });
  expect(await prisma.activeStorageAttachment.count({ where: { record_type: "Post", record_id: saved.id } })).toBe(1);
  await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveCount(0);
  await page.goto(`/app/projects/${project.id}/entries/${sourceEntry.id}`);
  await expect(page.getByText(sourceText)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add attachment" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveCount(0);
  await prisma.reply.update({ where: { id: ownReply.id }, data: { status: "deleted" } });
  await page.goto(`/app/projects/${project.id}`);
  await expect(savedCard.getByText(replyText, { exact: false })).toBeVisible();
  // Compact saved cards preserve their copied content without a separate source footer.
  expect(await prisma.activeStorageAttachment.count({ where: { record_type: "Post", record_id: saved.id } })).toBe(1);
});
