import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createUserCommunityFixture, ensureUser } from "../fixtures/factory";
import { prisma } from "../fixtures/database";
import { E2E_MEMBER_EMAIL } from "../config";

async function seed() {
const previousUser = await prisma.user.findFirst({where:{email:E2E_MEMBER_EMAIL}});
if (previousUser) {
 await prisma.project.deleteMany({where:{owner_id:previousUser.id}});
 await prisma.room.updateMany({where:{owner_id:previousUser.id,name:'Small Hours'},data:{name:'Earlier practice circle'}});
}
const now = new Date();
const stamp = {created_at: now, updated_at: now};
const day = 86400000;
const doc = (text: string) => ({type:'doc', content:[{type:'paragraph',content:[{type:'text',text}]}]});
const fixture = await createUserCommunityFixture({email:E2E_MEMBER_EMAIL,skipEmailCleanup:true,username:'Rowan',roomName:'Small Hours',boardName:'Latest Posts',withPage:true,pageTitle:'Listening notes',pageIcon:'📝'});
await prisma.user.update({where:{id:fixture.userId},data:{username:'Rowan'}});
// This viewport fixture models one circle, rather than every circle retained by prior E2E runs.
await prisma.roomMembership.deleteMany({where:{user_id:fixture.userId,room_id:{not:fixture.roomId}}});
await prisma.entry.updateMany({where:{user_id:fixture.userId,status:"published",room_id:{not:fixture.roomId}},data:{status:"deleted"}});
await prisma.roomMembership.update({where:{id:fixture.membershipId},data:{unseen_started_at:new Date(+now-day)}});
const maya = await ensureUser('maya@practice.example.test','Maya');
const leon = await ensureUser('leon@practice.example.test','Leon');
for (const user_id of [maya,leon]) {
 await prisma.roomMembership.create({data:{...stamp,user_id,room_id:fixture.roomId}});

}
const project = await prisma.project.create({data:{...stamp,owner_id:fixture.userId,name:'Evening sketches',description:'A song about the walk home. Leave room for the voice, and follow the small ideas.'}});
const empty = await prisma.project.create({data:{...stamp,owner_id:fixture.userId,name:'Field recordings',description:'Gather sounds from ordinary places.'}});
for (const user_id of [maya,leon]) await prisma.projectParticipation.create({data:{...stamp,project_id:project.id,user_id,invited_by_id:fixture.userId,status:user_id===maya?'accepted':'pending',invited_at:now,responded_at:user_id===maya?now:null}});
const material = await prisma.entry.create({data:{...stamp,user_id:fixture.userId,project_id:project.id,creation_origin:'project_material',status:'published',published_at:now,project_intent:'Try a quieter bass line',project_question:'Does the pause before the chorus feel natural?',project_lyrics:'There is a light at the end of our street\nI leave it behind, but it stays with me'}});
await prisma.document.create({data:{...stamp,docable_type:'Post',docable_id:material.id,content:doc('Leave a little more space before the chorus. The melody can arrive a breath later.'),version:1}});
await prisma.entry.update({where:{id:fixture.entryId},data:{source_entry_id:material.id,format:'mixed_media',format_data:undefined,reply_mode:'simple'}});
await prisma.document.updateMany({where:{docable_type:'Post',docable_id:fixture.entryId},data:{content:doc('I left a breath before the chorus. Does that pause give the melody enough room?')}});
const reply = await prisma.reply.create({data:{...stamp,user_id:maya,entry_id:fixture.entryId,status:'published',published_at:now}});
// Home response counts use the notification inbox, as real reply publication does.
const responseNotice = await prisma.notificationEvent.create({ data: {
  ...stamp, event_type: "reply_created", actor_id: maya, room_id: fixture.roomId,
  entry_id: fixture.entryId,
  payload: { replyId: reply.id }, target_path: `/app/entries/${fixture.entryId}#reply-${reply.id}`,
} });
await prisma.notificationInboxItem.create({ data: { ...stamp, user_id: fixture.userId, notification_event_id: responseNotice.id } });
await prisma.document.create({data:{...stamp,docable_type:'Reply',docable_id:reply.id,content:doc('The pause makes the first line land. I would keep it, and let the bass enter after the voice.'),version:1}});
const kept = await prisma.entry.create({data:{...stamp,user_id:fixture.userId,project_id:project.id,creation_origin:'project_feedback',status:'published',published_at:now,source_entry_id:material.id,source_shared_entry_id:fixture.entryId,source_reply_id:reply.id,source_author_name:'Maya'}});
await prisma.document.create({data:{...stamp,docable_type:'Post',docable_id:kept.id,content:doc('The pause makes the first line land. I would keep it, and let the bass enter after the voice.'),version:1}});
const current = await prisma.round.create({data:{...stamp,room_id:fixture.roomId,host_id:fixture.userId,name:'Room to breathe',prompt:'Bring one small idea that needs a little space.',status:'active',started_at:now,submit_by:new Date(+now+3*day),feedback_due_at:new Date(+now+6*day)}});
await prisma.activityParticipation.create({data:{...stamp,round_id:current.id,user_id:fixture.userId,role:'participant',joined_at:now}});
const history = await prisma.round.create({data:{...stamp,room_id:fixture.roomId,host_id:fixture.userId,name:'First light',prompt:'Begin with a sound you noticed this week.',status:'archived',started_at:new Date(+now-14*day),submit_by:new Date(+now-10*day),feedback_due_at:new Date(+now-7*day),closed_at:new Date(+now-day)}});
await prisma.entry.update({where:{id:fixture.entryId},data:{round_id:history.id}});
const earlier = new Date(+now-day);
const peerMaterial = await prisma.entry.create({data:{...stamp,user_id:maya,project_id:project.id,creation_origin:'project_material',status:'published',published_at:earlier}});
await prisma.document.create({data:{...stamp,docable_type:'Post',docable_id:peerMaterial.id,content:doc('A quieter ending, with room for the last note.'),version:1}});

const peerShare = await prisma.entry.create({data:{...stamp,user_id:maya,room_id:fixture.roomId,source_entry_id:peerMaterial.id,status:'published',published_at:earlier}});
await prisma.document.create({data:{...stamp,docable_type:'Post',docable_id:peerShare.id,content:doc('A quieter ending, with room for the last note.'),version:1}});
for (const [index,[author_id,body]] of [[maya,'I tried the quieter ending today. It feels much closer.'],[fixture.userId,'That little breath before the last line really works.'],[leon,'Bringing a field recording to the next activity. Just rain on the kitchen window.']].entries()) await prisma.chatMessage.create({data:{...stamp,created_at:new Date(+now-(3-index)*60000),room_id:fixture.roomId,author_id:Number(author_id),body:String(body),masked_alias:'',fire_at:new Date(+now+day),expires_at:new Date(+now+2*day)}});
return { fixture, project, empty, material, reply, current, history };

}

test("mobile practice views keep navigation, selection, and save controls usable", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  const { fixture, project, empty, material, current } = await seed();
  const capture = async (name: string) => {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const dir = process.env.AFIRE_REVIEW_SCREENSHOTS;
    if (dir && testInfo.project.name === "chromium") {
      await mkdir(dir, { recursive: true });
      await page.screenshot({ path: join(dir, `${name}.jpg`), type: "jpeg", quality: 90, animations: "disabled", fullPage: false });
    }
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/projects/${project.id}/edit`);
  const banner = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose banner", exact: true }).click();
  await (await banner).setFiles(resolve("frontend/.storybook/assets/wall-study.jpg"));
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page).toHaveURL(`/app/projects/${project.id}`);

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Evening sketches/ }).first()).toBeVisible();
  await expect(page.getByText(/^\d+ New responses$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Home", exact: true })).toHaveCount(0);
  await capture("home-390");

  await page.goto(`/app/projects/${project.id}`);
  const timeline = page;
  await expect(timeline.getByText("Maya", { exact: true }).first()).toBeVisible();
  await capture("project-390");
  await page.setViewportSize({ width: 1280, height: 900 });
  await capture("project-desktop");
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole("button", { name: "Project options" }).click();
  await page.getByRole("menuitem", { name: "Project settings" }).click();
  await expect(page.getByRole("button", { name: "Project color red" })).toBeVisible();
  await capture("settings-320");

  await page.goto(`/app/projects/${empty.id}`);
  await expect(page.getByRole("heading", { name: "No Entries" })).toBeVisible();
  await expect(page.getByText("To add an entry, tap the plus button.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add entry", exact: true })).toBeVisible();
  await expect(page.locator("[data-bottom-toolbar]")).toHaveCount(0);
  await capture("empty-320");
  await page.goto("/app/projects");
  await expect(page.getByRole("button", { name: "Back to home" })).toBeInViewport();
  await capture("projects-320");
  await page.goto("/app/profile");
  await expect(page.getByRole("textbox", { name: "Default display name", exact: true }).first()).toHaveValue("Rowan");
  await expect(page.getByRole("heading", { name: "Profiles", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Home", exact: true })).toBeInViewport();
  await expect(page.getByRole("link", { name: /^Home/ })).toHaveCount(0);
  await expect(page.locator("[data-bottom-toolbar]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Home", exact: true })).toHaveCount(0);
  await capture("profile-320");

  await page.goto(`/app/projects/${project.id}/entries/${material.id}/edit`);
  await expect(page.getByRole("textbox", { name: "Body", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Done editing", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Lyrics", exact: true })).toHaveCount(0);
  await capture("editor-320");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("editor-390");
  // Explicit save converts old lyrics to an ordinary block while retaining their text.
  await page.getByRole("button", { name: "Done editing", exact: true }).click();
  await expect(page).toHaveURL(`/app/projects/${project.id}`);
  await timeline.locator(`#entry-${material.id}`).getByRole("button", { name: "Entry options" }).click();
  await page.getByRole("menuitem", { name: "Share with a room" }).click();
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page.getByRole("menuitem", { name: "Small Hours", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(page.getByRole("checkbox", { name: "Body", exact: true })).toBeChecked();
  await capture("share-320");
  await page.getByRole("checkbox", { name: "Body", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Body", exact: true })).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Body", exact: true }).click();
  await expect(page.getByRole("button", { name: "Share in Small Hours", exact: true })).toBeEnabled();
  await capture("review-320");
  const stored = await prisma.document.findFirstOrThrow({ where: { docable_type: "Post", docable_id: material.id } });
  expect(JSON.stringify(stored.content)).toContain("There is a light");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/rooms/${fixture.roomId}/rounds`);
  await expect(page.getByText(current.name, { exact: true }).first()).toBeVisible();
  await capture("activities-390");
  await page.goto(`/app/rooms/${fixture.roomId}/chat`);
  await expect(page.getByRole("textbox", { name: "Message Small Hours" })).toBeVisible();
  const identity = page.getByRole("button", { name: "Open Room details", exact: true });
  await expect(identity).toBeVisible();
  // Measure the shared Room header after the chat drawer settles.
  await identity.click({ trial: true });
  const headerGeometry = await identity.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, hit: element.contains(hit), opacity: getComputedStyle(element).opacity };
  });
  expect(headerGeometry.top).toBeGreaterThanOrEqual(0);
  expect(headerGeometry.top).toBeLessThan(25);
  expect(headerGeometry.hit).toBe(true);
  await capture("chat-390");
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`/app/rooms/${fixture.roomId}/settings`);
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeVisible();
  await capture("settings-320");
  await page.goto(`/app/entries/${fixture.entryId}`);
  await expect(page.getByText("I left a breath before the chorus. Does that pause give the melody enough room?", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add attachment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous project contribution" })).toBeVisible();
  await capture("post-320");
});
