import { StyleSheet } from "react-native";
import { tokens } from "../../styles/tokens";

/** Shared Home and share-picker project section presentation. */
export const homeProjectStyles = StyleSheet.create({
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginLeft: 12,
    marginBottom: 6,
    minHeight: 23.4,
  },
  heading: {
    fontFamily: "LatoBold",
    fontSize: 18,
    lineHeight: 23.4,
    color: tokens.ink,
  },
  list: {
    backgroundColor: tokens.paper,
    borderRadius: 16,
    paddingHorizontal: 8,
    marginTop: 16,
    marginBottom: 16,
  },
  listRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 0,
    paddingVertical: 8,
    minHeight: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: `${tokens.ink}22`,
  },
});
