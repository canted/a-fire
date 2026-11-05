import { usePanelPresence } from "../hooks/usePanelPresence";
import { drawerStyles } from "./drawerStyles";
import { useViewportGeometry } from "../hooks/useViewportGeometry";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { usePageSurface } from "../hooks/usePageSurface";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Animated,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { tokens } from "../styles/tokens";

type Action = {
  content?: ReactNode;
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  selected?: boolean;
};
type PopupMenuProps = {
  dismissDisabled?: boolean;
  open: boolean;
  title: string;
  actions: Action[];
  onClose: () => void;
  width?: number;
} & (
  | {
      mode: "menu";
      anchor: RefObject<View | null>;
      children?: never;
      footer?: never;
    }
  | {
      mode: "dialog" | "page" | "drawer";
      anchor?: RefObject<View | null>;
      children?: ReactNode;
      footer?: ReactNode;
    }
);
/** One menu owner for migrated contextual actions and selection controls. */
export function PopupMenu({
  open,
  title,
  actions,
  onClose,
  dismissDisabled = false,
  mode,
  anchor,
  children,
  footer,
  width: panelWidth = 240,
}: PopupMenuProps) {
  const page = mode === "page";
  const drawer = mode === "drawer";
  const reducedMotion = useReducedMotion();
  usePageSurface(tokens.surface, tokens.ink, open && page);
  const { width } = useWindowDimensions();
  const { height, offsetTop } = useViewportGeometry();
  const anchored = Platform.OS === "web" && mode === "menu";
  const [panelHeight, setPanelHeight] = useState(0);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const panel = useRef<View>(null);
  const items = useRef<Array<View | null>>([]);
  const drawerMotion = usePanelPresence(drawer && open, panelHeight);
  const backdrop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!drawer) return;
    const animation = Animated.timing(backdrop, {
      toValue: open ? 1 : 0,
      duration: reducedMotion ? 0 : open ? 120 : 200,
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [open, drawer, reducedMotion, backdrop]);
  const firstEnabled = actions.findIndex((action) => !action.disabled);
  useLayoutEffect(() => {
    if (!open || !anchored) {
      setPosition(undefined);
      return;
    }
    let active = true;
    const trigger = anchor?.current;
    if (panelHeight)
      trigger?.measureInWindow((x, y, w, h) => {
        if (!active) return;
        const localY = y - offsetTop;
        const top =
          localY + h + 4 + panelHeight <= height - 12
            ? localY + h + 4
            : localY - panelHeight - 4;
        setPosition({
          left: Math.max(
            12,
            Math.min(x + w - panelWidth, width - panelWidth - 12),
          ),
          top: Math.max(12, Math.min(top, height - panelHeight - 12)),
        });
      });
    return () => {
      active = false;
    };
  }, [
    open,
    anchored,
    anchor,
    width,
    height,
    offsetTop,
    panelHeight,
    panelWidth,
  ]);
  useEffect(() => {
    if (!open) return;
    const trigger = anchor?.current;
    return () => {
      setPosition(undefined);
      if (Platform.OS === "web") trigger?.focus();
    };
  }, [open, anchor]);
  useEffect(() => {
    if (open && (!anchored || position))
      (items.current[firstEnabled] ?? panel.current)?.focus();
  }, [open, anchored, position, firstEnabled]);
  return (
    <Modal
      visible={open || (drawer && drawerMotion.present)}
      animationType="none"
      transparent={!page}
      onRequestClose={() => {
        if (!dismissDisabled) onClose();
      }}
      onShow={() => {
        if (Platform.OS === "web")
          (items.current[firstEnabled] ?? panel.current)?.focus();
      }}
    >
      <SafeAreaView
        {...(Platform.OS === "web" ? {
          onKeyDown: (event: { key: string; stopPropagation: () => void }) => {
            // Native Modal owns Escape on keyup. Keep its earlier keydown
            // from also dismissing the workspace behind this portal.
            if (event.key === "Escape") event.stopPropagation();
          },
        } : {})}
        style={[
          styles.safeArea,
          Platform.OS === "web" && {
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: "auto",
            height,
            transform: [{ translateY: offsetTop }],
          },
        ]}
        edges={page ? ["top", "bottom", "left", "right"] : []}
      >
        <View
          style={[
            styles.overlay,
            anchored && styles.menuOverlay,
            page && styles.pageOverlay,
            mode === "drawer" && styles.drawerOverlay,
          ]}
        >
          {drawer && (
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                styles.backdrop,
                { opacity: backdrop },
              ]}
            />
          )}
          <Button
            emphasis="bare"
            accessibilityLabel={`Dismiss ${title}`}
            disabled={dismissDisabled}
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          >
            <View />
          </Button>
          <Animated.View
            ref={panel}
            onLayout={(event) =>
              setPanelHeight(event.nativeEvent.layout.height)
            }
            pointerEvents={anchored && !position ? "none" : "auto"}
            {...(Platform.OS === "web"
              ? {
                  tabIndex: -1,
                  role: anchored ? "menu" : "dialog",
                  "aria-label": title,
                }
              : {})}
            accessibilityViewIsModal
            style={[
              styles.panel,
              { width: panelWidth },
              anchored
                ? {
                    position: "absolute",
                    left: position?.left ?? 12,
                    top: position?.top ?? 12,
                    opacity: position ? 1 : 0,
                  }
                : undefined,
              page && styles.pagePanel,
              drawer && styles.drawerPanel,
              drawer && drawerStyles.panel,
              drawer && drawerMotion.style,
            ]}
          >
            {!anchored && (
              <View style={styles.heading}>
                <Text accessibilityRole="header" style={styles.title}>
                  {title}
                </Text>
                <Button
                  emphasis="bare"
                  accessibilityLabel={`Close ${title}`}
                  disabled={dismissDisabled}
                  onPress={onClose}
                >
                  <Icon name="x" size={18} />
                </Button>
              </View>
            )}
            <ScrollView keyboardShouldPersistTaps="handled">
              {children}
              {actions.map((action, index) => (
                <Button
                  ref={(view) => {
                    items.current[index] = view;
                  }}
                  onKeyDown={(event) => {
                    const key = event.nativeEvent.key;
                    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(key))
                      return;
                    event.preventDefault();
                    const enabled = actions
                      .map((action, i) => (action.disabled ? -1 : i))
                      .filter((i) => i >= 0);
                    const current = enabled.indexOf(index);
                    const next =
                      key === "Home"
                        ? enabled[0]
                        : key === "End"
                          ? enabled.at(-1)
                          : enabled[
                              (current +
                                (key === "ArrowDown" ? 1 : -1) +
                                enabled.length) %
                                enabled.length
                            ];
                    if (next !== undefined) items.current[next]?.focus();
                  }}
                  key={action.id}
                  accessibilityRole={anchored ? "menuitem" : undefined}
                  emphasis="bare"
                  style={[styles.action, anchored && styles.menuAction]}
                  accessibilityLabel={action.label}
                  selected={action.selected}
                  disabled={action.disabled}
                  onPress={action.onSelect}
                >
                  {action.content ?? <Text style={[styles.label, anchored && styles.menuLabel]}>
                    {action.label}
                  </Text>}
                  {action.selected && <Icon name="checkBold" size={16} />}
                </Button>
              ))}
            </ScrollView>
            {footer}
          </Animated.View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  drawerOverlay: {
    justifyContent: "flex-end",
    padding: 0,
    backgroundColor: "transparent",
  },
  backdrop: { backgroundColor: "rgba(26,37,39,0.15)" },
  drawerPanel: {
    width: "100%",
    maxWidth: 760,
  },
  pageOverlay: { backgroundColor: tokens.surface },
  pagePanel: {
    flex: 1,
    width: "100%",
    maxWidth: 760,
    maxHeight: "100%",
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: tokens.surface,
  },
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(26,37,39,0.15)",
    padding: 12,
  },
  menuOverlay: { backgroundColor: "transparent" },
  menuAction: { minHeight: 32, paddingHorizontal: 10, paddingVertical: 6 },
  menuLabel: { fontSize: 14 },
  panel: {
    boxShadow: "0 8px 24px rgba(26,37,39,0.18)",
    width: 240,
    maxHeight: "80%",
    maxWidth: "100%",
    padding: 8,
    backgroundColor: tokens.paper,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: tokens.border,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    flex: 1,
    fontFamily: "LatoBold",
    fontSize: 14,
    color: tokens.ink,
    padding: 12,
  },
  action: {
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
  },
  label: { fontFamily: "Lato", fontSize: 16, color: tokens.ink, flexShrink: 1 },
});
