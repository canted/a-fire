import { StyleSheet } from "react-native";
import { tokens } from "../../styles/tokens";
export const styles = StyleSheet.create({
  pillInput: { borderWidth: 1, borderColor: tokens.borderStrong, minHeight: 44, borderRadius: 24, paddingHorizontal: 16, backgroundColor: tokens.paper },
  announcement: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
  row: { flexDirection: "row", alignItems: "center" },
  target: { minHeight: 48, minWidth: 48, gap: 6 },
  composer: {
    flex: 1,
    maxHeight: 88,
    minHeight: 39.36,
    borderWidth: 0,
    backgroundColor: tokens.paper,
    paddingHorizontal: 11.52,
    paddingVertical: 7.68,
    lineHeight: 24,
  },
  suggestions: {
    maxHeight: 240,
    borderTopWidth: 1,
    borderTopColor: tokens.muted,
    paddingVertical: 4,
  },
  suggestion: { alignItems: "flex-start", minHeight: 48 },
  selected: { backgroundColor: tokens.surface },
});
