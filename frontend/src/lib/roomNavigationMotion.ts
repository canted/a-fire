/** Diagonal motion belongs only to crossing Home/Room or entering another Room. */
export function isRoomNavigation(from: string, to: string): boolean {
  const room = (path: string) => /^\/app\/rooms\/([1-9]\d*)(?:\/chat)?\/?$/.exec(path.split(/[?#]/)[0])?.[1];
  const home = (path: string) => /^\/app\/?$/.test(path.split(/[?#]/)[0]);
  const source = room(from), destination = room(to);
  return Boolean((source && destination && source !== destination) || (source && home(to)) || (home(from) && destination));
}
