import { StyleSheet } from "react-native";
import { tokens } from "./tokens";
export const layout = StyleSheet.create({
  page: { flex: 1, backgroundColor: tokens.surface },
  content: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    paddingHorizontal: tokens.gutter,
  },
  audioClearance: { paddingBottom: tokens.viewportContentClearance },
  section: { paddingVertical: tokens.gap, gap: tokens.gap },
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: 44,
    flexShrink: 0,
  },
  appBarTitle: {
    color: tokens.ink,
    fontSize: 18,
    fontFamily: "BarlowCondensedBold",
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: tokens.ink,
    fontSize: tokens.titleSize,
    fontFamily: "BarlowCondensedSemibold",
  },
  text: {
    color: tokens.ink,
    fontSize: tokens.bodySize,
    fontFamily: "Lato",
    lineHeight: 24,
  },
  muted: {
    color: tokens.muted,
    fontSize: tokens.bodySize,
    fontFamily: "Lato",
    lineHeight: 24,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.gutter,
  },
  toolbarControls: { paddingBottom: tokens.toolbarControlPadding },
  entryFab: { width: 56, height: 56, padding: 0 },
  grow: { flex: 1 },
});
