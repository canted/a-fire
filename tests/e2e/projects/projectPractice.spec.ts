import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { E2E_MEMBER_EMAIL } from "../config";
import { createUserCommunityFixture } from "../fixtures/factory";
import { attachComposerFile } from "../fixtures/composition";
import { prisma } from "../factories";

test("keeps private practice, circle copies, and retained feedback independent", async ({ page }) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const suffix = crypto.randomUUID().slice(0, 8);
  const targetRoomName = `Practice circle ${suffix}`;
  const fixture = await createUserCommunityFixture({
    email: E2E_MEMBER_EMAIL, roomName: targetRoomName, boardName: "Latest Posts", skipEmailCleanup: true,
  });
  const projectName = `Evening sketches ${suffix}`;
  const material = `Leave more space before the chorus ${suffix}`;
  const privateIntent = "Try a quieter bass line";

  const feedback = `The pause makes the vocal clearer ${suffix}`;

  await page.goto("/app");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByRole("textbox", { name: "Project name", exact: true }).fill(projectName);
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/projects\/\d+$/);
  const projectId = Number(new URL(page.url()).pathname.split("/").pop());
  await expect(page.getByRole("heading", { name: projectName, exact: true })).toBeVisible();
  const timeline = page;
  await page.getByRole("button", { name: "Add entry", exact: true }).click();
  await page.getByRole("textbox", { name: "Body", exact: true }).fill(material);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(privateIntent);
  await attachComposerFile(page, resolve("frontend/.storybook/assets/wall-study.jpg"));
  await page.getByRole("button", { name: "Done editing", exact: true }).click();
  await expect(page).toHaveURL(`/app/projects/${projectId}`);
  await expect(timeline.getByText(material, { exact: true })).toBeVisible();
  const entry = await prisma.entry.findFirstOrThrow({
    where: { project_id: projectId, user_id: fixture.userId, creation_origin: "project_material", status: "published" },
  });
  expect(entry).toMatchObject({ room_id: null, project_intent: privateIntent, format: "mixed_media" });
  expect(await prisma.projectRoom.count({ where: { project_id: projectId } })).toBe(0);
  const sourceAttachment = await prisma.activeStorageAttachment.findFirstOrThrow({ where: { record_type: "Post", record_id: entry.id } });

  await timeline.getByRole("button", { name: "Entry options" }).click();
  await page.getByRole("menuitem", { name: "Share with a room", exact: true }).click();
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page.getByRole("menuitem", { name: targetRoomName, exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Title", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Body", exact: true })).toBeChecked();
  await page.getByRole("button", { name: `Share in ${targetRoomName}`, exact: true }).click();
  await expect(page).toHaveURL(`/app/rooms/${fixture.roomId}`);
  const publishedCopy = await prisma.entry.findFirstOrThrow({ where: { source_entry_id: entry.id, room_id: fixture.roomId, status: "published" } });
  const circlePostId = publishedCopy.id;
  await page.goto(`/app/entries/${circlePostId}`);
  const circlePost = await prisma.entry.findUniqueOrThrow({ where: { id: circlePostId } });
  expect(circlePost).toMatchObject({ project_id: null, room_id: fixture.roomId, source_entry_id: entry.id, status: "published" });
  const copiedAttachment = await prisma.activeStorageAttachment.findFirstOrThrow({ where: { record_type: "Post", record_id: circlePostId } });
  expect(copiedAttachment.id).not.toBe(sourceAttachment.id);
  expect(await prisma.entry.findUniqueOrThrow({ where: { id: entry.id } })).toMatchObject({ project_intent: privateIntent });

  await page.getByRole("textbox", { name: "Reply", exact: true }).fill(feedback);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator('[id^="reply-"]').getByText(feedback, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save replies to source", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove saved replies from source" })).toBeVisible();
  await page.goto(`/app/projects/${projectId}`);
  await expect(timeline.getByText(feedback, { exact: false })).toBeVisible();
  await expect(timeline.getByText(privateIntent, { exact: true })).toBeVisible();
  await timeline.getByText(feedback, { exact: false }).click();
  await expect(page).toHaveURL(new RegExp(`/app/entries/${circlePostId}(#reply-\\d+)?$`));
  await page.goto(`/app/projects/${projectId}`);

  const reply = await prisma.reply.findFirstOrThrow({ where: { entry_id: circlePostId, status: "published" } });
  await prisma.reply.update({ where: { id: reply.id }, data: { status: "deleted" } });
  await page.reload();
  await expect(timeline.getByText(feedback, { exact: false })).toBeVisible();
  // Retained feedback remains readable after its original reply is withdrawn.
  expect(await prisma.entry.count({ where: { project_id: projectId, source_reply_id: reply.id, creation_origin: "project_feedback" } })).toBe(1);
});
