import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useStoredAuthSession } from "../../../../frontend/site/hooks/useStoredAuthSession";

const token = (sub: string, exp = Math.floor(Date.now() / 1000) + 3600) => `header.${btoa(JSON.stringify({ sub, exp }))}.signature`;
function change(access: string | null, refresh: string | null = null) {
  if (access) localStorage.setItem("accessToken", access); else localStorage.removeItem("accessToken");
  if (refresh) localStorage.setItem("refreshToken", refresh); else localStorage.removeItem("refreshToken");
  window.dispatchEvent(new StorageEvent("storage", { key: "accessToken", storageArea: localStorage }));
}
afterEach(() => localStorage.clear());

it("distinguishes account switches while remaining signed in and clears identity on logout", () => {
  change(token("alice"), "refresh-a");
  const { result } = renderHook(useStoredAuthSession);
  expect(result.current).toEqual({ isAuthenticated: true, sessionIdentity: "alice" });
  act(() => change(token("bob"), "refresh-b"));
  expect(result.current).toEqual({ isAuthenticated: true, sessionIdentity: "bob" });
  act(() => change(token("bob", Math.floor(Date.now() / 1000) + 7200), "new-refresh-b"));
  expect(result.current).toEqual({ isAuthenticated: true, sessionIdentity: "bob" });
  act(() => change(null));
  expect(result.current).toEqual({ isAuthenticated: false, sessionIdentity: null });
});

it("does not invent a cache identity for a refresh-only or malformed session", () => {
  change(null, "refresh");
  const { result } = renderHook(useStoredAuthSession);
  expect(result.current).toEqual({ isAuthenticated: true, sessionIdentity: null });
  act(() => change("malformed", "refresh"));
  expect(result.current.sessionIdentity).toBeNull();
});

it("does not expose identity for an expired access-only session", () => {
  change(token("expired", 1));
  const { result } = renderHook(useStoredAuthSession);
  expect(result.current).toEqual({ isAuthenticated: false, sessionIdentity: null });
});

it("reads an access identity acquired by same-window refresh on the next render", () => {
  change(null, "refresh");
  const { result, rerender } = renderHook(useStoredAuthSession);
  expect(result.current.sessionIdentity).toBeNull();
  localStorage.setItem("accessToken", token("refreshed"));
  rerender();
  expect(result.current.sessionIdentity).toBe("refreshed");
});
