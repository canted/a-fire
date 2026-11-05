import { expect, test, type Page } from "@playwright/test";
import type { ProjectEntry } from "../../../frontend/src/lib/api/projectEntries";

async function fixtures(page: Page, { unrelatedDraft = false, failFirstCreate = false } = {}) {
  const user = { id: 1, username: "Rowan" }, stamp = new Date().toISOString();
  const empty = { type: "doc" as const, content: [{ type: "paragraph", content: [] }] };
  const records = new Map<number, ProjectEntry & { projectId: number }>();
  for (const [id, projectId] of [[201, 42], [301, 43]]) records.set(id, { id, projectId, kind: "material", author: user, created_at: stamp, updated_at: stamp, content: { type: "doc", content: [{ type: "image", attrs: { src: "/icons/icon-512.png", alt: "Earlier reference", width: 512, height: 512 } }] }, format: "mixed_media", intent: "Earlier title", question: "Earlier body", lyrics: "Earlier lyrics", draft: false, status: "published", can_edit: true, can_share: true, submissions: [] });
  if (unrelatedDraft) records.set(202, { ...records.get(201)!, id: 202, draft: true, status: "draft", intent: "Unfinished project draft" });
  const creations: Array<{ projectId: number; fresh: boolean; id: number }> = [];
  const uploadBodies: string[] = [];
  let nextId = 1000, fail = failFirstCreate;
  let uploadGate: Promise<void> | undefined;
  let creationGate: Promise<void> | undefined;
  const project = (id: number) => ({ id, name: id === 42 ? "Field Studies" : "Evening Score", owner: user, participants: [], pending_participants: [], rooms: [],  entries: [...records.values()].filter(entry => entry.projectId === id && !entry.draft), updated_at: stamp, can_edit: true, can_add_material: true, viewer_participation: "owner" });
  await page.addInitScript(() => { localStorage.setItem("afire.preview.session", JSON.stringify({ accessToken: `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ sub: 1, exp: 4102444800 }))}.fixture`, refreshToken: "fixture-refresh" })); });
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const match = path.match(/^\/api\/v1\/projects\/(\d+)(?:\/entries(?:\/(\d+))?)?$/);
    let value: unknown = {};
    if (match) {
      const projectId = Number(match[1]), entryId = Number(match[2]);
      if (entryId) {
        if (method === "PATCH") {
          const patch = request.postDataJSON();
          records.set(entryId, { ...records.get(entryId)!, ...patch, ...(patch.save ? { draft: false, status: "published" } : {}) });
        }
        value = records.get(entryId);
      } else if (method === "POST" && path.endsWith("/entries")) {
        await creationGate;
        if (fail) { fail = false; await route.fulfill({ status: 503, json: { message: "Try creating the entry again." } }); return; }
        const fresh = request.postDataJSON()?.fresh === true;
        const old = [...records.values()].find(entry => entry.projectId === projectId && entry.draft);
        const previous = [...records.values()].filter(entry => entry.projectId === projectId && !entry.draft).at(-1);
        const entry = !fresh && old ? old : { ...records.get(projectId === 42 ? 201 : 301)!, id: nextId++, content: empty, intent: fresh ? null : previous?.intent, question: fresh ? null : previous?.question, lyrics: fresh ? null : previous?.lyrics, draft: true, status: "draft", can_share: false };
        records.set(entry.id, entry); creations.push({ projectId, fresh, id: entry.id }); value = entry;
      } else value = path.endsWith("/entries") ? { entries: project(projectId).entries, nextCursor: null } : project(projectId);
    } else if (path === "/api/v1/uploads") {
      uploadBodies.push(request.postData() ?? ""); await uploadGate;
      value = { success: 1, file: { url: "/icons/icon-512.png", width: 512, height: 512 } };
    } else if (path === "/api/v1/memberships") value = { user, memberships: [] };
    else if (path === "/api/v1/unseen/count") value = { total: 0, entries: 0, replies: 0 };
    else if (path === "/api/v1/projects") value = { projects: [project(42), project(43)] };
    await route.fulfill({ json: value });
  });
  return { records, creations, uploadBodies, holdCreate: () => { let release!: () => void; creationGate = new Promise<void>(resolve => { release = resolve; }); return release; }, holdUpload: () => { let release!: () => void; uploadGate = new Promise<void>(resolve => { release = resolve; }); return release; } };
}

async function expectBlank(page: Page) {
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "Body", exact: true })).toHaveText("");
  await expect(page.getByRole("button", { name: /^Remove (image|audio|video|file) \d+$/ })).toHaveCount(0);
}

for (const width of [320, 390, 1280]) test(`saved entry then Project plus starts empty at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  const state = await fixtures(page);
  await page.goto("/app/projects/42/entries/201");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Earlier title");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Saved revision");
  await page.getByRole("button", { name: "Done editing" }).click();
  if (await page.getByRole("button", { name: "Back to project", exact: true }).isVisible()) await page.getByRole("button", { name: "Back to project", exact: true }).click();
  await page.getByRole("button", { name: "Add entry" }).click();
  await expectBlank(page);
  await expect(page).toHaveURL(/\/entries\/1000\/edit$/);
  expect(state.creations).toEqual([{ projectId: 42, fresh: true, id: 1000 }]);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("A new study");
  await page.getByRole("textbox", { name: "Body", exact: true }).fill("Only this entry's words.");
  await page.getByRole("button", { name: "Done editing" }).click();
  if (await page.getByRole("button", { name: "Back to project", exact: true }).isVisible()) await page.getByRole("button", { name: "Back to project", exact: true }).click();
  await page.getByRole("button", { name: "Add entry" }).click();
  await expectBlank(page);
  expect(state.records.get(201)?.intent).toBe("Saved revision");
  expect(state.records.get(1000)?.intent).toBe("A new study");
  expect(state.creations.map(entry => entry.id)).toEqual([1000, 1001]);
  await page.screenshot({ path: info.outputPath(`fresh-entry-${width}.png`) });
});

test("edit/back/new and another project's new entry leave unrelated drafts intact", async ({ page }) => {
  const state = await fixtures(page, { unrelatedDraft: true });
  const unfinished = structuredClone(state.records.get(202));
  await page.goto("/app/projects/42/entries/201/edit");
  await page.getByRole("button", { name: "Back to project" }).click();
  await page.getByRole("button", { name: "Add entry" }).click(); await expectBlank(page);
  await page.goto("/app/projects/43");
  await page.getByRole("button", { name: "Add entry" }).click(); await expectBlank(page);
  await expect(page.getByRole("heading", { name: "Evening Score" })).toBeVisible();
  expect(state.records.get(202)).toEqual(unfinished);
  expect(state.creations.map(entry => entry.projectId)).toEqual([42, 43]);
});

test("cancel and explicit new allocate separately; Back/Forward and recovery keep entry identity", async ({ page }) => {
  const state = await fixtures(page);
  await page.goto("/app/projects/42");
  await page.getByRole("button", { name: "Add entry" }).click(); await expectBlank(page);
  await expect(page).toHaveURL(/\/entries\/1000\/edit$/);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Recover this unfinished thought");
  // Metadata autosave is owned by the shared content draft queue.
  await expect.poll(() => state.records.get(1000)?.intent).toBe("Recover this unfinished thought");
  await page.goBack(); await expect(page).toHaveURL(/\/projects\/42$/);
  await page.goForward(); await expect(page).toHaveURL(/\/entries\/1000\/edit$/);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Recover this unfinished thought");
  expect(state.creations).toHaveLength(1);
  await page.goBack(); await page.getByRole("button", { name: "Add entry" }).click(); await expectBlank(page);
  expect(state.creations).toHaveLength(2);
  await page.goto("/app/projects/42/entries/1000/edit");
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Recover this unfinished thought");
  expect(state.creations).toHaveLength(2);
});

test("failed fresh creation retries once and keeps the returned entry stable", async ({ page }) => {
  const state = await fixtures(page, { failFirstCreate: true });
  await page.goto("/app/projects/42"); await page.getByRole("button", { name: "Add entry" }).click();
  await page.getByRole("button", { name: "Try again" }).click(); await expectBlank(page);
  await expect(page).toHaveURL(/\/entries\/1000\/edit$/);
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); });
  await expectBlank(page);
  expect(state.creations).toEqual([{ projectId: 42, fresh: true, id: 1000 }]);
});

test("uploads attach only to the fresh entry and do not seed the next composition", async ({ page }) => {
  const state = await fixtures(page), release = state.holdUpload();
  await page.goto("/app/projects/42"); await page.getByRole("button", { name: "Add entry" }).click(); await expectBlank(page);
  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose photo", exact: true }).click();
  await (await choosing).setFiles({ name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9YkAAAAASUVORK5CYII=", "base64") });
  await expect.poll(() => state.uploadBodies.length).toBe(1);
  expect(state.uploadBodies[0]).toMatch(/name="entry_id"\r\n\r\n1000/);
  await expect(page.getByRole("button", { name: "Done editing" })).toBeDisabled();
  release();
  await expect(page.getByRole("button", { name: "Remove image 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done editing" }).click();
  if (await page.getByRole("button", { name: "Back to project", exact: true }).isVisible()) await page.getByRole("button", { name: "Back to project", exact: true }).click();
  await page.getByRole("button", { name: "Add entry" }).click(); await expectBlank(page);
  expect(state.records.get(1000)?.content.content?.some(node => node.type === "image")).toBe(true);
  expect(state.records.get(1001)?.content.content?.some(node => node.type === "image")).toBe(false);
});

test("a late allocation cannot redirect after leaving the new-entry route", async ({ page }) => {
  const state = await fixtures(page), release = state.holdCreate();
  await page.goto("/app/projects/42");
  const requested = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/projects/42/entries");
  await page.getByRole("button", { name: "Add entry" }).click(); await requested;
  await page.goBack(); await expect(page).toHaveURL(/\/projects\/42$/);
  release();
  await expect.poll(() => state.creations.length).toBe(1);
  await expect(page.getByRole("button", { name: "Add entry" })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/42$/);
  await page.getByRole("button", { name: "Add entry" }).click(); await expectBlank(page);
  await expect(page).toHaveURL(/\/entries\/1001\/edit$/);
});
