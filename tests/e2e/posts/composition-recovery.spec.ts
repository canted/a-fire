import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createUserCommunityFixture, ensureUser } from "../fixtures/factory";
import { E2E_API_ORIGIN, E2E_MEMBER_EMAIL } from "../config";
import { prisma } from "../factories";
import { attachComposerFile } from "../fixtures/composition";
import { latestOtp } from "../fixtures/otp";

test("recovers title, body and media after closing and reloading; clearing them persists", async ({ page }) => {
  test.setTimeout(60000);
  const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: `E2E Recovery ${Date.now()}`, skipEmailCleanup: true });
  const path = `/app/projects/${fixture.projectId}/entries/${fixture.sourceEntryId}/edit`;
  const open = async () => { await page.goto(path); await expect(page.getByRole("textbox", { name: "Body", exact: true })).toBeVisible(); };
  const close = async () => { await page.getByRole("button", { name: "Done editing", exact: true }).click(); await expect(page.getByRole("textbox", { name: "Body", exact: true })).not.toBeVisible(); };
  await open();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Unfinished take");
  await page.getByRole("textbox", { name: "Body", exact: true }).fill("Keep my unfinished thought");
  await close();
  await page.reload();
  await open();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Unfinished take");
  await expect(page.getByRole("textbox", { name: "Body", exact: true })).toHaveText("Keep my unfinished thought");
  await attachComposerFile(page, resolve("frontend/.storybook/assets/wall-study.jpg"));
  await close();
  await page.reload();
  await open();
  const remove = page.getByRole("button", { name: "Remove image 1", exact: true });
  await expect(remove).toBeVisible();
  await remove.click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("");
  await page.getByRole("textbox", { name: "Body", exact: true }).fill("");
  await close();
  await page.reload();
  await open();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "Body", exact: true })).toHaveText("");
  await expect(remove).toHaveCount(0);

});

test("independent savers retain private copies and concurrent retries create one copy per project", async ({ page, browser, baseURL }) => {
  test.setTimeout(60000);
  const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: `E2E Independent ${Date.now()}`, skipEmailCleanup: true });
  const email = `saver-${Date.now()}@example.com`;
  const saver = await ensureUser(email, "Second saver");
  const now = new Date();
  await prisma.roomMembership.create({ data: { room_id: fixture.roomId, user_id: saver, created_at: now, updated_at: now } });

  const message = await prisma.chatMessage.create({ data: { room_id: fixture.roomId, author_id: fixture.userId, body: "Shared original", masked_alias: "", fire_at: new Date(Date.now() + 86400000), expires_at: new Date(Date.now() + 172800000), created_at: now, updated_at: now } });
  const other = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const second = await other.newPage();
    await second.goto("/auth");
    await second.getByPlaceholder("you@example.com").fill(email);
    await second.getByRole("button", { name: /continue/i }).click();
    await second.waitForURL(/\/auth\/verify/);
    await second.getByRole("textbox").first().fill(await latestOtp(email));
    await second.getByRole("button", { name: /sign in/i }).click();
    await second.waitForURL(/\/app(?:\/|$)/);
    await page.goto(`/app/rooms/${fixture.roomId}`);
    const tokens = await Promise.all([page, second].map(p => p.evaluate(() => JSON.parse(localStorage.getItem("afire.preview.session") || "null")?.accessToken)));
    const requests = [page.request, second.request];
    const headers = tokens.map(token => ({ Authorization: `Bearer ${token}` }));
    const projects = await Promise.all([fixture.userId, saver].map(owner_id => prisma.project.create({ data: {
      owner_id, name: `Private saved messages ${owner_id}`, created_at: now, updated_at: now,
    } })));
    const save = async (index: number) => {
      const response = await requests[index].post(`${E2E_API_ORIGIN}/api/v1/projects/${projects[index].id}/keep`, {
        headers: headers[index], data: { chat_message_id: message.id },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    };
    await Promise.all([save(0), save(1), save(0), save(1)]);
    const copies = await prisma.entry.findMany({ where: { source_chat_message_id: message.id, project_id: { in: projects.map(project => project.id) } } });
    expect(copies).toHaveLength(2);
    expect(new Set(copies.map(copy => copy.project_id)).size).toBe(2);
    for (const copy of copies) {
      expect(copy.room_id).toBeNull();
      expect(copy.status).toBe("published");
      const content = await prisma.document.findUniqueOrThrow({ where: { docable_type_docable_id: { docable_type: "Post", docable_id: copy.id } } });
      expect(JSON.stringify(content.content)).toContain("Shared original");
    }
    const original = await prisma.chatMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(original.entry_id).toBeNull();
    expect(original.body).toBe("Shared original");

  } finally { await other.close(); }
});
