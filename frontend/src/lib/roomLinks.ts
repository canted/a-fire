import { expoRouteAlias } from './expoRouteAlias';
import { FEEDBACK_TYPES } from './feedback';
import { safeNoteDestination } from './noteLinks';
/** Draft identity survives sign-in without accepting arbitrary return parameters. */
function validSourceParameter(key: string, value: string, params: URLSearchParams) {
  if (key === 'contribution') return ['cover', 'response', 'submission'].includes(value);
  if (key === 'entryMode') return ['choose', 'new', 'project'].includes(value);
  if (key === 'sourceRequest') return /^[a-zA-Z0-9_-]{16,100}$/.test(value);
  if (key === 'shareStarted') return value === '1' && params.has('sourceEntry');
  if (key === 'sourceEntry' && !params.has('sourceProject')) return false;
  return ['sourceProject', 'sourceEntry', 'contributionDraft'].includes(key) && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}
/** Existing web notification anchors plus a query form for native links. */
export function roomMessageTarget(hash?: string, message?: string) {
  const value = hash?.match(/^#?chat-(\d+)$/)?.[1] ?? message;
  return value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? value : null;
}
export function entryReplyTarget(hash?: string, reply?: string) {
  const value = hash?.match(/^#?reply-(\d+)$/)?.[1] ?? reply;
  return value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? value : null;
}
export function safeRoomReturn(value?: string) {
  if (!value) return '/app';
  const alias = expoRouteAlias(value);
  if (alias) return safeRoomReturn(alias);
  if (/^\/app\/(?:user\/new|rooms\/[1-9]\d*\/profile)(?:\?|$)/.test(value)) {
    const url = new URL(value, 'https://local.invalid');
    if (!url.hash && [...url.searchParams].every(([key, item]) => ['roomId', 'communityId'].includes(key) && /^[1-9]\d*$/.test(item))) return value;
  }
  if (/^\/app\/rooms\/[1-9]\d*\/members\/[1-9]\d*(?:\/introductions(?:\?introduction=[1-9]\d*)?)?$/.test(value)) return value;
  if (/^\/app\/rooms\/[1-9]\d*(?:\/chat)?\?panel=side$/.test(value)) return value;
  if (/^\/app\/rooms\/[1-9]\d*\/new-entry\?/.test(value)) {
    const url = new URL(value, 'https://local.invalid');
    if (!url.hash && new Set(url.searchParams.keys()).size === [...url.searchParams].length && [...url.searchParams].every(([key, item]) => validSourceParameter(key, item, url.searchParams))) return value;
  }
  if (/^\/app\/rounds\/[1-9]\d*(?:\/edit)?$/.test(value)) return value;
  if (/^\/app\/rounds\/[1-9]\d*\?/.test(value)) {
    const url = new URL(value, 'https://local.invalid');
    if (!url.hash && new Set(url.searchParams.keys()).size === [...url.searchParams].length && [...url.searchParams].every(([key, item]) => validSourceParameter(key, item, url.searchParams))) return value;
  }
  if (/^\/app\/rooms\/[1-9]\d*\/rounds\/new(?:\?templateKey=(?:feedback|art_before_chorus))?$/.test(value)) return value;
  if (safeNoteDestination(value)) return value;
  if (/^\/app\/rooms\/[1-9]\d*\/(?:new-entry|notes(?:\/new)?|adjacent-rooms|rounds|participation|history|invites|first-entry-prompt)$/.test(value)) return value;
  if (/^\/app\/rooms\/[1-9]\d*\/settings(?:#invites)?$/.test(value)) return value;
  if (/^\/app\/entries\/[1-9]\d*(?:\?reply=[1-9]\d*|#reply-[1-9]\d*)?$/.test(value)) return value;
  if (/^\/app\/entries\/[1-9]\d*\/new-reply(?:\?|$)/.test(value)) {
    const url = new URL(value, 'https://local.invalid');
    if (!url.hash && [...url.searchParams].every(([key, item]) => key === 'audio' ? /^[1-9]\d*$/.test(item) : key === 't' ? /^\d+(?:\.\d+)?$/.test(item) && Number.isFinite(Number(item)) : key === 'feedback_type' && FEEDBACK_TYPES.some(type => type === item))) return value;
  }
  if (/^\/app\/(?:entries\/[1-9]\d*|rooms\/[1-9]\d*\/chat)\?/.test(value)) {
    const url = new URL(value, 'https://local.invalid');
    if (new Set([...url.searchParams.keys()]).size === [...url.searchParams].length && url.searchParams.has('audio') && [...url.searchParams].every(([key, item]) => key === 'audio' ? /^[1-9]\d*$/.test(item) : key === 't' ? /^\d+(?:\.\d+)?$/.test(item) && Number.isFinite(Number(item)) : key === 'audioNode' && /^[a-zA-Z0-9_-]{1,128}$/.test(item)) && (!url.hash || /^#(?:chat|reply)-[1-9]\d*$/.test(url.hash))) return value;
  }
  if (['/app/notices', '/app/activity', '/app/notification-preferences', '/app/profile', '/app/rooms/new', '/app/rooms/all'].includes(value)) return value;
  if (/^\/app\/rooms\/[1-9]\d*\/chat\?wall=[1-9]\d*$/.test(value)) return value;
  if (/^\/app\/projects(?:\/(?:new|[1-9]\d*(?:\/(?:edit|entries\/(?:new|[1-9]\d*(?:\/(?:edit|media\/\d+))?)))?))?$/.test(value)) return value;
  if (/^\/app\/new-entry\?/.test(value)) {
    const url = new URL(value, 'https://local.invalid');
    if (!url.hash && new Set(url.searchParams.keys()).size === [...url.searchParams].length && url.searchParams.has('draftId') && [...url.searchParams].every(([key, item]) => (['draftId', 'activityId'].includes(key) && /^[1-9]\d*$/.test(item)) || validSourceParameter(key, item, url.searchParams))) return value;
  }
  if (/^\/app\/projects\/[1-9]\d*\/entries\/[1-9]\d*\/share(?:\?|$)/.test(value)) {
    const url = new URL(value, 'https://local.invalid');
    if (!url.hash && new Set(url.searchParams.keys()).size === [...url.searchParams].length && [...url.searchParams].every(([key, item]) => key === 'request' ? /^[a-zA-Z0-9_-]{8,100}$/.test(item) : key === 'room' && /^[1-9]\d*$/.test(item))) return value;
  }
  if (/^\/app\/rooms\/[1-9]\d*\/chat\/messages\/[1-9]\d*\/save\?/.test(value)) {
    const url = new URL(value, 'https://local.invalid');
    if (!url.hash && new Set(url.searchParams.keys()).size === [...url.searchParams].length && [...url.searchParams].every(([key, item]) => key === 'request' ? /^[a-zA-Z0-9_-]{16,100}$/.test(item) : key === 'newProject' && item === '1')) return value;
  }
  if (value.startsWith('/app/projects/new?next=')) {
    try {
      const target = decodeURIComponent(value.slice('/app/projects/new?next='.length));
      if (/^\/app\/rooms\/\d+\/chat\/messages\/[1-9]\d*\/save$/.test(target)) return value;
    } catch { /* Invalid encoding is not a valid return path. */ }
    return '/app';
  }
  const match = value.match(/^\/app\/rooms\/(\d+)(?:\/chat(?:\/messages\/[1-9]\d*(?:\/save)?)?)?(?:\?message=([1-9]\d*))?(?:#chat-([1-9]\d*))?$/);
  return match ? value : '/app';
}

/** Preserve supported intent through authentication without accepting an external return URL. */
export function sessionReturnPath(path: string, params?: Readonly<Record<string, unknown>>) {
  const search = new URLSearchParams();
  for (const key of ['newProject', 'contribution', 'contributionDraft', 'entryMode', 'sourceRequest', 'request', 'room', 'sourceProject', 'sourceEntry', 'shareStarted', 'panel', 'origin', 'introduction', 'roomId', 'communityId', 'boardId', 'activityId', 'draftId', 'square_id', 'next', 'wall', 'message', 'reply', 'audio', 'audioNode', 't', 'feedback_type']) {
    if (typeof params?.[key] === 'string') search.set(key, params[key]);
  }
  return safeRoomReturn(path + (search.size ? `?${search}` : '') + (typeof params?.['#'] === 'string' ? `#${params['#']}` : ''));
}
