import { Button } from "./Button";
import { Icon } from "./Icon";
import { tokens } from "../styles/tokens";

/** Native adapter of the existing MediaPlayControl geometry and action contract. */
export function MediaPlayControl({
  label,
  playing,
  onPress,
  disabled,
  size = "regular",
  background = tokens.ink,
  foreground = tokens.paper,
}: {
  label: string;
  playing: boolean;
  onPress: () => void;
  disabled?: boolean;
  size?: "small" | "compact" | "regular" | "large";
  background?: string;
  foreground?: string;
}) {
  const diameter = { small: 24, compact: 32, regular: 48, large: 64 }[size];
  return (
    <Button
      accessibilityLabel={label}
      hitSlop={size === "small" ? 10 : undefined}
      disabled={disabled}
      color={background}
      onPress={onPress}
      style={{
        width: diameter,
        height: diameter,
        minHeight: diameter,
        paddingHorizontal: 0,
        paddingVertical: 0,
        borderRadius: diameter / 2,
      }}
    >
      <Icon
        name={playing ? "pause" : "play"}
        size={(diameter * 7) / 12}
        color={foreground}
      />
    </Button>
  );
}
