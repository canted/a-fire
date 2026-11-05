import { describe, expect, it } from "vitest";
import {
  canAutoReloadClientBuild,
  reconcileClientBuildReloadAttempts,
  recordClientBuildAutoReload,
  reloadAttemptKey,
} from "../../../../frontend/site/hooks/clientBuildReloadGuard";

class MemoryStorage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("clientBuildReloadGuard", () => {
  it("allows one automatic reload for a target build", () => {
    const storage = new MemoryStorage();

    expect(canAutoReloadClientBuild("new-build", storage)).toBe(true);

    recordClientBuildAutoReload("new-build", "old-build", storage, 100);

    expect(canAutoReloadClientBuild("new-build", storage)).toBe(false);
  });

  it("allows automatic reload for a newer target build", () => {
    const storage = new MemoryStorage();
    recordClientBuildAutoReload("new-build", "old-build", storage, 100);

    expect(canAutoReloadClientBuild("newer-build", storage)).toBe(true);
  });

  it("clears the matching attempt after a successful reload", () => {
    const storage = new MemoryStorage();
    recordClientBuildAutoReload("new-build", "old-build", storage, 100);

    reconcileClientBuildReloadAttempts("new-build", storage);

    expect(storage.getItem(reloadAttemptKey("new-build"))).toBeNull();
  });

  it("removes corrupt attempt records", () => {
    const storage = new MemoryStorage();
    storage.setItem(reloadAttemptKey("new-build"), "{");

    expect(canAutoReloadClientBuild("new-build", storage)).toBe(true);
    expect(storage.getItem(reloadAttemptKey("new-build"))).toBeNull();
  });
});
