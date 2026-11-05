import { styles as mentionStyles } from "../content/MentionComposerInput.styles";
import { StyleSheet } from "react-native";
import { tokens } from "../../styles/tokens";
export const styles = StyleSheet.create({
  input: mentionStyles.pillInput,
  retry: { fontFamily: "LatoBold", fontSize: 12, color: tokens.ink },
  sendSlot: { width: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  sendCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: tokens.paper, alignItems: "center", justifyContent: "center" },
  inactiveArrow: { opacity: 0.45 },
  send: { opacity: 1, width: 44, minHeight: 44, minWidth: 44, paddingHorizontal: 0, paddingVertical: 0 },
});
