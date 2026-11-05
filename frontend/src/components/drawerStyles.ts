import { StyleSheet } from "react-native";
import { tokens } from "../styles/tokens";
/** Shared surface for modal drawers and the routed chat drawer. */
export const drawerStyles = StyleSheet.create({
  panel: { backgroundColor: tokens.paper, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderWidth: 0, overflow: "hidden" },
});
