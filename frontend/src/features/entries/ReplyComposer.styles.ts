import { styles as mentionStyles } from "../content/MentionComposerInput.styles";
import { StyleSheet } from "react-native";
import { tokens } from "../../styles/tokens";
export const styles = StyleSheet.create({
  input: mentionStyles.pillInput,
  row: { flexDirection: "row", alignItems: "center" },
  share: {
    minWidth: 48,
    minHeight: 48,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  target: { minHeight: 48, minWidth: 48, gap: 6 },
  choiceLabel: { fontFamily: "Lato", fontSize: 16, color: tokens.ink },
  choice: {
    flexDirection: "row",
    minHeight: 56.8,
    justifyContent: "flex-start",
    gap: 14.4,
    paddingHorizontal: 11.2,
    borderRadius: 10.4,
  },
  choices: { gap: 2.4, paddingTop: 16, paddingBottom: 8 },
  attachment: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  preview: { width: 64, height: 64 },
});
