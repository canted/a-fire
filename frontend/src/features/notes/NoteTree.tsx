import { useEffect, useRef, useState, type Ref } from "react";
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { NoteTreeNode } from "../../lib/api/notes";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { tokens } from "../../styles/tokens";

type Props = {
  nodes: NoteTreeNode[];
  onOpen: (node: NoteTreeNode) => void;
  onMenu?: (node: NoteTreeNode) => void;
  menuId?: number;
  menuRef?: Ref<View>;
  destination?: boolean;
  selectable?: (node: NoteTreeNode) => boolean;
  disabled?: boolean;
};
/** One hierarchical presentation for reading Notes and choosing a move destination. */
export function NoteTree(props: Props) {
  return (
    <View>
      {props.nodes.map((node) => (
        <Branch key={node.id} {...props} node={node} />
      ))}
    </View>
  );
}
function Branch({ node, ...props }: Props & { node: NoteTreeNode }) {
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(0);
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const caret = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(progress, {
        toValue: open ? 1 : 0,
        duration: reduced ? 0 : 180,
        easing: Easing.ease,
        useNativeDriver: false,
      }),
      Animated.timing(caret, {
        toValue: open ? 1 : 0,
        duration: reduced ? 0 : 160,
        easing: Easing.ease,
        useNativeDriver: false,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [open, reduced, progress, caret]);
  return (
    <View>
      <View style={styles.row}>
        {node.children.length ? (
          <Button
            emphasis="bare"
            style={styles.disclosure}
            expanded={open}
            accessibilityLabel={`${open ? "Collapse" : "Expand"} ${node.title || "Untitled note"}`}
            onPress={() => setOpen((value) => !value)}
          >
            <Animated.View
              style={{
                transform: [
                  {
                    rotate: caret.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["180deg", "270deg"],
                    }),
                  },
                ],
              }}
            >
              <Icon name="caretLeft" size={14} />
            </Animated.View>
          </Button>
        ) : (
          <View style={styles.spacer} />
        )}
        <Button
          emphasis="bare"
          style={styles.link}
          disabled={props.disabled || props.selectable?.(node) === false}
          accessibilityLabel={node.title || "Untitled note"}
          onPress={() => props.onOpen(node)}
        >
          {node.icon && <Text style={styles.icon}>{node.icon}</Text>}
          <Text numberOfLines={1} style={styles.title}>
            {node.title || "Untitled note"}
          </Text>
        </Button>
        {props.destination && props.selectable?.(node) !== false && (
          <Button
            emphasis="outline"
            shape="pill"
            size="sm"
            disabled={props.disabled}
            accessibilityLabel={`Save to ${node.title || "Untitled note"}`}
            onPress={() => props.onOpen(node)}
          >
            Save to note
          </Button>
        )}
        {props.onMenu && (
          <Button
            emphasis="bare"
            style={styles.menu}
            ref={props.menuId === node.id ? props.menuRef : undefined}
            accessibilityLabel={`Note actions for ${node.title || "Untitled note"}`}
            onPress={() => props.onMenu?.(node)}
          >
            <Icon name="dotsThree" size={18} />
          </Button>
        )}
      </View>
      {Boolean(node.children.length) && (
        <Animated.View
          {...(Platform.OS === "web"
            ? { "aria-hidden": !open, inert: !open }
            : {})}
          pointerEvents={open ? "auto" : "none"}
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? "auto" : "no-hide-descendants"}
          style={{
            height: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, height],
            }),
            opacity: progress,
            overflow: "hidden",
          }}
        >
          <View
            style={styles.children}
            onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
          >
            <NoteTree {...props} nodes={node.children} />
          </View>
        </Animated.View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  row: { minHeight: 44, flexDirection: "row", alignItems: "center" },
  spacer: { width: 24 },
  disclosure: { width: 24, minHeight: 44, padding: 0 },
  link: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    justifyContent: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 8,
  },
  title: {
    flexShrink: 1,
    fontFamily: "BarlowCondensedSemibold",
    fontSize: 18,
    color: tokens.ink,
  },
  icon: { fontSize: 24 },
  menu: { width: 44, padding: 0 },
  children: { position: "absolute", left: 20, right: 0, top: 0 },
});
