import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { useClientBuildStatus } from "../../hooks/useClientBuildStatus.web";
import { useSession } from "../../hooks/useSession";
import {
  hasPendingScopedDrafts,
  subscribePendingScopedDrafts,
} from "../../lib/scopedDrafts";
import {
  hasClientBuildReloadBlockers,
  subscribeClientBuildReloadBlockers,
} from "../../lib/clientBuildReloadBlockers";
import {
  reconcileClientBuildReloadAttempts,
  recordClientBuildAutoReload,
} from "../../lib/clientBuildReloadGuard";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";
export function ClientBuildMonitor({
  reloadPage = () => window.location.reload(),
}: { reloadPage?: () => void } = {}) {
  const { current, latest, available } = useClientBuildStatus();
  const { draftScope } = useSession();
  const [dismissed, setDismissed] = useState<string>();
  const active = useSyncExternalStore(
    subscribeClientBuildReloadBlockers,
    hasClientBuildReloadBlockers,
    () => false,
  );
  const subscribe = useCallback(
    (listener: () => void) =>
      subscribePendingScopedDrafts(draftScope, listener),
    [draftScope],
  );
  const snapshot = useCallback(
    () => hasPendingScopedDrafts(draftScope),
    [draftScope],
  );
  const retained = useSyncExternalStore(subscribe, snapshot, () => false);
  const blocked = active || retained;
  useEffect(() => {
    reconcileClientBuildReloadAttempts(current);
  }, [current]);
  if (!available || !latest || dismissed === latest) return null;
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <Text style={layout.text}>
        {blocked
          ? "An update is ready. Finish or discard your drafts and recordings before updating."
          : "An update to A Fire is ready."}
      </Text>
      <View style={layout.row}>
        <Button
          disabled={blocked}
          onPress={() => {
            // Check the owners again at activation, including changes since render.
            if (
              hasClientBuildReloadBlockers() ||
              hasPendingScopedDrafts(draftScope)
            )
              return;
            recordClientBuildAutoReload(latest, current!);
            reloadPage();
          }}
        >
          Update
        </Button>
        <Button emphasis="ghost" onPress={() => setDismissed(latest)}>
          Later
        </Button>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    bottom: 16,
    left: 16,
    right: 16,
    maxWidth: 560,
    alignSelf: "center",
    zIndex: 100,
    padding: 16,
    gap: 12,
    backgroundColor: tokens.paper,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: tokens.radius,
  },
});
