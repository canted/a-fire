/** The only routing boundary that accepts historical domain names. */
export function expoRouteAlias(value: string): string | undefined {
  if (!value.startsWith('/app/')) return undefined;
  const split = value.search(/[?#]/);
  const path = split < 0 ? value : value.slice(0, split);
  const suffix = split < 0 ? '' : value.slice(split);
  if (path.split('/').some(segment => !/^[a-zA-Z0-9_-]*$/.test(segment))) return undefined;
  let destination = path;
  if (/^\/app\/(?:circles|communities)(?:\/(?:new|all|[1-9]\d*)(?:\/.*)?)?$/.test(path)) {
    destination = path.replace(/^\/app\/(?:circles|communities)/, '/app/rooms');
  } else if (/^\/app\/post\/[1-9]\d*(?:\/(?:project|new-reply))?$/.test(path)) {
    destination = path.replace('/post/', '/entries/');
  } else if (path === '/app/new-post') {
    destination = '/app/new-entry';
  } else if (/^\/app\/page\/[1-9]\d*(?:\/audio-reply)?$/.test(path)) {
    destination = path.replace('/page/', '/note/');
  }
  if (destination === '/app/rooms') destination = '/app/rooms/all';
  if (/^\/app\/rooms\/[1-9]\d*\//.test(destination)) {
    destination = destination
      .replace(/\/pages(?=\/|$)/, '/notes')
      .replace(/\/activities$/, '/rounds')
      .replace(/\/side-circles$/, '/adjacent-rooms')
      .replace(/\/first-post-prompt$/, '/first-entry-prompt')
      .replace(/\/chat-prototype$/, '/chat');
  }
  return destination !== path ? destination + suffix : undefined;
}
