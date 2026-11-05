/** Shareable exact-Wall links; the modal's server query still enforces membership. */
export function roomWallFromUrl(pathname: string, search: string) {
  const roomId = pathname.match(/^\/app\/rooms\/(\d+)\/chat$/)?.[1];
  const wallId = new URLSearchParams(search).get("wall");
  return roomId && wallId && /^[1-9]\d*$/.test(wallId) ? { roomId, wallId } : undefined;
}
