import { type Ref } from "react";
import { StyleSheet, TextInput, type TextInputProps } from "react-native";
import { tokens } from "../styles/tokens";
export function Input(props: TextInputProps & { ref?: Ref<TextInput> }) {
  return (
    <TextInput
      {...props}
      placeholderTextColor={tokens.muted}
      style={[styles.input, props.style]}
    />
  );
}
const styles = StyleSheet.create({
  input: {
    minHeight: 44,
    padding: tokens.gutter,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: tokens.radiusField,
    backgroundColor: tokens.surface,
    color: tokens.ink,
    fontSize: tokens.bodySize,
    fontFamily: "Lato",
  },
});
