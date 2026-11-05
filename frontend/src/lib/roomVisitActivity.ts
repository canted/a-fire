// Native foreground/input renewal remains part of the deferred native milestone.
export function observeRoomVisitActivity(activity: () => void) {
  activity();
  return () => {};
}
