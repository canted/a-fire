import { useEffect, useId } from "react";
import { setClientBuildReloadBlocker } from "../lib/clientBuildReloadBlockers";
export function useReloadBlocker(blocked: boolean) {
  const id = useId();
  useEffect(() => {
    setClientBuildReloadBlocker(id, blocked);
    return () => setClientBuildReloadBlocker(id, false);
  }, [id, blocked]);
}
