import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, E2E_API_ORIGIN } from "../config";
import { createUserCommunityFixture } from "../fixtures/factory";
import { prisma } from "../fixtures/database";
import { publishRoundWall } from "../../../server/api/v1/rounds/publish-round-wall";
import { syncRoundChat } from "../../../server/api/v1/rounds/round-chat";

test.use({ serviceWorkers: "block", actionTimeout: 15_000 });
test.afterAll(async () => { await prisma.$disconnect(); });

async function roomFixture() {
  return createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: `Wall ${crypto.randomUUID()}`, skipEmailCleanup: true });
}
async function completedRound(room: Awaited<ReturnType<typeof roomFixture>>, name: string, age = 0) {
  const now = new Date(Date.now() - age), stamp = { created_at: now, updated_at: now };
  const round = await prisma.round.create({ data: { ...stamp, room_id: room.roomId, host_id: room.userId, name, prompt: "A small contribution, with space to listen.", status: "archived", started_at: now, closed_at: now } });
  const post = await prisma.entry.create({ data: { ...stamp, user_id: room.userId, room_id: room.roomId, source_entry_id: room.sourceEntryId, round_id: round.id, status: "published", published_at: now } });
  await prisma.document.create({ data: { ...stamp, docable_type: "Post", docable_id: post.id, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `A contribution for ${name}` }] }] } } });
  await prisma.activityParticipation.create({ data: { ...stamp, round_id: round.id, user_id: room.userId, role: "participant", submitted_entry_id: post.id, joined_at: now } });
  await prisma.$transaction(tx => publishRoundWall(tx, round.id));
  return round;
}
async function refreshWalls(page: Page, roomId: number) {
  return page.evaluate(async ({ id, origin }) => {
    const response = await fetch(`${origin}/api/v1/rooms/${id}/walls`, { headers: { Authorization: `Bearer ${JSON.parse(localStorage.getItem("afire.preview.session") || "null")?.accessToken}` } });
    if (!response.ok) throw new Error(`Wall read failed: ${response.status}`);
    return response.json();
  }, { id: roomId, origin: E2E_API_ORIGIN });
}

test("Rounds keeps Start round below the empty state and its back control goes to the same room", async ({ page }, info) => {
  test.setTimeout(45_000);
  const room = await roomFixture();
  const otherRoom = await roomFixture();
  const chat = `/app/rooms/${room.roomId}`;
  const rounds = `/app/rooms/${room.roomId}/rounds`;
  await page.goto(`/app/rooms/${otherRoom.roomId}/chat`);
  await page.goto(rounds);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const empty = page.getByText(/No current rounds/);
    const start = page.getByRole("button", { name: "Start round", exact: true });
    await expect(start).toHaveCount(1);
    await expect(empty).toBeVisible();
    const emptyBox = (await empty.boundingBox())!;
    const startBox = (await start.boundingBox())!;
    expect(startBox.y).toBeGreaterThanOrEqual(emptyBox.y + emptyBox.height);
    await expect(page.getByRole("button", { name: "Open wall" })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`rounds-empty-app-${width}.png`) });
  }
  await page.getByRole("button", { name: "Back to Room" }).click();
  await expect(page).toHaveURL(new RegExp(`${chat}$`));
  await page.goBack(); await expect(page).toHaveURL(new RegExp(`/app/rooms/${otherRoom.roomId}/chat$`));
  await page.goto(chat);
  await page.getByRole("button", { name: "Open Room details", exact: true }).click();
  await page.getByRole("button", { name: "Rounds", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${rounds}$`));
  await page.getByRole("button", { name: "Back to Room" }).click();
  await expect(page).toHaveURL(new RegExp(`${chat}$`));
  await page.goto(rounds);
  await page.getByRole("button", { name: "Start round", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/rooms/${room.roomId}/rounds/new$`));
});

test("dismissal records only the displayed collection across contexts; later collections do not interrupt Chat", async ({ page, browser }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const room = await roomFixture();
  const first = await completedRound(room, "First published wall", 60_000);
  await page.goto(`/app/rooms/${room.roomId}`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Round history", exact: true }).click();
  await expect(page.getByRole("heading", { name: first.name })).toBeVisible();
  const later = await completedRound(room, "A later published wall");
  const list = await refreshWalls(page, room.roomId);
  const firstWall = list.walls.find((wall: { roundId: string }) => wall.roundId === String(first.id));
  const laterWall = list.walls.find((wall: { roundId: string }) => wall.roundId === String(later.id));
  await page.getByRole("button", { name: "Back to room", exact: true }).click();
  await expect.poll(() => prisma.roundResultPresentation.count({ where: { user_id: room.userId, round_result_id: Number(firstWall.id) } })).toBe(1);
  expect(await prisma.roundResultPresentation.count({ where: { user_id: room.userId, round_result_id: Number(laterWall.id) } })).toBe(0);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  const editor = page.locator('#viewport-toolbar:visible').getByRole("textbox");
  await editor.fill("An unfinished thought");
  await page.waitForTimeout(16_000); // One real wall-list refresh, without a mock transport.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor).toHaveValue("An unfinished thought");
  const other = await browser.newContext({ storageState: await page.context().storageState(), reducedMotion: "reduce" });
  try {
    const second = await other.newPage();
    await second.goto(`/app/rooms/${room.roomId}/round-history`);
    await expect(second.getByRole("heading", { name: later.name })).toBeVisible();
    await second.getByRole("button", { name: "Back to room", exact: true }).click();
    await expect.poll(() => prisma.roundResultPresentation.count({ where: { user_id: room.userId, round_result_id: Number(laterWall.id) } })).toBe(1);
    await second.reload();
    await expect(second.getByRole("button", { name: "Round history", exact: true })).toBeVisible();
    await expect(second.getByRole("dialog")).toHaveCount(0);
    await second.getByRole("button", { name: "Round history", exact: true }).click();
    await second.getByRole("button", { name: "Previous collection" }).click();
    await expect(second.getByRole("heading", { name: first.name })).toBeVisible();
    await second.goBack();
    await expect(second).toHaveURL(new RegExp(`/rooms/${room.roomId}$`));
  } finally { await other.close(); }
});

test("historical Wall notices use the Round system card and preserve exact Wall links", async ({ page }, info) => {
  test.setTimeout(45_000);
  const room = await roomFixture();
  const first = await completedRound(room, "Earlier system wall", 60_000);
  await completedRound(room, "Latest system wall");
  await syncRoundChat(prisma, first.id);
  await page.goto(`/app/rooms/${room.roomId}/chat`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/app/rooms/${room.roomId}/chat$`));
  const walls = await prisma.roundResult.findMany({ where: { room_id: room.roomId } });
  await prisma.chatMessage.updateMany({ where: { room_id: room.roomId, entry_origin: "wall_publication" }, data: { timeline_kind: "message", content: { type: "doc", content: [] }, created_at: new Date(Date.now() - 120_000) } });
  const ordinary = await prisma.chatMessage.create({ data: { room_id: room.roomId, author_id: room.userId, body: "Wall published: an ordinary authored message", created_at: new Date(), updated_at: new Date(), masked_alias: "", fire_at: new Date(Date.now() + 86_400_000), expires_at: new Date(Date.now() + 172_800_000) } });
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const authored = page.locator(`[id="chat-${ordinary.id}"]`);
  await expect(authored).toContainText("an ordinary authored message");
  await expect(authored.locator("../..").getByLabel(/avatar$/)).toBeVisible();
  const phase = page.getByRole("button", { name: `View round: ${first.name}`, exact: true }).first();
  const phaseColor = await phase.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(phaseColor).not.toBe("rgba(0, 0, 0, 0)");
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const wall of walls) {
      const link = page.getByRole("button", { name: `View wall: ${wall.title}`, exact: true });
      await expect(link).toBeVisible();
      await expect(link.getByLabel(/avatar$/)).toHaveCount(0);
      await expect(link.getByRole("heading", { name: wall.title, exact: true })).toBeVisible();
      expect(await link.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(phaseColor);
      await expect(link.locator("..").getByRole("button", { name: /save/i })).toHaveCount(0);
    }
    await page.screenshot({ path: info.outputPath(`wall-system-app-${width}.png`) });
  }
  const firstWall = walls.find(wall => wall.round_id === first.id)!;
  await page.getByRole("button", { name: `View wall: ${first.name}`, exact: true }).click();
  await expect(page.getByRole("heading", { name: first.name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close round history", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => prisma.roundResultPresentation.count({ where: { user_id: room.userId, round_result_id: firstWall.id } })).toBe(1);
  await page.goto(`/app/rooms/${room.roomId}/chat?wall=${firstWall.id}`);
  await expect(page.getByRole("heading", { name: first.name, exact: true })).toBeVisible();
  expect(await prisma.chatMessage.count({ where: { room_id: room.roomId, entry_origin: "wall_publication" } })).toBe(2);
});

test("the current round action stays visible through scrollback and opens joining", async ({ page }) => {
  test.setTimeout(45_000);
  const room = await roomFixture(), now = new Date(), started = new Date(+now - 3_600_000);
  const round = await prisma.round.create({ data: { created_at: started, updated_at: now, room_id: room.roomId, host_id: room.userId, name: "An ongoing small sound", prompt: "Make a short sound.", status: "active", started_at: started, submit_by: new Date(+now + 86_400_000), feedback_due_at: new Date(+now + 172_800_000) } });
  await syncRoundChat(prisma, round.id);
  for (let index = 0; index < 55; index++) await prisma.chatMessage.create({ data: { room_id: room.roomId, author_id: room.userId, body: `A thought from today ${index}.`, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `A thought from today ${index}.` }] }] }, masked_alias: "", fire_at: new Date(+now + 86_400_000), expires_at: new Date(+now + 172_800_000), created_at: new Date(+started + (index + 1) * 1000), updated_at: now } });
  await page.goto(`/app/rooms/${room.roomId}/chat`);
  const sticky = page.getByRole("button", { name: new RegExp(`${round.name}.*Join`, "i") });
  await expect(sticky).toBeVisible();
  const announcement = page.getByRole("button", { name: `View round: ${round.name}`, exact: true }).first();
  const scroller = page.getByLabel(/chat messages$/);
  for (let index = 0; index < 12 && !await announcement.count(); index++) {
    await scroller.hover(); await page.mouse.wheel(0, -1600);
    await page.waitForTimeout(300);
  }
  await announcement.scrollIntoViewIfNeeded();
  // The Round action stays available even while its announcement is visible.
  await expect(sticky).toBeVisible();
  await sticky.click();
  await expect(page.getByRole("heading", { name: round.name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "join round", exact: true }).click();
  await page.getByRole("menuitem", { name: "Join Round", exact: true }).click();
  await expect.poll(() => prisma.activityParticipation.count({ where: { round_id: round.id, user_id: room.userId, role: "participant" } })).toBe(1);
  await page.goBack();
  await expect(page.getByRole("button", { name: `${round.name} Share`, exact: true })).toBeVisible();
});


test("an old Wall announcement opens its exact entry, persists Chat replies, and keeps unavailable history", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const room = await roomFixture();
  const first = await completedRound(room, "Earlier listening wall", 60_000);
  const latest = await completedRound(room, "Latest listening wall");
  const earlierRoom = await roomFixture();
  const earliest = await completedRound(earlierRoom, "First project version", 120_000);
  const stamp = { created_at: new Date(), updated_at: new Date() };
  const project = await prisma.project.create({ data: { owner_id: room.userId, name: "Private source project", ...stamp } });
  const source = await prisma.entry.create({ data: { user_id: room.userId, project_id: project.id, creation_origin: "project_material", status: "published", ...stamp } });
  await prisma.entry.updateMany({ where: { round_id: { in: [earliest.id, first.id, latest.id] } }, data: { source_entry_id: source.id } });
  await page.goto(`/app/rooms/${room.roomId}/chat`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  const walls = await refreshWalls(page, room.roomId);
  const wall = walls.walls.find((item: { roundId: string }) => item.roundId === String(first.id));
  const oldLink = page.getByRole("button", { name: `View wall: ${first.name}`, exact: true });
  await expect(oldLink).toBeVisible();
  await oldLink.click();
  await expect(page.getByRole("heading", { name: first.name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `A contribution for ${first.name}`, exact: true }).click();
  const feedback = page.getByLabel("Discussion and replies");
  const composer = page.locator("#viewport-toolbar:visible");
  await expect(page.getByRole("heading", { name: first.name, exact: true })).toHaveCount(0);
  expect(await composer.evaluate(element => { let node = element.parentElement; while (node) { if (["auto", "scroll"].includes(getComputedStyle(node).overflowY)) return false; node = node.parentElement; } return true; })).toBe(true);
  const replyText = `I can hear the quieter phrase ${room.roomId}.`;
  await composer.getByRole("textbox", { name: "Reply", exact: true }).fill(replyText);
  await composer.getByRole("button", { name: "Send" }).click();
  await expect(feedback.getByText(replyText, { exact: true })).toBeVisible();
  await expect(feedback.locator('[id^="reply-"]')).toHaveCount(1);
  expect(await feedback.evaluate(element => element.closest("article") === null)).toBe(true);
  await composer.getByRole("button", { name: "Add attachment", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose photo or file", exact: true }).click();
  await (await chooser).setFiles(resolve("frontend/.storybook/assets/wall-spunky.jpg"));
  await composer.getByRole("button", { name: "Send" }).click();
  await expect(feedback.getByRole("img", { name: "Attached image", exact: true })).toBeVisible();
  const entry = await prisma.entry.findFirstOrThrow({ where: { round_id: first.id } });
  await expect.poll(() => prisma.reply.count({ where: { entry_id: entry.id, status: "published" } })).toBe(2);
  await composer.getByRole("button", { name: "Add attachment", exact: true }).click();
  const audioChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose photo or file", exact: true }).click();
  const audioBuffer = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=30", "-f", "mp3", "pipe:1"]);
  await (await audioChooser).setFiles({ name: "listening-reply.mp3", mimeType: "audio/mpeg", buffer: audioBuffer });
  await composer.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => prisma.reply.count({ where: { entry_id: entry.id, status: "published" } })).toBe(3);
  const audioReply = feedback.getByRole("button", { name: "Play audio", exact: true });
  await expect(audioReply).toBeVisible();
  const wallScroll = page.locator("[data-visual-viewport-scrollable]:visible");
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => wallScroll.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await audioReply.click();
  const audio = page.getByTestId("audio-player-widget");
  const position = () => audio.getByRole("slider").getAttribute("aria-valuenow").then(Number);
  await expect.poll(position).toBeGreaterThan(0);
  const initialPosition = await position();
  await composer.getByRole("textbox", { name: "Reply", exact: true }).fill("Keep this thought with the middle version");
  await page.getByRole("button", { name: "Next project contribution" }).click();
  await expect(feedback.getByText("A contribution for Latest listening wall", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next project contribution" })).toHaveCount(0);
  await expect(composer.getByRole("textbox", { name: "Reply", exact: true })).not.toHaveValue(/Keep this thought/);
  await expect(audio.getByRole("button", { name: "Pause audio" })).toBeVisible();
  await expect.poll(position).toBeGreaterThan(initialPosition);
  await page.getByRole("button", { name: "Previous project contribution" }).click();
  await expect(composer.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Keep this thought with the middle version");
  // Project navigation is scoped to this Room, even for the private project owner.
  await expect(page.getByRole("button", { name: "Previous project contribution" })).toHaveCount(0);
  await expect(page.getByText("A contribution for First project version", { exact: true })).toHaveCount(0);
  const replies = await prisma.reply.findMany({ where: { entry_id: entry.id, status: "published" } });
  expect(replies.every(reply => reply.chat_message_id === null)).toBe(true);
  await page.getByRole("button", { name: "Back to Room", exact: true }).click();
  await expect(page.getByRole("heading", { name: first.name, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "3 replies. Open thread", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close round history", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(audio.getByRole("button", { name: "Pause audio" })).toBeVisible();
  await expect.poll(position).toBeGreaterThan(initialPosition);
  await page.goto(`/app/rooms/${room.roomId}/chat?wall=${wall.id}`);
  await expect(page.getByRole("heading", { name: first.name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `A contribution for ${first.name}`, exact: true }).click();
  await expect(feedback.getByText(replyText, { exact: true })).toBeVisible();
  await expect(feedback.getByRole("img", { name: "Attached image", exact: true })).toBeVisible();
  await expect(audioReply).toBeVisible();
  await page.getByRole("button", { name: "Back to Chat", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/rooms/${room.roomId}/chat$`));
  await prisma.entry.update({ where: { id: entry.id }, data: { status: "deleted" } });
  await page.goto(`/app/rooms/${room.roomId}/chat?wall=${wall.id}`);
  await expect(page.getByText("Shared work no longer available.")).toBeVisible();
  await page.goto(`/app/rooms/${room.roomId}/chat?wall=2147483647`);
  await expect(page.getByText("This collection could not be loaded.")).toBeVisible();
  const pinResponse = await page.evaluate(async ({roomId, origin}) => fetch(`${origin}/api/v2/rooms/${roomId}/chat/messages/1/pin`, { method: "PATCH", headers: { Authorization: `Bearer ${JSON.parse(localStorage.getItem("afire.preview.session") || "null")?.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ pinned: true }) }).then(response => response.status), {roomId:room.roomId, origin:E2E_API_ORIGIN});
  expect(pinResponse).toBe(404);
});

for (const templateKey of ["feedback", "art_before_chorus"] as const) {
  test(`starts a fresh ${templateKey} round from the viewed older Wall template`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 320, height: 844 });
    const room = await roomFixture(), now = new Date();
    const members: number[] = [];
    for (let i = 0; i < 2; i++) {
      const user = await prisma.user.create({ data: { email: `wall-template-${crypto.randomUUID()}@example.invalid`, username: `Listener ${i}`, created_at: now, updated_at: now } });
      members.push(user.id);
      await prisma.roomMembership.create({ data: { user_id: user.id, room_id: room.roomId, created_at: now, updated_at: now } });

    }
    const source = await completedRound(room, "An earlier template", 60_000);
    const latest = await completedRound(room, "A different latest template");
    await prisma.round.update({ where: { id: source.id }, data: { template_key: templateKey } });
    await prisma.round.update({ where: { id: latest.id }, data: { template_key: templateKey === "feedback" ? "art_before_chorus" : "feedback" } });
    await page.goto(`/app/rooms/${room.roomId}/round-history`);
    await expect(page.getByRole("heading", { name: latest.name, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next collection", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Previous collection", exact: true }).click();
    await expect(page.getByRole("heading", { name: source.name, exact: true })).toBeVisible();
    const list = await refreshWalls(page, room.roomId);
    const wall = list.walls.find((item: { roundId: string }) => item.roundId === String(source.id));
    const url = `/app/rooms/${room.roomId}/chat?wall=${wall.id}`;
    const action = page.getByRole("button", { name: "Start another round with this template", exact: true });
    await expect(action).toBeVisible();
    const box = await action.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(320); expect(box!.height).toBeLessThanOrEqual(64);
    if (templateKey === "feedback") {
      await prisma.round.update({ where: { id: source.id }, data: { template_key: "retired-template" } });
      await page.goto(url);
      await expect(page.getByText("This round’s template is no longer available. Another round cannot be started from this Wall.")).toBeVisible();
      await expect(action).toHaveCount(0);
      await prisma.round.update({ where: { id: source.id }, data: { template_key: templateKey } });
      await prisma.room.update({ where: { id: room.roomId }, data: { owner_id: members[0] } });
      await page.reload();
      await expect(page.getByRole("heading", { name: source.name, exact: true })).toBeVisible();
      await expect(action).toHaveCount(0);
      await prisma.room.update({ where: { id: room.roomId }, data: { owner_id: room.userId } });
      await page.reload();
    }
    await action.click();
    await expect(page).toHaveURL(new RegExp(`/rounds/new\\?templateKey=${templateKey}$`));
    expect(await prisma.round.count({ where: { room_id: room.roomId } })).toBe(2);
    const name = `Fresh ${templateKey} round`;
    await page.getByRole("textbox", { name: "Round name", exact: true }).fill(name);
    if (templateKey === "art_before_chorus") {
      await page.getByLabel("Submit by").fill(new Date(+now + 3 * 86_400_000).toISOString().slice(0, 16));
      await page.getByLabel("Feedback due").fill(new Date(+now + 5 * 86_400_000).toISOString().slice(0, 16));
      await page.getByRole("button", { name: "Start Round", exact: true }).click();
    } else await page.getByRole("button", { name: "Start Round", exact: true }).click();
    await expect.poll(() => prisma.round.count({ where: { room_id: room.roomId, name, status: "active", template_key: templateKey } })).toBe(1);
    const created = await prisma.round.findFirstOrThrow({ where: { room_id: room.roomId, name } });
    expect(await prisma.entry.count({ where: { round_id: created.id } })).toBe(0);
    await page.goto(url);
    await expect(page.getByRole("button", { name: "View ongoing round", exact: true })).toBeVisible();
    await expect(action).toHaveCount(0);
    await page.getByRole("button", { name: "View ongoing round", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/rounds/${created.id}$`));
  });
}


test("first publication populates history without interrupting Chat; stale exact links stay unavailable", async ({ page }) => {
  test.setTimeout(40_000);
  const room = await roomFixture();
  await page.goto(`/app/rooms/${room.roomId}/chat`);
  await expect(page.locator('#viewport-toolbar:visible').getByRole('textbox')).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const first = await completedRound(room, "The room’s first Wall");
  const list = await refreshWalls(page, room.roomId);
  const wall = list.walls.find((item: { roundId: string }) => item.roundId === String(first.id));
  // The live publication appears as a system message; it never steals Chat focus.
  await expect(page.getByRole('button', { name: `View wall: ${first.name}`, exact:true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole('button', { name: `View wall: ${first.name}`, exact:true }).click();
  await expect(page.getByRole("heading", { name: first.name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close round history", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await prisma.roundResult.delete({ where: { id: Number(wall.id) } });
  await prisma.round.update({ where: { id: first.id }, data: { status: "draft", closed_at: null } });
  await page.goto(`/app/rooms/${room.roomId}/chat?wall=${wall.id}`);
  await expect(page.getByRole("alert")).toContainText("This collection could not be loaded.");
  await expect(page.getByRole("button", { name: "Close round history", exact: true })).toBeVisible();
  const other = await createUserCommunityFixture({ roomName: `Private ${crypto.randomUUID()}` });
  const privateRound = await completedRound(other, "Another member’s private Wall");
  const privateWall = (await prisma.$transaction(tx => publishRoundWall(tx, privateRound.id)))!;
  const denied = page.waitForResponse(response => response.url().endsWith(`/walls/${privateWall.id}`) && response.status() === 403);
  await page.goto(`/app/rooms/${room.roomId}/chat?wall=${privateWall.id}`);
  await denied;
  await expect(page.getByRole("alert")).toContainText("This collection could not be loaded.");
  await expect(page.getByText(privateRound.name, { exact: true })).toHaveCount(0);
});

for (const transitions of [true, false]) {
  test(`exact collection stays modal and preserves nested pickers (${transitions ? "native transitions" : "fallback"})`, async ({ page }) => {
    test.setTimeout(40_000);
    if (!transitions) await page.addInitScript(() => { Object.defineProperty(document, "startViewTransition", { value: undefined, configurable: true }); });
    const room = await roomFixture();
    const round = await completedRound(room, "Modal boundary check");
    const wall = (await prisma.$transaction(tx => publishRoundWall(tx, round.id)))!;
    await page.goto(`/app/rooms/${room.roomId}/chat`);
    const launcher = page.getByRole('button', { name: `View wall: ${round.name}`, exact:true });
    await launcher.click();
    const wallDialog = page.getByRole("dialog").first();
    await expect(wallDialog.getByRole("heading", { name: round.name })).toBeVisible();
    await wallDialog.getByRole('button', {name:`A contribution for ${round.name}`,exact:true}).click();
    const attach = page.locator('#viewport-toolbar:visible').getByRole('button', {name:'Add attachment',exact:true});
    await attach.click();
    const picker = page.getByRole("dialog", { name: "Add attachment", exact: true });
    await expect(picker.getByRole("button", { name: "Camera", exact: true })).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(attach).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(wallDialog.getByRole('heading',{name:round.name,exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(wallDialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/rooms/${room.roomId}/chat$`));
    await expect.poll(() => prisma.roundResultPresentation.count({where:{round_result_id:wall.id,user_id:room.userId}})).toBe(1);
    await expect(page.locator('#viewport-toolbar:visible').getByRole('textbox')).toBeEditable();
  });
}

test("Chat and collection reply composers preserve responsive touch targets, multiline input and keyboard actions", async ({ page }, info) => {
  test.setTimeout(90_000);
  const room = await roomFixture();
  const round = await completedRound(room, "Composer geometry");
  const wall = (await prisma.$transaction(tx => publishRoundWall(tx, round.id)))!;
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({width,height:844});
    for (const surface of ['chat','reply']) {
      await page.goto(`/app/rooms/${room.roomId}/chat${surface === 'reply' ? `?wall=${wall.id}` : ''}`);
      if (surface === 'reply') await page.getByRole('button',{name:`A contribution for ${round.name}`,exact:true}).click();
      const toolbar=page.locator('#viewport-toolbar:visible'), input=toolbar.getByRole('textbox'), send=toolbar.getByRole('button',{name:'Send',exact:true});
      await expect(send).toBeVisible(); await expect(send).toBeDisabled();
      await input.fill('A quiet phrase.'); await expect(send).toBeEnabled();
      const single=(await input.boundingBox())!.height;
      await input.fill(Array.from({length:12},()=> 'Another line.').join('\n'));
      await expect.poll(()=>input.evaluate(element=>element.scrollHeight>element.clientHeight)).toBe(true);
      expect((await input.boundingBox())!.height).toBeGreaterThan(single);
      for (const control of await toolbar.getByRole('button').all()) {
        const box=(await control.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(width);
      }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(surface==='reply') {
        await toolbar.getByRole('button',{name:'Add attachment',exact:true}).click({position:{x:22,y:1}});
        const picker=page.getByRole('dialog',{name:'Add attachment',exact:true});
        await expect(picker.getByRole('button',{name:'Camera',exact:true})).toBeVisible();
        await page.keyboard.press('Escape'); await expect(picker).toHaveCount(0);
      }
      await input.fill('A quiet phrase.'); await input.focus(); await page.keyboard.press('Tab');
      await expect(send).toBeFocused();
      await toolbar.screenshot({path:info.outputPath(`composer-${surface}-${width}.png`)});
      await input.fill(''); await expect(send).toBeVisible(); await expect(send).toBeDisabled();
    }
    for(const [name,path] of [['View all your participation','participation'],['View Room history','history']]) {
      await page.goto(`/app/rooms/${room.roomId}/rounds`);
      const button=page.getByRole('button',{name,exact:true});
      await expect(button).toBeVisible(); const box=(await button.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(Math.min(width,760)); expect(box.height).toBeGreaterThanOrEqual(44);
      await button.focus(); await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/rooms/${room.roomId}/${path}$`));
    }
  }
});
