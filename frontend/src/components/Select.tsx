import { type ReactNode, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { PopupMenu } from "./PopupMenu";
import { tokens } from "../styles/tokens";
export function Select<Value extends string>({
  label,
  value,
  options,
  disabled,
  onValueChange,
  renderOption,
}: {
  renderOption?: (option: { value: Value; label: string }) => ReactNode;
  label: string;
  value: Value;
  options: readonly { value: Value; label: string }[];
  disabled?: boolean;
  onValueChange: (value: Value) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<View>(null);
  return (
    <View>
      <Button
        ref={anchor}
        hasPopup
        expanded={open}
        emphasis="outline"
        shape="default"
        accessibilityLabel={label}
        disabled={disabled}
        style={styles.trigger}
        onPress={() => setOpen(true)}
      >
        {renderOption ? renderOption(options.find(option => option.value === value) ?? { value, label: value }) : <Text style={styles.label}>
          {options.find((option) => option.value === value)?.label ?? value}
        </Text>}
        <View style={styles.caret}>
          <Icon name="caretLeft" size={16} />
        </View>
      </Button>
      <PopupMenu
        mode="menu"
        open={open}
        title={label}
        anchor={anchor}
        onClose={() => setOpen(false)}
        actions={options.map((option) => ({
          id: option.value,
          label: option.label,
          content: renderOption?.(option),
          selected: value === option.value,
          disabled,
          onSelect: () => {
            onValueChange(option.value);
            setOpen(false);
          },
        }))}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  trigger: {
    minHeight: 48,
    borderRadius: tokens.radiusField,
    borderColor: tokens.border,
    backgroundColor: tokens.surface,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  label: { fontFamily: "Lato", fontSize: 16, color: tokens.ink, flexShrink: 1 },
  caret: { transform: [{ rotate: "-90deg" }] },
});
