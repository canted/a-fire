import { useEffect, useRef } from "react";

import { setClientBuildReloadBlocker } from "../../src/lib/clientBuildReloadBlockers";
export { hasClientBuildReloadBlockers, setClientBuildReloadBlocker, clearClientBuildReloadBlockers } from "../../src/lib/clientBuildReloadBlockers";

export function useClientBuildReloadBlocker(blocked: boolean): void {
  const idRef = useRef<string | undefined>(undefined);
  if (!idRef.current) {
    idRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `client-build-blocker-${Math.random().toString(36).slice(2)}`;
  }

  useEffect(() => {
    const id = idRef.current;
    if (!id) return;

    setClientBuildReloadBlocker(id, blocked);
    return () => setClientBuildReloadBlocker(id, false);
  }, [blocked]);
}
