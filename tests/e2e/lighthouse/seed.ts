import 'reflect-metadata';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { StorageService } from '../../../server/storage/storage.service';
import { ImageVariantsService } from '../../../server/uploads/images/image-variants.service';
import { validateImageUpload } from '../../../server/uploads/images/image-policy';
import { imageVariantsForAttachment } from '../../../server/uploads/images/image-variants';
import { AudioProcessor } from '../../../server/uploads/audio/audio.processor';

const url = new URL(process.env.DATABASE_URL ?? 'file:///missing');
if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || !/^\/afire_lighthouse(?:_[a-z0-9]+)*_test$/.test(url.pathname) || process.env.UPLOADS_STORAGE_BACKEND !== 'local') {
  throw new Error('Run through bin/lighthouse-local.mjs with an isolated local Lighthouse database.');
}
const root = process.cwd();
const manifestPath = path.join(root, 'tmp/lighthouse/fixture.json');
const prisma = new PrismaClient();
const storage = new StorageService();
const variants = new ImageVariantsService();
Object.assign(variants, { prisma, storage });
const audioProcessor = new AudioProcessor();
Object.assign(audioProcessor, { prisma, storage });
const now = new Date();
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const later = (days: number) => new Date(now.getTime() + days * 86_400_000);
const timestamps = (hours = 24) => ({ created_at: ago(hours), updated_at: ago(hours) });
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const document = (...content: Prisma.InputJsonValue[]) => ({ type: 'doc', content });
const assets = 'tests/e2e/fixtures/assets';
const provenance: Array<{ file: string; sha256: string; use: string; blobId: number; width?: number; height?: number }> = [];

async function storeImage(recordType: string, recordId: number, name: string, filename: string, use: string) {
  const file = `${assets}/${filename}`;
  const buffer = readFileSync(path.join(root, file));
  const metadata = await validateImageUpload({ buffer, size: buffer.length });
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const key = `lighthouse/${recordType}/${recordId}/${name}/${sha256}`;
  await storage.put(key, buffer, metadata.contentType);
  const blob = await prisma.activeStorageBlob.create({ data: {
    key, filename, content_type: metadata.contentType, metadata: JSON.stringify(metadata), service_name: 'local',
    byte_size: buffer.length, checksum: createHash('md5').update(buffer).digest('base64'), created_at: ago(24),
  } });
  await prisma.activeStorageAttachment.create({ data: { record_type: recordType, record_id: recordId, name, blob_id: blob.id, created_at: ago(24) } });
  await variants.ensure(blob.id, imageVariantsForAttachment({ record_type: recordType, name }));
  provenance.push({ file, sha256, use, blobId: blob.id, width: metadata.width, height: metadata.height });
  return { type: 'image', attrs: { src: `/api/v1/uploads/${blob.id}`, alt: use, width: metadata.width, height: metadata.height } };
}

async function storeAudio(postId: number, userId: number) {
  const file = `${assets}/spunky.mp3`;
  const buffer = readFileSync(path.join(root, file));
  const key = `lighthouse/audio/${postId}/spunky.mp3`;
  await storage.put(key, buffer, 'audio/mpeg');
  const blob = await prisma.activeStorageBlob.create({ data: { key, filename: 'room-score-sketch.mp3', content_type: 'audio/mpeg', service_name: 'local', byte_size: buffer.length, created_at: ago(24) } });
  await prisma.activeStorageAttachment.create({ data: { record_type: 'Post', record_id: postId, name: 'audio', blob_id: blob.id, created_at: ago(24) } });
  const asset = await prisma.audioAsset.create({ data: { blob_id: blob.id, owner_id: userId, source_type: 'Post', source_id: postId, title: 'Room score — first sketch', original_filename: 'room-score-sketch.mp3', original_mime_type: 'audio/mpeg', processing_status: 'pending', ...timestamps() } });
  await audioProcessor.process({ audioAssetId: asset.id });
  const processed = await prisma.audioAsset.findUniqueOrThrow({ where: { id: asset.id } });
  if (!processed.duration_ms || !processed.waveform_peaks) throw new Error('Real audio processing requires ffmpeg and ffprobe on PATH.');
  provenance.push({ file, sha256: createHash('sha256').update(buffer).digest('hex'), use: 'Project entry playable audio; canonical processor generates real peaks.', blobId: blob.id });
  return { type: 'audio', attrs: { audioAssetId: asset.id, title: processed.title, status: 'ready' } };
}

async function storeDocument(type: string, id: number, content: Prisma.InputJsonValue) {
  await prisma.document.create({ data: { docable_type: type, docable_id: id, content, ...timestamps() } });
}

async function login(email: string, userId: number) {
  const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
  await prisma.oneTimeToken.create({ data: { email, user_id: userId, token: otp, purpose: 'login', expires_at: new Date(Date.now() + 10 * 60_000), created_at: new Date(), updated_at: new Date() } });
  return { email, otp };
}

try {
  const markers = await prisma.$queryRaw<Array<{ marker: string | null }>>`
    SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = current_database()
  `;
  if (markers[0]?.marker !== 'A Fire isolated Lighthouse fixtures v1') throw new Error('Database lacks the Lighthouse fixture ownership marker.');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.database !== url.pathname.slice(1)) throw new Error('Fixture manifest belongs to another database.');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'maya.lighthouse@example.invalid' } });
    manifest.login = await login(user.email, user.id);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    console.info('Existing Lighthouse fixtures preserved; fresh one-time authentication code saved privately.');
  } else {
    if (process.argv.includes('--auth-only')) throw new Error('Prepare the fixture database first.');
    if (await prisma.user.count()) throw new Error('Refusing to seed a nonempty database without its fixture manifest. Use another unique Lighthouse test database.');
    const names = ['Maya Reed', 'Theo Park', 'Lena Moss'];
    const users = [];
    for (const [index, name] of names.entries()) {
      const user = await prisma.user.create({ data: { email: `${name.split(' ')[0].toLowerCase()}.lighthouse@example.invalid`, username: name, profile_line: ['Making small songs from everyday sounds.', 'Photographs, field notes, and slow listening.', 'Trying a little colour and a new melody.'][index], ...timestamps(72) } });
      users.push(user);
      await storeImage('User', user.id, 'avatar', ['avatar-maya.jpg', 'avatar-will.jpg', 'avatar-jon.jpg'][index], `${name}'s avatar (fictional fixture identity)`);
    }
    const circles = [];
    for (const [index, name] of ['Quiet Frequencies', 'Colour & Form', 'Small Hours'].entries()) {
      const circle = await prisma.room.create({ data: { name, owner_id: users[index].id, porosity: 'closed', ...timestamps(72) } });
      circles.push(circle);
      await storeImage('Circle', circle.id, 'avatar', ['room-icon.jpg', 'wall-pointillism.jpg', 'wall-pointillism.jpg'][index], `${name} circle image`);
      for (const user of users) {
        await prisma.roomMembership.create({ data: { room_id: circle.id, user_id: user.id, notify: false, unseen_started_at: ago(72), ...timestamps(72) } });
      }
    }
    const projects = [];
    const entries = [];
    for (const [index, name] of ['Room Score', 'Window Studies', 'Evening Sketchbook'].entries()) {
      const project = await prisma.project.create({ data: { name, owner_id: users[0].id, description: ['A collection of small melodies, found textures, and recordings from the room.', 'Photographs and colour notes about the light that changes throughout the day.', 'Ten minutes of sound or drawing whenever there is room to begin.'][index], ...timestamps(24 + index) } });
      projects.push(project);
      await storeImage('Project', project.id, 'icon', ['spunky.jpg', 'cool.jpg', 'swagger.jpg'][index], `${name} project icon`);
      await storeImage('Project', project.id, 'banner', ['wall-pointillism.jpg', 'wall-pointillism.jpg', 'room-icon.jpg'][index], `${name} project cover`);
      if (!index) await prisma.projectParticipation.create({ data: { project_id: project.id, user_id: users[1].id, invited_by_id: users[0].id, status: 'accepted', invited_at: ago(48), responded_at: ago(47), ...timestamps(48) } });
      for (let entryIndex = 0; entryIndex < 3; entryIndex++) {
        const entry = await prisma.entry.create({ data: { project_id: project.id, user_id: users[0].id, status: 'published', published_at: ago(1 + entryIndex * 12 + index), creation_origin: 'project_material', format: 'mixed_media', format_data: { title: ['First light', 'A quieter texture', 'Notes for the next visit'][entryIndex] }, ...timestamps(1 + entryIndex * 12 + index) } });
        entries.push(entry);
        const image = await storeImage('Post', entry.id, 'image', ['spunky.jpg', 'cool.jpg', 'swagger.jpg'][(index + entryIndex) % 3], `${name}: ${['First light', 'A quieter texture', 'Next visit'][entryIndex]}`);
        const content: Prisma.InputJsonValue[] = [paragraph(['I kept the first take and left a little space between the notes. The room sound feels like part of the piece.', 'The softer colours seem to leave more room for the rhythm. I want to try a version with fewer layers.', 'Next time: begin with one sound, keep the useful surprises, and leave a short note about what changed.'][entryIndex]), image];
        if (!index && !entryIndex) content.push(await storeAudio(entry.id, users[0].id));
        await storeDocument('Post', entry.id, document(...content));
      }
    }
    const draft = await prisma.entry.create({ data: { project_id: projects[0].id, user_id: users[0].id, status: 'draft', creation_origin: 'project_material', format_data: { title: 'A small beginning' }, ...timestamps(1) } });
    await storeDocument('Post', draft.id, document(paragraph('A thought to return to: make the next phrase breathe.')));
    const activity = await prisma.round.create({ data: { room_id: circles[0].id, host_id: users[0].id, name: 'A sound worth keeping', prompt: 'Share a small piece in progress. Tell us what you noticed, then leave one careful response for someone else.', status: 'active', template_key: 'feedback', reply_mode: 'simple', started_at: ago(48), submit_by: later(7), feedback_due_at: later(14), ...timestamps(48) } });
    const oldActivity = await prisma.round.create({ data: { room_id: circles[0].id, host_id: users[0].id, name: 'The shape of an afternoon', prompt: 'One image and a short note from the afternoon.', status: 'archived', template_key: 'feedback', started_at: ago(240), submit_by: ago(192), feedback_due_at: ago(168), closed_at: ago(168), ...timestamps(240) } });
    const circlePosts = [];
    for (const [index, user] of users.entries()) {
      const participation = await prisma.activityParticipation.create({ data: { round_id: activity.id, user_id: user.id, role: 'participant', status: 'active', joined_at: ago(48), ...timestamps(48) } });
      if (!index) continue; // Signed-in Maya has a genuine open contribution task.
      const post = await prisma.entry.create({ data: { user_id: user.id, room_id: circles[0].id, round_id: activity.id, status: 'published', published_at: ago(index + 1), format_data: { title: index === 1 ? 'The light between the notes' : 'A pattern from the walk home' }, reply_mode: 'simple', ...timestamps(index + 1) } });
      circlePosts.push(post);
      const image = await storeImage('Post', post.id, 'image', index === 1 ? 'wall-pointillism.jpg' : 'cool.jpg', index === 1 ? 'Light across a wall' : 'A colourful study from a walk');
      await storeDocument('Post', post.id, document(paragraph('This began as a small observation on the walk home. I am curious which detail stays with you after a first look.'), image));
      await prisma.activityParticipation.update({ where: { id: participation.id }, data: { submitted_entry_id: post.id } });
      await prisma.activitySubmission.create({ data: { round_id: activity.id, activity_participation_id: participation.id, entry_id: post.id, user_id: user.id, submitted_at: ago(index + 1), ...timestamps(index + 1) } });
      for (const [replyIndex, text] of ['The space around the brighter detail gives it a lovely pause.', 'I kept coming back to that small shift near the edge. It feels worth exploring.'].entries()) {
        const reply = await prisma.reply.create({ data: { entry_id: post.id, user_id: users[replyIndex === 0 ? 0 : 2].id, status: 'published', published_at: ago(0.5 + replyIndex / 10), ...timestamps(0.5 + replyIndex / 10) } });
        await storeDocument('Reply', reply.id, document(paragraph(text)));
      }
    }
    const chatMessages = [];
    for (const [index, body] of ['I made a little room to listen this morning. Sharing a texture that caught my eye.', 'That line between light and shade feels almost like a rhythm.', 'I am trying a shorter version today — just one phrase and a pause.', 'There is no need to finish everything at once. This is a good place to leave the next idea.', 'A small reminder: the current activity is open through next week.', 'I will bring a new recording when I return tomorrow.', ...Array.from({ length: 64 }, (_, index) => `Listening note ${index + 7}. I tried leaving more space between the phrases today. The quieter section makes the rhythm easier to hear.`)].entries()) {
      const message = await prisma.chatMessage.create({ data: { room_id: circles[0].id, author_id: users[index % 3].id, body, content: document(paragraph(body)), masked_alias: names[index % 3], fire_at: later(29), expires_at: later(30), ...timestamps(1 - index / 100) } });
      chatMessages.push(message);
      if (!index) {
        const image = await storeImage('ChatMessage', message.id, 'image', 'swagger.jpg', 'A texture shared in Quiet Frequencies chat');
        await prisma.chatMessage.update({ where: { id: message.id }, data: { content: document(paragraph(body), image) } });
      }
    }
    const note = await prisma.page.create({ data: { room_id: circles[0].id, title: 'Things we are listening for', icon: '✺', ...timestamps(12) } });
    await storeDocument('Note', note.id, document(paragraph('Keep a little room for unfinished work. Listen once for the overall feeling and again for one detail you can name.')));
    for (const [index, eventType] of ['reply_created', 'post_created', 'mention'].entries()) {
      const event = await prisma.notificationEvent.create({ data: { event_type: eventType, actor_id: users[1].id, room_id: circles[0].id, entry_id: circlePosts[0].id, target_user_id: users[0].id, target_path: `/app/entries/${circlePosts[0].id}`, payload: { preview: 'There is a new detail to return to in Quiet Frequencies.', author_name: users[1].username }, ...timestamps(index + 0.2) } });
      await prisma.notificationInboxItem.create({ data: { user_id: users[0].id, notification_event_id: event.id, delivery_state: 'delivered', delivered_at: ago(index + 0.1), ...timestamps(index + 0.2) } });
    }
    const route = (id: string, routePath: string, expectText?: string) => ({ id, path: routePath, ...(expectText ? { expectText } : {}) });
    const manifest = {
      version: 1, database: url.pathname.slice(1), baseUrl: 'http://127.0.0.1:4300', createdAt: now.toISOString(),
      login: await login(users[0].email, users[0].id),
      ids: { users: users.map(item => item.id), rooms: circles.map(item => item.id), projects: projects.map(item => item.id), entries: entries.map(item => item.id), draft: draft.id, round: activity.id, oldActivity: oldActivity.id, circlePosts: circlePosts.map(item => item.id), note: note.id },
      routes: [
        route('home', '/app', 'Room Score'), route('projects', '/app/projects', 'Window Studies'), route('project-detail', `/app/projects/${projects[0].id}`, 'Room Score'),
        route('project-new', '/app/projects/new', 'Create project'), route('entry-composer', `/app/projects/${projects[0].id}/entries/${draft.id}/edit`, 'Room Score'), route('entry-detail', `/app/projects/${projects[0].id}/entries/${entries[0].id}`, 'I kept the first take'),
        route('circles', '/app/rooms', 'Quiet Frequencies'), route('circle-activities', `/app/rooms/${circles[0].id}/rounds`, 'A sound worth keeping'),
        route('chat', `/app/rooms/${circles[0].id}/chat`, 'I will bring a new recording'), route('circle-detail', `/app/rooms/${circles[0].id}`, 'Quiet Frequencies'), route('circle-settings', `/app/rooms/${circles[0].id}/settings`, 'Quiet Frequencies'),
        route('activity', `/app/rounds/${activity.id}`, 'A sound worth keeping'), route('activity-contribution', `/app/rounds/${activity.id}?contributionPhase=submission`, 'A sound worth keeping'),
        route('entry-replies', `/app/entries/${circlePosts[0].id}`, 'The light between the notes'), route('profile', '/app/profile', 'Profiles'), route('notices', '/app/notices', 'Quiet Frequencies'),
      ],
      counts: { users: users.length, rooms: circles.length, projects: projects.length, projectEntries: entries.length, rounds: 2, circleEntries: circlePosts.length, replies: 4, chatMessages: chatMessages.length, notices: 3 },
      media: provenance,
      notes: ['All records are synthetic local fixtures. Fictional display names do not identify people in the existing presentation assets.', 'Images come from committed presentation assets; distinct blobs/attachments use canonical validation, intrinsic metadata, and image variants.', 'Audio comes from the committed spunky.mp3 presentation fixture and is processed with the production AudioProcessor; no invented waveform peaks.', 'No production data, SMTP delivery, S3, telemetry, or push subscription is used. Private project and closed circle permissions remain normal.'],
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    console.info(`Lighthouse fixture manifest saved to tmp/lighthouse/fixture.json (${provenance.length} actual media files).`);
  }
} finally {
  await prisma.$disconnect();
  storage.onModuleDestroy();
}
