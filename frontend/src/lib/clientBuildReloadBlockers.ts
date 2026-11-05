const listeners = new Set<() => void>();
export function subscribeClientBuildReloadBlockers(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
const reloadBlockers = new Set<string>();

export function hasClientBuildReloadBlockers(): boolean {
  return reloadBlockers.size > 0;
}

export function setClientBuildReloadBlocker(id: string, blocked: boolean): void {
  const before = reloadBlockers.size;
  if (blocked) {
    reloadBlockers.add(id);
    if (before !== reloadBlockers.size) listeners.forEach(listener => listener());
    return;
  }
  reloadBlockers.delete(id);
  if (before !== reloadBlockers.size) listeners.forEach(listener => listener());
}

export function clearClientBuildReloadBlockers(): void {
  reloadBlockers.clear();
  listeners.forEach(listener => listener());
}
