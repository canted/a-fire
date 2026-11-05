import type { Ref, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { RoomIcon } from "../../components/RoomIcon";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";

/** Shared Room identity and navigation presentation, including linked workspace pages. */
export function RoomHeader({
  title,
  avatar,
  detailsOpen,
  shelfOpen,
  hasSides,
  detailsRef,
  shelfRef,
  onBack,
  backLabel,
  backToChat = false,
  onDetails,
  onShelf,
  hidden = false,
  loading = false,
  trailing,
  backIcon,
}: {
  trailing?: ReactNode;
  backIcon?: "caretLeft";
  title: string;
  avatar?: string | null;
  detailsOpen: boolean;
  shelfOpen: boolean;
  hasSides: boolean;
  detailsRef: Ref<View>;
  shelfRef: Ref<View>;
  onBack: () => void;
  backLabel: string;
  backToChat?: boolean;
  onDetails: () => void;
  onShelf: () => void;
  hidden?: boolean;
  loading?: boolean;
}) {
  return (
    <View
      style={[
        layout.content,
        styles.bar,
        detailsOpen && styles.open,
        hidden && styles.hidden,
      ]}
    >
      <Button
        accessibilityLabel={backLabel}
        emphasis="ghost"
        hitSlop={4}
        style={[styles.control, backToChat && styles.backToChat]}
        onPress={onBack}
      >
        <Icon
          name={backIcon ?? (backToChat ? "caretCircleLeft" : "arrowUpLeft")}
          size={backToChat ? 28 : 24}
        />
      </Button>
      <Button
        disabled={loading}
        ref={detailsRef}
        expanded={detailsOpen}
        accessibilityLabel={
          detailsOpen ? "Close Room details" : "Open Room details"
        }
        emphasis="ghost"
        style={styles.plaque}
        onPress={onDetails}
      >
        <RoomIcon name={title} avatarUrl={avatar} />
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
      </Button>
      {trailing ?? (hasSides ? (
        <Button
          dataSet={{ wallControl: "side" }}
          ref={shelfRef}
          expanded={shelfOpen}
          accessibilityLabel={
            shelfOpen ? "Close Side Rooms shelf" : "Open Side Rooms shelf"
          }
          emphasis="ghost"
          hitSlop={4}
          style={styles.control}
          onPress={onShelf}
        >
          <View style={styles.sideArrow}>
            <Icon name="arrowUpLeft" size={24} />
          </View>
        </Button>
      ) : (
        <View style={styles.space} />
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  bar: {
    minHeight: 64,
    zIndex: 5,
    backgroundColor: tokens.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  open: { backgroundColor: tokens.paper },
  hidden: { display: "none" },
  control: {
    width: 40,
    height: 40,
    minWidth: 40,
    minHeight: 40,
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: 22,
    backgroundColor: tokens.paper,
  },
  backToChat: { backgroundColor: "transparent" },
  space: { width: 40 },
  plaque: {
    flexShrink: 1,
    height: 44,
    minHeight: 44,
    minWidth: 44,
    maxWidth: 256,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 0,
    borderRadius: 999,
    backgroundColor: tokens.paper,
  },
  title: {
    flexShrink: 1,
    fontFamily: "BarlowCondensedSemibold",
    fontSize: 21,
    color: tokens.ink,
  },
  sideArrow: { transform: [{ rotate: "180deg" }] },
});
