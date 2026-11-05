import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useClientBuildStatus } from "../../hooks/useClientBuildStatus";
import {
  canAutoReloadClientBuild,
  reconcileClientBuildReloadAttempts,
  recordClientBuildAutoReload,
} from "../../hooks/clientBuildReloadGuard";
import { hasClientBuildReloadBlockers } from "../../hooks/clientBuildReloadBlockers";
import { ClientBuildUpdateToast } from "./ClientBuildUpdateToast";

type ClientBuildMonitorProps = {
  reloadPage?: () => void;
};

export function ClientBuildMonitor({ reloadPage = defaultReloadPage }: ClientBuildMonitorProps) {
  const { currentBuildId, latestBuildId, updateAvailable } = useClientBuildStatus({
    enabled: isClientBuildRefreshPath(),
  });
  const promptedTargetRef = useRef<string | null>(null);

  useEffect(() => {
    reconcileClientBuildReloadAttempts(currentBuildId);
  }, [currentBuildId]);

  useEffect(() => {
    if (!currentBuildId || !latestBuildId || !updateAvailable) return;

    if (
      document.visibilityState === "hidden" &&
      !hasClientBuildReloadBlockers() &&
      canAutoReloadClientBuild(latestBuildId)
    ) {
      recordClientBuildAutoReload(latestBuildId, currentBuildId);
      reloadPage();
      return;
    }

    if (promptedTargetRef.current === latestBuildId) return;
    promptedTargetRef.current = latestBuildId;

    let toastId: string | number | undefined;
    toastId = toast.custom(
      () => (
        <ClientBuildUpdateToast
          onReload={() => {
            if (toastId) toast.dismiss(toastId);
            recordClientBuildAutoReload(latestBuildId, currentBuildId);
            reloadPage();
          }}
          onDismiss={() => {
            if (toastId) toast.dismiss(toastId);
          }}
        />
      ),
      { duration: Infinity },
    );
  }, [currentBuildId, latestBuildId, reloadPage, updateAvailable]);

  return null;
}

function defaultReloadPage() {
  window.location.reload();
}

function isClientBuildRefreshPath() {
  if (typeof window === "undefined") return false;
  return window.location.pathname.startsWith("/app") || window.location.pathname.startsWith("/auth");
}
