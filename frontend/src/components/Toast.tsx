import { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { tokens } from "../styles/tokens";

/** Transient feedback floats above the dock and never shifts page content. */
export function Toast({ message, onDismiss }: { message?: string | null; onDismiss: () => void }) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => dismiss.current(), 6000);
    return () => clearTimeout(timer);
  }, [message]);
  if (!message) return null;
  return <View pointerEvents="box-none" style={styles.position}>
    <View style={styles.toast}>
      <Text accessibilityLiveRegion="polite" style={styles.text}>{message}</Text>
      <Button emphasis="ghost" accessibilityLabel="Dismiss notice" onPress={onDismiss}><Icon name="x" size={16} /></Button>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  position: { position: "absolute", bottom: 112, left: 12, right: 12, alignItems: "center", zIndex: 100 },
  toast: { flexDirection: "row", alignItems: "center", maxWidth: 560, paddingLeft: 16, backgroundColor: tokens.paper, borderRadius: 12, boxShadow: "0 3px 12px rgba(26,37,39,0.15)" },
  text: { flexShrink: 1, fontFamily: "Lato", fontSize: 14, color: tokens.ink },
});
