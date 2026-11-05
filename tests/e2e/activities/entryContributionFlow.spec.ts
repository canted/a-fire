import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { E2E_MEMBER_EMAIL } from "../config";
import { createUserCommunityFixture } from "../fixtures/factory";
import { prisma } from "../fixtures/database";

test.use({ serviceWorkers: "block" });
test.beforeEach(({ page }) => { page.setDefaultTimeout(15000); });

async function activityFixture(template: "feedback" | "art_before_chorus") {
  const suffix = crypto.randomUUID().slice(0, 8);
  const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: `Entry contribution ${suffix}`, skipEmailCleanup: true });
  const now = new Date(), stamp = { created_at: now, updated_at: now };
  const activity = await prisma.round.create({ data: { ...stamp, room_id: fixture.roomId, host_id: fixture.userId, name: `Small sounds ${suffix}`, prompt: `Start from a sound you noticed today ${suffix}.`, status: "active", template_key: template, template_config: template === "art_before_chorus" ? { responseFormat: "audio_text", sketchSize: "tiny" } : {}, started_at: now, submit_by: new Date(+now + 86_400_000), feedback_due_at: new Date(+now + 172_800_000) } });
  await prisma.activityParticipation.create({ data: { ...stamp, round_id: activity.id, user_id: fixture.userId, role: "participant", status: "active", joined_at: now } });
  return { ...fixture, round: activity, suffix, stamp };
}

test("creates a title-only round entry and independently copies a private project entry", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await activityFixture("feedback");
  const newTitle = `Only a title ${fixture.suffix}`;
  const route = `/app/rounds/${fixture.round.id}`;
  await page.goto(route);
  await expect(page.getByText(fixture.round.prompt!, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Share something", exact: true }).click();
  await expect(page.getByText(fixture.round.prompt!, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Private studies ${fixture.roomId}`, exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Submit Round contribution", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(newTitle);
  await page.getByRole("button", { name: "Submit Round contribution", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/rounds/${fixture.round.id}$`));
  const firstPostId = (await prisma.activityParticipation.findFirstOrThrow({ where: { round_id: fixture.round.id, user_id: fixture.userId } })).submitted_entry_id!;
  await page.goto(`/app/entries/${firstPostId}`);
  await expect(page.getByText(newTitle, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(newTitle, { exact: true })).toBeVisible();
  expect(await prisma.entry.findUniqueOrThrow({ where: { id: firstPostId } })).toMatchObject({ status: "published", round_id: fixture.round.id, format: "mixed_media", format_data: { title: newTitle } });

  const project = await prisma.project.create({ data: { ...fixture.stamp, owner_id: fixture.userId, name: `Private studies ${fixture.suffix}` } });
  const source = await prisma.entry.create({ data: { ...fixture.stamp, user_id: fixture.userId, project_id: project.id, creation_origin: "project_material", status: "published", published_at: new Date(), format: "mixed_media", project_intent: "The private version", project_question: "A question kept in the project" } });
  const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `The original body ${fixture.suffix}` }] }] };
  const sourceDocument = await prisma.document.create({ data: { ...fixture.stamp, docable_type: "Post", docable_id: source.id, content } });
  await page.goto(route);
  await page.getByRole("button", { name: "Change submission", exact: true }).click();
  await page.getByRole("button", { name: project.name, exact: true }).click();
  await page.getByRole("button", { name: "Choose this", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("The private version");
  await expect(page.locator("[contenteditable=true]")).toContainText(`The original body ${fixture.suffix}`);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("The room version");
  await page.locator("[contenteditable=true]").fill("A body written for this room copy");
  await page.getByRole("button", { name: "Publish Round contribution", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/rounds/${fixture.round.id}$`));
  const copyId = (await prisma.activityParticipation.findFirstOrThrow({ where: { round_id: fixture.round.id, user_id: fixture.userId } })).submitted_entry_id!;
  await page.goto(`/app/entries/${copyId}`);
  await expect(page.getByText("The room version", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("A body written for this room copy", { exact: true })).toBeVisible();
  expect(copyId).not.toBe(source.id);
  expect(await prisma.entry.findUniqueOrThrow({ where: { id: copyId } })).toMatchObject({ source_entry_id: source.id, project_id: null, room_id: fixture.roomId, status: "published", round_id: fixture.round.id });
  expect(await prisma.entry.findUniqueOrThrow({ where: { id: source.id } })).toMatchObject({ project_id: project.id, room_id: null, project_intent: "The private version", project_question: "A question kept in the project" });
  expect(await prisma.document.findUniqueOrThrow({ where: { id: sourceDocument.id } })).toMatchObject({ content });
});

test("uses the same entry editor restricted to image uploads in a cover phase", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await activityFixture("art_before_chorus");
  await page.goto(`/app/rounds/${fixture.round.id}`);
  await expect(page.getByText(fixture.round.prompt!, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pin up an image", exact: true }).click();
  await page.getByRole("button", { name: "Share something new", exact: true }).click();
  await page.getByRole("button", { name: `Private studies ${fixture.roomId}`, exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText(fixture.round.prompt!, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Body", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Record audio", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Submit Round contribution", exact: true })).toBeDisabled();
  const invalidFile = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach file", exact: true }).click();
  await (await invalidFile).setFiles({ name: "wrong.wav", mimeType: "audio/wav", buffer: Buffer.from("invalid contribution kind") });
  await expect(page.getByText("Choose image media for this contribution.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit Round contribution", exact: true })).toBeDisabled();
  const photo = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose photo", exact: true }).click();
  await (await photo).setFiles(resolve("frontend/.storybook/assets/wall-spunky.jpg"));
  await page.getByRole("button", { name: "Submit Round contribution", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your cover is in", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your cover is in", exact: true })).toBeVisible();
  const cover = await prisma.activityArtifact.findFirstOrThrow({ where: { round_id: fixture.round.id, user_id: fixture.userId, kind: "cover", status: "active" } });
  const post = await prisma.entry.findUniqueOrThrow({ where: { id: cover.entry_id } });
  expect(post).toMatchObject({ status: "draft", creation_origin: "round_activity_cover", format: "mixed_media", room_id: fixture.roomId });
  expect(await prisma.activeStorageAttachment.count({ where: { record_type: "Post", record_id: post.id } })).toBeGreaterThan(0);
  const doc = await prisma.document.findFirstOrThrow({ where: { docable_type: "Post", docable_id: post.id } });
  expect(doc.content).toMatchObject({ type: "doc", content: [expect.objectContaining({ type: "image" })] });
  const image = page.getByRole("img", { name: "Cover art" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});

test("reopens generic and cover drafts from their saved activity metadata", async ({ page }) => {
  test.setTimeout(90_000);
  for (const template of ["feedback", "art_before_chorus"] as const) {
    const fixture = await activityFixture(template);
    const isCover = template === "art_before_chorus";
    const draft = await prisma.entry.create({ data: {
      ...fixture.stamp, user_id: fixture.userId,
      room_id: fixture.roomId, round_id: fixture.round.id, source_entry_id: fixture.sourceEntryId,
      status: "draft", format: "mixed_media",
      creation_origin: isCover ? "round_activity_cover" : null,
      format_data: isCover ? {} : { title: "An entry to return to" },
    } });
    await prisma.document.create({ data: { ...fixture.stamp, docable_type: "Post", docable_id: draft.id, content: { type: "doc", content: [{ type: "paragraph", content: [] }] } } });
    // No activityId or square_id query parameter: the route must restore its context from the draft.
    await page.goto(`/app/new-entry?draftId=${draft.id}`);
    await expect(page.getByText(fixture.round.prompt!, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Share something", exact: true })).toHaveCount(0);
    if (isCover) {
      await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "Body", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Choose photo", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Record audio", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Publish Round contribution", exact: true })).toBeDisabled();
    } else {
      await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("An entry to return to");
      await expect(page.locator("[contenteditable=true]")).toBeVisible();
    }
  }
});
