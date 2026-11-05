import { findSaveProject, chooseSaveProject } from "../fixtures/composition";
import { expect, test } from "@playwright/test";
import { faker } from "@faker-js/faker";
import { E2E_MEMBER_EMAIL } from "../config";
import { createUserCommunityFixture } from "../fixtures/factory";
import { prisma } from "../factories";

const storageStatePath = "tests/e2e/.auth/state.json";

test.describe("circle chat (Playwright)", () => {
  test.use({ storageState: storageStatePath });

  test("preserves a reading anchor through returns, history, incoming messages and viewport changes", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const name = "E2E Reading " + faker.string.uuid();
    const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: name, skipEmailCleanup: true });
    const now = new Date();
    const data = (body: string) => ({ room_id: fixture.roomId, author_id: fixture.userId, body, masked_alias: "", fire_at: new Date(+now + 7 * 86400000), expires_at: new Date(+now + 14 * 86400000), created_at: now, updated_at: now });
    await prisma.chatMessage.createMany({ data: Array.from({ length: 75 }, (_, i) => data(`Reading message ${i + 1}. Leave room for a small observation about the work in progress.`)) });
    await page.goto(`/app/rooms/${fixture.roomId}/chat`);
    const scroller = page.getByLabel(`${name} chat messages`, { exact: true });
    await expect(scroller.getByText(/Reading message 75\./)).toBeInViewport();
    // Include paginated history, not only the latest range.
    await scroller.hover();
    await expect.poll(async () => {
      await page.mouse.wheel(0, -10000);
      return scroller.getByText(/Reading message 1\./).count();
    }).toBe(1);
    const anchor = scroller.getByText(/Reading message 20\./);
    // Start a fresh user scroll before positioning the reader. History loading
    // can outlast the controller's previous wheel-interaction capture window.
    await page.mouse.wheel(0, 1);
    await anchor.evaluate(element => element.scrollIntoView({ block: "center" }));
    // History can replace the virtualized tree between resolving an element
    // handle and evaluating it. Resolve and measure together on each poll.
    const offset = () => anchor.evaluateAll(elements => {
      const element = elements[0];
      const viewport = element?.closest('[aria-label$="chat messages"]');
      return element?.isConnected && viewport
        ? element.getBoundingClientRect().top - viewport.getBoundingClientRect().top
        : null;
    });
    await page.waitForTimeout(300);
    let expectedOffset = 0;
    await expect.poll(async () => {
      const currentOffset = await offset();
      if (currentOffset !== null) expectedOffset = currentOffset;
      return currentOffset;
    }).not.toBeNull();
    const expectOffset = async () => {
      await expect.poll(async () => {
        const currentOffset = await offset();
        return currentOffset === null ? Infinity : Math.abs(currentOffset - expectedOffset);
      }).toBeLessThan(2);
    };
    const expectAnchor = async () => {
      await expectOffset();
      await expect(page.getByRole("button", { name: "Scroll to bottom", exact: true })).toBeVisible();
    };
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.getByRole("button", { name: "Open Room details" }).click();
      await page.getByRole("button", { name: "Rounds", exact: true }).click();
      await page.goBack();
      await expectAnchor();
    }
    await page.goForward();
    await page.goBack();
    await expectAnchor();
    await page.setViewportSize({ width: 390, height: 600 });
    await expectAnchor();
    await prisma.chatMessage.create({ data: data("An incoming message while reading") });
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await expect(page.getByRole("button", { name: "New messages. Scroll to bottom", exact: true })).toBeVisible();
    await expectOffset();
    await page.getByRole("button", { name: "New messages. Scroll to bottom", exact: true }).click();
    await expect(scroller.getByText("An incoming message while reading", { exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Scroll to bottom", exact: true })).toHaveCount(0);
  });

  test("receives live socket messages and recovers missed messages after reconnect", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const name = "E2E Live " + faker.string.uuid();
    const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: name, skipEmailCleanup: true });
    const senderContext = await browser.newContext({ storageState: storageStatePath, baseURL: test.info().project.use.baseURL });
    const sender = await senderContext.newPage();
    try {
      await page.goto(`/app/rooms/${fixture.roomId}/chat`);
      await sender.goto(`/app/rooms/${fixture.roomId}/chat`);
      await expect(page.getByText("No messages yet.")).toBeVisible();
      const frames: string[] = [];
      // This listener is installed before the intentional reconnect below.
      page.on("websocket", socket => socket.on("framereceived", frame => frames.push(String(frame.payload))));
      const send = async (body: string) => {
        await sender.getByRole("textbox", { name: `Message ${name}` }).fill(body);
        await sender.getByRole("button", { name: "Send", exact: true }).click();
        await expect(sender.getByLabel(/chat messages$/).getByText(body, { exact: true })).toBeVisible();
      };
      const first = "Live delivery " + faker.string.uuid();
      const started = Date.now();
      await send(first);
      await expect(page.getByLabel(/chat messages$/).getByText(first, { exact: true })).toBeVisible({ timeout: 5000 });
      console.log(`Live delivery visible within ${Date.now() - started}ms including send interaction`);
      await page.context().setOffline(true);
      await expect(page.getByText("Offline — reconnecting…")).toBeVisible();
      const missed = "While disconnected " + faker.string.uuid();
      await send(missed);
      await page.context().setOffline(false);
      await expect(page.getByLabel(/chat messages$/).getByText(missed, { exact: true })).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => frames.some(frame => frame.includes('"presence"'))).toBe(true);
      const resumed = "Live after reconnect " + faker.string.uuid();
      await send(resumed);
      await expect(page.getByLabel(/chat messages$/).getByText(resumed, { exact: true })).toBeVisible({ timeout: 5000 });
      expect(frames.some(frame => frame.includes('"message_created"'))).toBe(true);
    } finally {
      await page.context().setOffline(false);
      await senderContext.close();
    }
  });

  test("catches up a large missed burst and releases a notification anchor", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: "E2E Burst " + faker.string.uuid(), skipEmailCleanup: true });
    const now = new Date();
    const data = (body: string) => ({ room_id: fixture.roomId, author_id: fixture.userId, body, masked_alias: "", fire_at: new Date(now.getTime() + 7 * 86400000), expires_at: new Date(now.getTime() + 14 * 86400000), created_at: now, updated_at: now });
    const first = await prisma.chatMessage.create({ data: data("Anchor message") });
    const fetched = new Set<number>();
    page.on("response", async response => {
      if (response.request().method() !== "GET" || !response.url().includes(`/rooms/${fixture.roomId}/chat/messages?`)) return;
      try { const body = await response.json(); for (const message of body.messages ?? []) fetched.add(Number(message.id)); } catch { /* Context may close after an unrelated background response. */ }
    });
    await page.goto(`/app/rooms/${fixture.roomId}/chat#chat-${first.id}`);
    await expect(page.locator(`#chat-${first.id}`)).toBeVisible();
    await prisma.chatMessage.createMany({ data: Array.from({ length: 125 }, (_, i) => data(`Missed burst message ${i + 1}`)) });
    const responsePromise = page.waitForResponse(response => response.url().includes("/chat/messages?") && response.request().method() === "GET");
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    const response = await responsePromise;
    expect(response.headers()["cache-control"]).toContain("no-store");
    const scroller = page.getByLabel(/chat messages$/);
    // Virtualized rows mount only near the viewport; assert the complete fetched burst instead.
    await expect.poll(() => fetched.size).toBe(126);
    await page.getByRole("button", { name: "New messages. Scroll to bottom", exact: true }).click();
    await expect(scroller.getByText("Missed burst message 125", { exact: true })).toBeInViewport();
    await prisma.chatMessage.create({ data: data("Latest after anchor consumed") });
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await expect(scroller.getByText("Latest after anchor consumed", { exact: true })).toBeInViewport();
    await expect(page.locator(`#chat-${first.id}`)).not.toBeInViewport();
  });

  test.describe("stalled history", () => {
  // Browser routing cannot stall requests handled through a service worker in WebKit.
  test.use({ serviceWorkers: "block" });
  test("shows a fresh message while an older history request is stalled", async ({ page }) => {
    test.setTimeout(60_000);
    const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: "E2E Slow History " + faker.string.uuid(), skipEmailCleanup: true });
    const now = new Date();
    const data = (body: string) => ({ room_id: fixture.roomId, author_id: fixture.userId, body, masked_alias: "", fire_at: new Date(now.getTime() + 7 * 86400000), expires_at: new Date(now.getTime() + 14 * 86400000), created_at: now, updated_at: now });
    await prisma.chatMessage.createMany({ data: Array.from({ length: 80 }, (_, i) => data(`Historical message ${i + 1}`)) });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let stalled = false;
    await page.route("**/chat/messages?before=*", async route => {
      stalled = true;
      await gate;
      await route.continue().catch(() => undefined);
    });
    try {
      await page.goto(`/app/rooms/${fixture.roomId}/chat`);
      const scroller = page.getByLabel(/chat messages$/);
      await expect(scroller.getByText("Historical message 80", { exact: true })).toBeInViewport();
      await scroller.hover();
      await expect.poll(async () => { await page.mouse.wheel(0, -10000); return stalled; }).toBe(true);
      await prisma.chatMessage.create({ data: data("Fresh despite stalled history") });
      await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
      await expect(scroller.getByText("Fresh despite stalled history", { exact: true })).toBeAttached();
      await page.getByRole("button", { name: "New messages. Scroll to bottom", exact: true }).click();
      await expect(scroller.getByText("Fresh despite stalled history", { exact: true })).toBeInViewport();
    } finally { release(); }
  });
  });

  test("persists seen notices after viewing chat, opening a notice, and marking all read", async ({ page }) => {
    test.setTimeout(60_000);
    const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: "E2E Read " + faker.string.uuid(), skipEmailCleanup: true });
    const now = new Date();
    const message = await prisma.chatMessage.create({ data: {
      room_id: fixture.roomId, author_id: fixture.userId, body: "Read receipt " + faker.string.uuid(),
      masked_alias: "", fire_at: new Date(now.getTime() + 7 * 86400000), expires_at: new Date(now.getTime() + 14 * 86400000),
      created_at: now, updated_at: now,
    } });
    await page.goto("/app/projects");
    await expect(page.getByRole("heading", { name: "Your projects", exact: true })).toBeVisible();
    expect(await prisma.chatMessageRead.count({ where: { user_id: fixture.userId, message_id: message.id } })).toBe(0);
    await page.goto(`/app/rooms/${fixture.roomId}/chat`);
    await expect(page.locator(`#chat-${message.id}`)).toBeVisible();
    await expect.poll(() => prisma.chatMessageRead.count({ where: { user_id: fixture.userId, message_id: message.id } })).toBe(1);
    // Fanout can happen after the message was viewed: the read still applies.
    const event = await prisma.notificationEvent.create({ data: {
      event_type: "chat_message_created", actor_id: fixture.userId, room_id: fixture.roomId,
      payload: { chat_message_id: message.id }, target_path: `/app/rooms/${fixture.roomId}/chat#chat-${message.id}`,
      created_at: now, updated_at: now,
    } });
    await prisma.notificationInboxItem.create({ data: {
      user_id: fixture.userId, notification_event_id: event.id, created_at: now, updated_at: now,
    } });
    await page.goto("/app/notices");
    const room = await prisma.room.findUniqueOrThrow({ where: { id: fixture.roomId } });
    const card = page.getByRole("button").filter({ hasText: `messaged in ${room.name}` });
    await expect(card).toBeVisible();
    await expect(card).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await card.click();
    await expect(page.locator(`#chat-${message.id}`)).toBeVisible();
    // Chat notices are read through actual message exposure, not link activation.
    expect(await prisma.chatMessageRead.count({ where: { user_id: fixture.userId, message_id: message.id } })).toBe(1);
    // A fresh notice is cleared durably by mark-all too.
    const nextEvent = await prisma.notificationEvent.create({ data: {
      event_type: "chat_message_created", actor_id: fixture.userId, room_id: fixture.roomId,
      payload: {}, target_path: `/app/rooms/${fixture.roomId}/chat`, created_at: new Date(), updated_at: new Date(),
    } });
    const nextNotice = await prisma.notificationInboxItem.create({ data: {
      user_id: fixture.userId, notification_event_id: nextEvent.id, created_at: new Date(), updated_at: new Date(),
    } });
    await page.goto("/app/notices");
    await page.getByRole("button", { name: "mark all as read" }).click();
    await expect.poll(async () => (await prisma.notificationInboxItem.findUniqueOrThrow({ where: { id: nextNotice.id } })).seen_at !== null).toBe(true);
    await page.reload();
    expect((await prisma.notificationInboxItem.findUniqueOrThrow({ where: { id: nextNotice.id } })).seen_at).not.toBeNull();
  });

  test("recovers a missed message on app resume without closing the app", async ({ page }) => {
    test.setTimeout(60_000);
    const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: "E2E Resume " + faker.string.uuid(), skipEmailCleanup: true });
    await page.goto(`/app/rooms/${fixture.roomId}/chat`);
    const scroller = page.getByLabel(/chat messages$/);
    await expect(scroller.getByText("No messages yet.")).toBeVisible();
    // Insert directly to simulate a message whose realtime event was missed.
    const now = new Date();
    const body = "Message received while the app was suspended " + faker.string.uuid();
    await prisma.chatMessage.create({ data: {
      room_id: fixture.roomId, author_id: fixture.userId, body,
      masked_alias: "", client_nonce: faker.string.uuid(),
      fire_at: new Date(now.getTime() + 7 * 86400000), expires_at: new Date(now.getTime() + 14 * 86400000),
      created_at: now, updated_at: now,
    } });
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await expect(scroller.getByText(body, { exact: true })).toBeVisible();
  });

  test("opens the exact chat message from a notification activation on another screen", async ({ page }) => {
    test.setTimeout(60_000);
    const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: "E2E Notification " + faker.string.uuid(), skipEmailCleanup: true });
    const now = new Date();
    const body = "Notification destination " + faker.string.uuid();
    const message = await prisma.chatMessage.create({ data: {
      room_id: fixture.roomId, author_id: fixture.userId, body,
      masked_alias: "", client_nonce: faker.string.uuid(),
      fire_at: new Date(now.getTime() + 7 * 86400000), expires_at: new Date(now.getTime() + 14 * 86400000),
      created_at: now, updated_at: now,
    } });
    await page.goto("/app/projects");
    await expect(page.getByRole("heading", { name: "Your projects", exact: true })).toBeVisible();
    const target = `/app/rooms/${fixture.roomId}/chat#chat-${message.id}`;
    await page.evaluate(url => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", {
      data: { type: "AFIRE_NOTIFICATION_NAVIGATE", activationId: "e2e-chat", createdAt: Date.now(), url },
    })), target);
    await expect(page).toHaveURL(`/app/rooms/${fixture.roomId}/chat`);
    await expect(page.locator(`#chat-${message.id}`)).toBeVisible();
    await expect(page.locator(`#chat-${message.id}`).getByText(body, { exact: true })).toBeVisible();
  });

  test("scrolls overflowing chat vertically inside the mobile workspace", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: "E2E Scroll " + faker.string.uuid(), skipEmailCleanup: true });
    const now = new Date();
    await prisma.chatMessage.createMany({ data: Array.from({ length: 25 }, (_, index) => ({
      room_id: fixture.roomId, author_id: fixture.userId,
      body: "Scrollable message " + index + ". This conversation extends below the mobile screen.",
      masked_alias: "", client_nonce: faker.string.uuid(),
      fire_at: new Date(now.getTime() + 7 * 86400000), expires_at: new Date(now.getTime() + 14 * 86400000),
      created_at: new Date(now.getTime() + index), updated_at: now,
    })) });
    await page.goto("/app/rooms/" + fixture.roomId + "/chat");
    const scroller = page.getByLabel(/chat messages$/);
    await expect(scroller.getByText(/Scrollable message 24\./)).toBeVisible();
    const metrics = await scroller.evaluate(element => ({
      height: element.clientHeight, content: element.scrollHeight, bottom: element.getBoundingClientRect().bottom,
    }));
    expect(metrics.content).toBeGreaterThan(metrics.height);
    expect(metrics.bottom).toBeLessThanOrEqual(844);
    await scroller.evaluate(element => { element.scrollTop = 0; });
    await scroller.hover();
    await page.mouse.wheel(0, -350);
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("reveals Save with the keyboard and cancels without creating a project entry", async ({ page }) => {
    test.setTimeout(60_000);
    const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: `Keyboard save ${faker.string.uuid()}`, skipEmailCleanup: true });
    const now = new Date();
    const project = await prisma.project.create({ data: { owner_id: fixture.userId, name: `Destination ${faker.string.uuid()}`, created_at: now, updated_at: now } });
    const message = await prisma.chatMessage.create({ data: { room_id: fixture.roomId, author_id: fixture.userId, body: "Keep the quieter take", masked_alias: "", fire_at: new Date(now.getTime() + 7 * 86400000), expires_at: new Date(now.getTime() + 14 * 86400000), created_at: now, updated_at: now } });
    await page.goto(`/app/rooms/${fixture.roomId}/chat`);
    const row = page.locator(`#chat-${message.id}`);
    const surface = row.locator('[aria-label="Message. Swipe right or press Right Arrow to reveal Save to project"]');
    await surface.press("ArrowRight");
    await row.getByRole("button", { name: /^Save revealed message \d+ to project$/ }).click();
    const dialog = page.getByRole("dialog", { name: "Save to project" });
    await expect(await findSaveProject(page, project.name)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(surface).toBeFocused();
    expect(await prisma.entry.count({ where: { project_id: project.id } })).toBe(0);
    expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id: message.id } })).entry_id).toBeNull();
  });

  test("ignores a left swipe and saves an untouched message to the selected project after a right swipe", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: `Swipe save ${faker.string.uuid()}`, skipEmailCleanup: true });
    const now = new Date();
    const project = await prisma.project.create({ data: { owner_id: fixture.userId, name: `Message destination ${faker.string.uuid()}`, created_at: now, updated_at: now } });
    const body = `Original message ${faker.string.uuid()}`;
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] };
    const message = await prisma.chatMessage.create({ data: { room_id: fixture.roomId, author_id: fixture.userId, body, content, masked_alias: "", fire_at: new Date(now.getTime() + 7 * 86400000), expires_at: new Date(now.getTime() + 14 * 86400000), created_at: now, updated_at: now } });
    await page.goto(`/app/rooms/${fixture.roomId}/chat`);
    const surface = page.locator(`#chat-${message.id} [aria-label="Message. Swipe right or press Right Arrow to reveal Save to project"]`);
    await expect(surface).toBeVisible();
    const before = (await surface.boundingBox())!;
    const startX = before.x + before.width / 2, startY = before.y + before.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 80, startY, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByRole("dialog", { name: "Save to project" })).toHaveCount(0);
    expect((await surface.boundingBox())!.x).toBeCloseTo(before.x, 0);
    // The leftward mouse drag now correctly retains native text selection.
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 180, startY, { steps: 12 });
    await page.mouse.up();
    const dialog = page.getByRole("dialog", { name: "Save to project" });
    await expect(dialog).toBeVisible();
    await chooseSaveProject(page, project.name);
    await expect(dialog).toHaveCount(0);
    const saved = await prisma.entry.findFirstOrThrow({ where: { project_id: project.id, source_chat_message_id: message.id, status: "published" } });
    const document = await prisma.document.findFirstOrThrow({ where: { docable_type: "Post", docable_id: saved.id } });
    expect(document.content).toEqual(content);
    expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id: message.id } })).entry_id).toBeNull();
    await expect(page).toHaveURL(`/app/rooms/${fixture.roomId}/chat`);
  });

  test("keeps workspace chrome and Save actions stable and shows circle details", async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 390, height: 844 });

    const suffix = faker.string.alphanumeric(8);
    const targetRoomName = `E2E Spatial Circle ${suffix}`;
    const fixture = await createUserCommunityFixture({
      email: E2E_MEMBER_EMAIL,
      roomName: targetRoomName,
      boardName: `E2E Spatial Board ${suffix}`,
      squareName: `E2E Spatial Square ${suffix}`,
      skipEmailCleanup: true,
    });
    const messageText = `Spatial message ${faker.string.uuid()}`;
    const now = new Date();
    const message = await prisma.chatMessage.create({
      data: {
        room_id: fixture.roomId,
        author_id: fixture.userId,
        body: messageText,
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: messageText }] }],
        },
        masked_alias: "",
        client_nonce: faker.string.uuid(),
        fire_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000),
        expires_at: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1_000),
        created_at: now,
        updated_at: now,
      },
    });

    await page.goto(`/app/rooms/${fixture.roomId}/chat`, { waitUntil: "domcontentloaded" });
    const circleDetailsButton = page.getByRole("button", { name: /^(Open|Close) Room details$/ });
    await expect(circleDetailsButton).toBeVisible();
    await expect(page.getByRole("link", { name: /^Home(?:,|$)/ })).toHaveCount(0);

    await circleDetailsButton.click();
    const chatDetails = page.getByRole("heading", { name: "Members", exact: true }).locator("../../../../..");
    await expect(chatDetails).toBeVisible();
    await expect(chatDetails.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
    await expect(chatDetails.getByRole("heading", { name: "Side Rooms", exact: true })).toBeVisible();
    await expect(chatDetails).toHaveCSS("opacity", "1");
    // Verify the layer receives pointer hits above the workspace, independent of its stacking context.
    await expect
      .poll(() =>
        chatDetails.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + Math.min(bounds.height / 2, 120),
          );
          return hit !== null && element.contains(hit);
        }),
      )
      .toBe(true);
    await circleDetailsButton.click();
    await expect(circleDetailsButton).toHaveAttribute("aria-expanded", "false");
    await expect(chatDetails).not.toBeVisible();

    const appBar = circleDetailsButton.locator("..");
    const appBarBefore = await appBar.boundingBox();
    expect(appBarBefore).not.toBeNull();
    await circleDetailsButton.click();
    await page.getByRole("button", { name: "Rounds", exact: true }).click();
    await page.waitForURL(`/app/rooms/${fixture.roomId}/rounds`);
    await expect(page.getByRole("heading", { name: "Current rounds", exact: true })).toBeVisible();
    await page.goBack();
    await page.waitForURL(`/app/rooms/${fixture.roomId}/chat`);
    const row = page.locator(`#chat-${message.id}`);
    await expect(row).toBeVisible();
    await row.locator('[aria-label="Message. Swipe right or press Right Arrow to reveal Save to project"]').press("ArrowRight");
    await expect(row.getByRole("button", { name: /^Save revealed message \d+ to project$/ })).toBeVisible();
    const appBarDuringSwipe = await appBar.boundingBox();
    expect(appBarDuringSwipe?.x).toBeCloseTo(appBarBefore!.x, 0);
    expect(appBarDuringSwipe?.y).toBeCloseTo(appBarBefore!.y, 0);
    await row.locator('[aria-label="Message. Swipe right or press Right Arrow to reveal Save to project"]').press("Escape");
    await expect(row.getByRole("button", { name: /^Save revealed message \d+ to project$/ })).toHaveCount(0);

    await page.goto(`/app/entries/${fixture.entryId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(fixture.postText, { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Open Room details", exact: true }).click();
    const postDetails = page.getByRole("heading", { name: "Members", exact: true }).locator("../../../../..");
    await expect(postDetails).toBeVisible();
    await expect(postDetails.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
    await expect(postDetails.getByRole("heading", { name: "Side Rooms", exact: true })).toBeVisible();
    await expect(postDetails).toHaveCSS("opacity", "1");
  });

  test("sends a real message and keeps another member's message in a project with its author", async ({ page }) => {
    test.slow();

    const suffix = faker.string.alphanumeric(8);
    const fixture = await createUserCommunityFixture({
      email: E2E_MEMBER_EMAIL,
      roomName: `E2E Chat Community ${suffix}`,
      boardName: `E2E Chat Board ${suffix}`,
      squareName: `E2E Chat Square ${suffix}`,
      skipEmailCleanup: true,
    });
    const messageText = `Chat message ${faker.string.uuid()}`;
    const sharedMessageText = `Shared message ${faker.string.uuid()}`;
    const now = new Date();
    const originalAuthor = await prisma.user.create({
      data: {
        email: `chat-author-${suffix.toLowerCase()}@example.com`,
        username: `chat_author_${suffix.toLowerCase()}`,
        created_at: now,
        updated_at: now,
      },
    });
    await prisma.roomMembership.create({
      data: {
        room_id: fixture.roomId,
        user_id: originalAuthor.id,
        created_at: now,
        updated_at: now,
      },
    });
    const sharedMessage = await prisma.chatMessage.create({
      data: {
        room_id: fixture.roomId,
        author_id: originalAuthor.id,
        body: sharedMessageText,
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: sharedMessageText }] }],
        },
        masked_alias: "",
        client_nonce: faker.string.uuid(),
        fire_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000),
        expires_at: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1_000),
        created_at: now,
        updated_at: now,
      },
    });

    await page.goto(`/app/rooms/${fixture.roomId}/chat`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Open Room details" })).toBeVisible();

    const composer = page.getByRole("textbox", { name: `Message E2E Chat Community ${suffix}` });
    await composer.fill(messageText);
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v2/rooms/${fixture.roomId}/chat/messages`) &&
          response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Send", exact: true }).click(),
    ]);

    const message = page.getByLabel(/chat messages$/).getByText(messageText, { exact: true });
    await expect(message).toBeVisible();
    const persistedMessage = await prisma.chatMessage.findFirstOrThrow({
      where: { room_id: fixture.roomId, author_id: fixture.userId, body: messageText },
    });
    expect(persistedMessage.fire_at.getTime() - persistedMessage.created_at.getTime()).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(persistedMessage.expires_at.getTime() - persistedMessage.created_at.getTime()).toBe(14 * 24 * 60 * 60 * 1_000);

    await expect(composer).toHaveValue("");
    const project = await prisma.project.create({ data: { owner_id: fixture.userId, name: `Peer feedback ${suffix}`, created_at: now, updated_at: now } });
    const row = page.locator(`#chat-${sharedMessage.id}`);
    await row.locator('[aria-label="Message. Swipe right or press Right Arrow to reveal Save to project"]').press("ArrowRight");
    await row.getByRole("button", { name: /^Save revealed message \d+ to project$/ }).click();
    await chooseSaveProject(page, project.name);
    await expect(page.getByRole("dialog", { name: "Save to project" })).toHaveCount(0);
    const saved = await prisma.entry.findFirstOrThrow({ where: { project_id: project.id, source_chat_message_id: sharedMessage.id, status: "published" } });
    expect(saved.source_author_name).toBe(originalAuthor.username);
    const document = await prisma.document.findFirstOrThrow({ where: { docable_type: "Post", docable_id: saved.id } });
    expect(JSON.stringify(document.content)).toContain(sharedMessageText);
    expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id: sharedMessage.id } })).entry_id).toBeNull();
  });
});
