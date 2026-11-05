import { createUserCommunityFixture } from './factory';
import { prisma } from './database';

/** Ready-to-choose synthetic covers; UI tests exercise choice and response publication. */
export async function seedExpoArtRound(platform: 'web' | 'ios' | 'android', phase: 'covers' | 'responses' = 'responses', responseFormat: 'any' | 'audio' = 'any') {
  const fixture = await createUserCommunityFixture({ email: `expo-${platform}-benchmark@example.test`, username: `${platform} benchmark`, roomName: `Expo ${platform} art workflow ${Date.now()}`, skipEmailCleanup: true });
  const now = new Date();
  const image = await prisma.activeStorageBlob.findFirstOrThrow({ where: { key: 'expo-rich-fixture/study.png' } });
  const round = await prisma.round.create({ data: { room_id: fixture.roomId, host_id: fixture.userId, name: `Expo ${platform} art ${phase === 'covers' ? 'cover' : 'response'} Round`, prompt: 'Synthetic cover choice and response validation.', status: 'active', template_key: 'art_before_chorus', template_config: { responseFormat, sketchSize: 'tiny' }, started_at: now, submit_by: new Date(now.getTime() + (phase === 'covers' ? 86400000 : -60000)), feedback_due_at: new Date(now.getTime() + 172800000), created_at: now, updated_at: now } });
  for (const memberPlatform of ['web', 'ios', 'android']) {
    const user = await prisma.user.findFirstOrThrow({ where: { email: `expo-${memberPlatform}-benchmark@example.test` } });
    if (user.id !== fixture.userId) await prisma.roomMembership.create({ data: { room_id: fixture.roomId, user_id: user.id, notify: false, disabled: false, created_at: now, updated_at: now } });

    await prisma.activityParticipation.create({ data: { round_id: round.id, user_id: user.id, role: 'participant', status: 'active', joined_at: now, created_at: now, updated_at: now } });
    if (phase === 'covers' && user.id === fixture.userId) continue;
    const post = await prisma.entry.create({ data: { user_id: user.id, room_id: fixture.roomId, round_id: round.id, creation_origin: 'round_activity_cover', format: 'image', format_data: { image_url: `/api/v1/uploads/${image.id}`, title: `Synthetic ${memberPlatform} cover` }, status: 'published', published_at: now, created_at: now, updated_at: now } });
    await prisma.document.create({ data: { docable_type: 'Post', docable_id: post.id, content: { type: 'doc', content: [{ type: 'image', attrs: { src: `/api/v1/uploads/${image.id}`, width: 512, height: 512, alt: `Synthetic ${memberPlatform} cover` } }] }, version: 1, created_at: now, updated_at: now } });
    await prisma.activeStorageAttachment.create({ data: { blob_id: image.id, record_type: 'Post', record_id: post.id, name: 'files', created_at: now } });
    await prisma.activityArtifact.create({ data: { round_id: round.id, user_id: user.id, entry_id: post.id, kind: 'cover', status: 'active', submitted_at: now, created_at: now, updated_at: now } });
  }
  return { room: fixture.roomId, round: round.id, name: round.name };
}

export async function setExpoArtMemberAccess(room: number, platform: 'web' | 'ios' | 'android', disabled: boolean) {
  const circle = await prisma.room.findUniqueOrThrow({ where: { id: room } });
  const user = await prisma.user.findFirstOrThrow({ where: { email: `expo-${platform}-benchmark@example.test` } });
  if (!circle.name?.startsWith('Expo ') || !circle.name.includes(' art workflow ') || circle.owner_id === user.id) throw new Error('Expected a synthetic non-owner membership');
  const result = await prisma.roomMembership.updateMany({ where: { room_id: room, user_id: user.id }, data: { disabled, updated_at: new Date() } });
  if (result.count !== 1) throw new Error('Expected exactly one synthetic membership');
}

/** Published private material plus an incompatible entry tests filtering and copying. */
export async function seedExpoRoundProject(platform: 'web' | 'ios' | 'android') {
  const user = await prisma.user.findFirstOrThrow({ where: { email: `expo-${platform}-benchmark@example.test` } });
  const image = await prisma.activeStorageBlob.findFirstOrThrow({ where: { key: 'expo-rich-fixture/study.png' } });
  const now = new Date();
  const project = await prisma.project.create({ data: { owner_id: user.id, name: `Expo ${platform} Round imports`, created_at: now, updated_at: now } });
  for (const kind of ['image', 'text']) {
    const content = { type: 'doc', content: kind === 'image' ? [{ type: 'image', attrs: { src: `/api/v1/uploads/${image.id}`, width: 512, height: 512, alt: 'Synthetic project cover' } }] : [{ type: 'paragraph', content: [{ type: 'text', text: 'Incompatible text-only project entry' }] }] };
    const post = await prisma.entry.create({ data: { user_id: user.id, project_id: project.id, creation_origin: 'project_material', status: 'published', format: 'mixed_media', format_data: {}, published_at: now, created_at: now, updated_at: now } });
    await prisma.document.create({ data: { docable_type: 'Post', docable_id: post.id, content, version: 1, created_at: now, updated_at: now } });
    if (kind === 'image') await prisma.activeStorageAttachment.create({ data: { blob_id: image.id, record_type: 'Post', record_id: post.id, name: 'files', created_at: now } });
  }
  return { project: project.id, name: project.name };
}

/** Add missing synthetic results to an already completed visual-review Round. */
export async function populateExpoCompletedRound(id: number) {
  const round = await prisma.round.findUniqueOrThrow({ where: { id }, include: { participations: true, activity_artifacts: true } });
  if (!round.name.startsWith('Expo ') || !round.name.endsWith('art response Round') || round.status !== 'archived') throw new Error('Expected a completed synthetic review Round');
  const now = new Date();
  for (const person of round.participations) {
    if (round.activity_artifacts.some(item => item.user_id === person.user_id && item.kind === 'response')) continue;
    const cover = round.activity_artifacts.find(item => item.kind === 'cover' && item.user_id !== person.user_id && item.status === 'active');
    if (!cover) throw new Error('Expected another synthetic participant cover');
    const post = await prisma.entry.create({ data: { user_id: person.user_id, room_id: round.room_id, round_id: id, creation_origin: 'round_activity_response', format: 'mixed_media', format_data: { title: 'Synthetic additional response' }, status: 'published', published_at: now, created_at: now, updated_at: now } });
    await prisma.document.create({ data: { docable_type: 'Post', docable_id: post.id, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Another synthetic response for the completed Round grid.' }] }] }, version: 1, created_at: now, updated_at: now } });
    await prisma.activityArtifact.create({ data: { round_id: id, user_id: person.user_id, entry_id: post.id, kind: 'response', status: 'active', source_artifact_id: cover.id, submitted_at: now, created_at: now, updated_at: now } });
  }
}
