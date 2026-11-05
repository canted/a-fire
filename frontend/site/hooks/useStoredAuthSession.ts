import { sessionSubject } from "../../src/lib/api/transport";
import { useEffect, useState } from "react";

function readStorageValue(key: string): string | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function isExpiredJwt(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = window.atob(payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "="));
    const parsed = JSON.parse(decoded) as { exp?: number };
    if (!parsed.exp) return false;

    return parsed.exp <= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function hasStoredAuthSession(): boolean {
  const refreshToken = readStorageValue("refreshToken");
  if (refreshToken) return true;

  const accessToken = readStorageValue("accessToken");
  return Boolean(accessToken && !isExpiredJwt(accessToken));
}

function readSessionState() {
  const isAuthenticated = hasStoredAuthSession();
  // This unverified identity partitions client caches only. The server authorizes requests.
  const sessionIdentity = isAuthenticated ? sessionSubject({
    accessToken: readStorageValue("accessToken") ?? "",
    refreshToken: "",
  }) : null;
  return { isAuthenticated, sessionIdentity };
}

export function useStoredAuthSession() {
  const [, setRevision] = useState(0);

  useEffect(() => {
    const handleStorage = () => setRevision(revision => revision + 1);

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return readSessionState();
}
