import { StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { tokens } from "../styles/tokens";
export function Checkbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Button
      emphasis="bare"
      checked={checked}
      disabled={disabled}
      accessibilityLabel={label}
      style={styles.row}
      onPress={() => onChange(!checked)}
    >
      <View style={[styles.box, checked && styles.checked]}>
        {checked && <Icon name="checkBold" size={12} color={tokens.paper} />}
      </View>
      <Text style={styles.label}>{label}</Text>
    </Button>
  );
}
const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "flex-start",
    gap: 8,
    paddingHorizontal: 0,
  },
  box: {
    width: 16,
    height: 16,
    borderWidth: 1,
    borderColor: tokens.ink,
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checked: { backgroundColor: tokens.ink },
  label: { fontFamily: "Lato", fontSize: 16, color: tokens.ink, flexShrink: 1 },
});
