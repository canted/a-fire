import type { Page } from "@playwright/test";

export async function roomFixtures(page: Page, withAudio = false) {
  await page.addInitScript(() => {
    localStorage.setItem("afire.preview.session", JSON.stringify({ accessToken: `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ sub: 1, exp: 4102444800 }))}.fixture`, refreshToken: "fixture-refresh" }));
  });
  // Match the API root without intercepting Vite modules such as /lib/api/client.ts.
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const roomId = Number(path.match(/\/rooms\/(\d+)/)?.[1]);
    const names: Record<number, string> = { 1: "Gathering", 2: "Great Hall", 7: "Lanterns", 8: "Small Hours" };
    if (path === "/v1/audio-assets/11/download") {
      const samples = 8000 * 20;
      const wav = Buffer.alloc(44 + samples * 2);
      wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
      wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
      for (let sample = 0; sample < samples; sample++) wav.writeInt16LE(Math.round(Math.sin(sample * 2 * Math.PI * 220 / 8000) * 1000), 44 + sample * 2);
      await route.fulfill({ contentType: "audio/wav", body: wav }); return;
    }
    let body: unknown = {};
    if (path === "/v2/rooms") body = { rooms: Object.entries(names).map(([id, name]) => ({ id: Number(id), name })) };
    else if (/^\/v1\/rooms\/\d+\/home$/.test(path)) body = { roomId: String(roomId), members: [], viewer_access: { kind: "member", can_write: true, can_reply: true, entry_history: "all" } };
    else if (/^\/v2\/rooms\/\d+$/.test(path)) body = { id: roomId, name: names[roomId], owner_id: 1, porosity: "masked", parent: roomId === 1 ? null : { id: roomId === 2 ? 1 : 2, name: names[roomId === 2 ? 1 : 2] }, access: { kind: "member", can_manage: true, can_create_adjacent_room: true, can_view_notes: true, can_participate_rounds: true }, memberBoard: { id: 21, name: names[roomId] } };
    else if (path.endsWith("/adjacent-rooms")) body = { can_create: true, adjacent_rooms: [{ id: 8, name: "Small Hours", porosity: "masked", porosity_label: "Visit only", member_count: 2, viewer_state: "member", actions: { enter: true } }, { id: 9, name: "Private study with a very long room identity", porosity: "closed", porosity_label: "Knock only", member_count: 2, viewer_state: "none", actions: { enter: false, join: false, request_join: false, knock: false } }] };
    else if (path.endsWith("/members")) body = { members: [{ id: 1, user_id: 1, display_username: "Rowan", presence: { is_here: true }, location: { room_id: roomId, name: names[roomId] } }] };
    else if (path.endsWith("/pairs")) body = { pairs: [] };
    else if (path.endsWith("/chat/messages")) body = { messages: Array.from({ length: 35 }, (_, index) => ({ id: index + 1, kind: "message", body: `A Room sketch ${index + 1}`, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `A Room sketch ${index + 1}` }] }] }, author: { id: 2, display_username: "Mira" }, created_at: "2026-10-10T10:00:00.000Z", fire_at: "2026-10-10T10:00:00.000Z", expires_at: "2026-10-11T10:00:00.000Z", lifecycle: "active", mine: false, entry: null, reply_count: 0, client_nonce: null })), next_cursor: null, present_user_ids: [1, 2], viewer_user_id: 1, viewer_access: { kind: "member", can_send: true, can_paginate: true, history_limit: null }, server_time: "2026-10-10T10:00:00.000Z" };
    else if (path.endsWith("/rounds/overview")) body = { rounds: [], recentRounds: [], currentRounds: [], activeRound: null, nextRound: null };
    else if (path.endsWith("/rounds")) body = { currentRounds: [], activeRound: null, rounds: [] };
    else if (path.endsWith("/walls")) body = { walls: [] };
    else if (path === "/v1/audio-assets/11") body = { id: 11, title: "Window melody", processing_status: "ready", duration_ms: 20000, waveform_peaks: [0.2, 0.5, 0.8, 0.4], playback_url: "/api/v1/audio-assets/11/download", download_url: "/api/v1/audio-assets/11/download", filename: "Window melody.wav", content_type: "audio/wav", source_type: "ChatMessage", source_id: 35, parent_chat_message_id: 35, room_id: 7 };
    else if (path === "/v1/memberships") body = { user: { id: 1, username: "Rowan" }, memberships: [] };
    else if (path === "/v1/unseen/count") body = { total: 0, entries: 0, replies: 0 };
    else if (path === "/v1/projects/home") body = { today: "2026-10-10", rounds: [], recentRooms: [], totalRoomUnseenCount: 0, recentProjects: [], recentEntries: [], contributions: [] };
    if (withAudio && path.endsWith("/chat/messages")) {
      const messages = (body as { messages: Array<{ content: unknown }> }).messages;
      messages[messages.length - 1].content = { type: "doc", content: [{ type: "audio", attrs: { audioAssetId: 11, title: "Window melody", status: "ready" } }] };
    }
    await route.fulfill({ json: body });
  });
}

