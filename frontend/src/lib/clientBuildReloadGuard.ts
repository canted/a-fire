const RELOAD_ATTEMPT_PREFIX = "afire.client_build_reload.";
const ATTEMPT_LIMIT = 1;

export type ClientBuildReloadAttempt = {
  targetBuildId: string;
  sourceBuildId: string;
  attemptedAt: number;
  attempts: number;
};

type ReloadStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export function reconcileClientBuildReloadAttempts(currentBuildId: string | null | undefined, storage = browserStorage()): void {
  if (!currentBuildId || !storage) return;

  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (!key?.startsWith(RELOAD_ATTEMPT_PREFIX)) continue;

    const attempt = readReloadAttempt(key, storage);
    if (!attempt || attempt.targetBuildId === currentBuildId) {
      storage.removeItem(key);
    }
  }
}

export function canAutoReloadClientBuild(targetBuildId: string, storage = browserStorage()): boolean {
  if (!storage) return false;

  const attempt = readReloadAttempt(reloadAttemptKey(targetBuildId), storage);
  if (!attempt) return true;
  return attempt.attempts < ATTEMPT_LIMIT;
}

export function recordClientBuildAutoReload(
  targetBuildId: string,
  sourceBuildId: string,
  storage = browserStorage(),
  now = Date.now(),
): void {
  if (!storage) return;

  const key = reloadAttemptKey(targetBuildId);
  const previous = readReloadAttempt(key, storage);
  const attempt: ClientBuildReloadAttempt = {
    targetBuildId,
    sourceBuildId,
    attemptedAt: now,
    attempts: (previous?.attempts ?? 0) + 1,
  };
  storage.setItem(key, JSON.stringify(attempt));
}

export function reloadAttemptKey(targetBuildId: string): string {
  return `${RELOAD_ATTEMPT_PREFIX}${targetBuildId}`;
}

function readReloadAttempt(key: string, storage: ReloadStorage): ClientBuildReloadAttempt | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClientBuildReloadAttempt>;
    if (
      typeof parsed.targetBuildId !== "string" ||
      typeof parsed.sourceBuildId !== "string" ||
      typeof parsed.attemptedAt !== "number" ||
      typeof parsed.attempts !== "number"
    ) {
      storage.removeItem(key);
      return null;
    }
    return parsed as ClientBuildReloadAttempt;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
