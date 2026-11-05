import { type ReactNode, type Ref } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
  type GestureResponderEvent,
  type AccessibilityProps,
} from "react-native";
import { tokens } from "../styles/tokens";

type Props = {
  hitSlop?: number;
  dataSet?: Record<string, string | undefined>;
  ref?: Ref<View>;
  children: ReactNode;
  onPress: (event: GestureResponderEvent) => void;
  accessibilityRole?: AccessibilityProps["accessibilityRole"];
  accessibilityValue?: AccessibilityProps["accessibilityValue"];
  accessibilityActions?: AccessibilityProps["accessibilityActions"];
  onAccessibilityAction?: AccessibilityProps["onAccessibilityAction"];
  disabled?: boolean;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
  hasPopup?: boolean;
  onKeyDown?: (event: {
    nativeEvent: { key: string; repeat?: boolean };
    defaultPrevented?: boolean;
    preventDefault: () => void;
  }) => void;
  emphasis?: "solid" | "ghost" | "link" | "outline" | "bare";
  size?: "sm" | "md" | "icon";
  shape?: "default" | "pill" | "circle";
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  color?: string;
};
export function Button({
  hitSlop,
  accessibilityRole,
  accessibilityValue,
  accessibilityActions,
  onAccessibilityAction,
  dataSet,
  ref,
  children,
  onPress,
  disabled,
  checked,
  selected,
  expanded,
  hasPopup,
  onKeyDown,
  emphasis = "solid",
  size = "md",
  shape = emphasis === "solid" || emphasis === "outline" ? "pill" : "default",
  accessibilityLabel,
  style,
  color,
}: Props) {
  const customStyle = StyleSheet.flatten(style);
  // Fixed-height controls (for example entry FABs) retain their explicit geometry.
  const insetPill = size === "md" && shape === "pill" && customStyle?.height === undefined;
  const insetSurface = size === "sm" || insetPill;
  const targetStyle = insetPill ? { ...customStyle } : style;
  const surfaceStyle: ViewStyle = {};
  if (insetPill && targetStyle) {
    // Layout stays on the touch target; visual overrides belong to the pill.
    const surfaceKeys = [
      "backgroundColor", "borderColor", "borderWidth", "borderRadius",
      "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius",
      "borderBottomRightRadius", "padding", "paddingHorizontal", "paddingVertical",
      "paddingTop", "paddingBottom", "paddingLeft", "paddingRight",
    ] as const;
    for (const key of surfaceKeys) {
      if (customStyle?.[key] !== undefined) {
        Object.assign(surfaceStyle, { [key]: customStyle[key] });
        delete (targetStyle as ViewStyle)[key];
      }
    }
  }
  return (
    <Pressable
      hitSlop={hitSlop}
      {...(Platform.OS === "web" ? { dataSet } : {})}
      ref={ref}
      accessibilityRole={
        accessibilityRole ?? (checked === undefined ? "button" : "checkbox")
      }
      accessibilityValue={accessibilityValue}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{
        disabled: Boolean(disabled),
        ...(checked === undefined ? {} : { checked }),
        ...(expanded === undefined ? {} : { expanded }),
        ...(Platform.OS === "web" || selected === undefined
          ? {}
          : { selected }),
      }}
      {...(Platform.OS === "web" && checked !== undefined
        ? { "aria-checked": checked }
        : {})}
      {...(Platform.OS === "web" && selected !== undefined
        ? { "aria-pressed": selected }
        : {})}
      {...(Platform.OS === "web"
        ? {
            "aria-haspopup": hasPopup ? ("menu" as const) : undefined,
            "aria-expanded": expanded,
            "aria-valuemin": accessibilityValue?.min,
            "aria-valuemax": accessibilityValue?.max,
            "aria-valuenow": accessibilityValue?.now,
            "aria-valuetext": accessibilityValue?.text,
            onKeyDown: (event: Parameters<NonNullable<Props["onKeyDown"]>>[0]) => {
              onKeyDown?.(event);
              // React Native Web handles Enter, but only button roles receive
              // Space activation. Shared checked controls use the checkbox role.
              if (checked !== undefined && !disabled && !event.defaultPrevented &&
                (event.nativeEvent.key === " " || event.nativeEvent.key === "Spacebar")) {
                event.preventDefault();
                if (!event.nativeEvent.repeat) onPress(event as unknown as GestureResponderEvent);
              }
            },
          }
        : {})}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        size === "sm" && styles.smallTarget,
        insetPill && styles.pillTarget,
        size === "icon" && styles.iconTarget,
        !insetSurface && shape === "pill" && styles.pill,
        shape === "circle" && styles.room,
        !insetSurface && emphasis === "outline" && styles.outline,
        !insetSurface && emphasis === "solid" && styles.solid,
        disabled && styles.disabled,
        !insetSurface &&
          color &&
          (emphasis === "outline"
            ? { borderColor: color }
            : emphasis === "solid"
              ? { backgroundColor: color }
              : undefined),
        targetStyle,
      ]}
    >
      {Platform.OS === "web" && hitSlop !== undefined && hitSlop > 0 && (
        <View
          aria-hidden
          style={{ position: "absolute", top: -hitSlop, bottom: -hitSlop, left: -hitSlop, right: -hitSlop }}
        />
      )}
      {insetSurface ? (
        <View
          pointerEvents="none"
          style={[
            styles.small,
            insetPill && styles.pillSurface,
            shape === "pill" && styles.pill,
            emphasis === "outline" && styles.outline,
            emphasis === "solid" && styles.solid,
            color
              ? emphasis === "outline"
                ? { borderColor: color }
                : emphasis === "solid"
                  ? { backgroundColor: color }
                  : undefined
              : undefined,
            insetPill && surfaceStyle,
          ]}
        >
          {typeof children === "string" ? (
            <Text
              style={[
                styles.label,
                size === "sm" ? styles.smallLabel : styles.pillLabel,
                emphasis === "solid" && !color && styles.light,
                emphasis === "link" && styles.link,
                color && emphasis !== "solid" && { color },
              ]}
            >
              {children}
            </Text>
          ) : (
            children
          )}
        </View>
      ) : typeof children === "string" ? (
        <Text
          style={[
            styles.label,
            emphasis === "solid" && !color && styles.light,
            emphasis === "link" && styles.link,
            color && emphasis !== "solid" && { color },
          ]}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: tokens.gutter,
    paddingVertical: 10,
    borderRadius: tokens.radius,
    alignItems: "center",
    justifyContent: "center",
  },
  iconTarget: {
    width: 30,
    height: 44,
    minHeight: 44,
    minWidth: 30,
    paddingHorizontal: 0,
    paddingVertical: 0,
    flexShrink: 0,
  },
  smallTarget: { paddingHorizontal: 0, paddingVertical: 8, minWidth: 44 },
  small: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: tokens.radius,
    alignItems: "center",
  },
  pillTarget: { paddingHorizontal: 0, paddingVertical: 6, minWidth: 44 },
  pillSurface: { paddingHorizontal: 12, paddingVertical: 0, minHeight: 32, justifyContent: "center" },
  pillLabel: { lineHeight: 20 },
  smallLabel: { fontSize: 14 },
  pill: { borderRadius: 999 },
  room: {
    width: 30,
    height: 30,
    minHeight: 30,
    minWidth: 30,
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: 999,
  },
  outline: { borderWidth: 1, borderColor: tokens.ink },
  solid: { backgroundColor: tokens.ink },
  label: { color: tokens.ink, fontSize: tokens.bodySize, fontFamily: "Lato" },
  light: { color: tokens.paper },
  disabled: { opacity: 0.45 },
  link: { textDecorationLine: "underline" },
});
