import { isContentControl } from "../../lib/contentInteraction";
import type { ReactNode } from "react";
import { GestureDetector } from "react-native-gesture-handler";
import { Animated, Platform, StyleSheet, View } from "react-native";
import { useMessageSwipeAction } from "../../hooks/useMessageSwipeAction";
import type { RoomMessage } from "../../lib/api/room";
import { REVEAL_OFFSET } from "../../lib/chatSwipe";
import { Button } from "../../components/Button";
import { MessageGestureBoundary } from "../../hooks/useMessageGestureBoundary";

/** Gesture enhancement; the explicit action remains keyboard/AT reachable. */
export function MessageActions({
  room,
  message,
  children,
  onSave,
  saveLabel,
  saveDisabled = false,
}: {
  room?: string;
  onSave?: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  message: RoomMessage;
  children: ReactNode;
}) {
  const { surfaceRef, screenReader, offset, revealed, protectedTarget, protectTouch, save, settle, responder, nativeGesture } =
    useMessageSwipeAction({ room, messageId: message.id, onSave, saveDisabled });
  const content = (
    <View
      ref={surfaceRef}
      collapsable={false}
      {...(Platform.OS === "web"
        ? responder.panHandlers
        : {
            onStartShouldSetResponderCapture: () => {
              protectedTarget.current = false;
              return false;
            },
          })}
      onTouchStart={(event) => {
        if (Platform.OS === "web")
          protectedTarget.current ||= isContentControl(event);
      }}
      {...(Platform.OS === "web"
        ? {
            onKeyDown: (event: {
              key: string;
              target: unknown;
              currentTarget: unknown;
              preventDefault(): void;
              stopPropagation(): void;
            }) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "ArrowRight") {
                event.preventDefault();
                event.stopPropagation();
                settle(REVEAL_OFFSET);
              }
              if (revealed && (event.key === "Escape" || event.key === "ArrowLeft")) {
                event.preventDefault();
                event.stopPropagation();
                settle(0);
              }
            },
            tabIndex: 0,
            accessibilityLabel:
              `Message. Swipe right or press Right Arrow to reveal ${saveLabel || "Save to project"}`,
          }
        : {})}
    >
      <View style={styles.swipeArea}>
        <Animated.View
          pointerEvents={revealed ? "auto" : "none"}
          accessibilityElementsHidden={!revealed}
          importantForAccessibility={revealed ? "auto" : "no-hide-descendants"}
          style={[
            styles.reveal,
            {
              opacity: offset.interpolate({
                inputRange: [0, REVEAL_OFFSET],
                outputRange: [0, 1],
                extrapolate: "clamp",
              }),
            },
          ]}
        >
          {revealed && (
            <Button
              style={styles.target}
              emphasis="link"
              accessibilityLabel={saveLabel || `Save revealed message ${message.id} to project`}
              disabled={saveDisabled}
              onPress={save}
            >
              Save
            </Button>
          )}
        </Animated.View>
        <Animated.View
          style={{
            transform: [{ translateX: offset }],
          }}
        >
          {children}
        </Animated.View>
      </View>
      {screenReader && (
        <View style={styles.actions} onTouchStart={protectTouch}>
          <Button
            style={styles.target}
            emphasis="link"
            accessibilityLabel={saveLabel || `Save message ${message.id} to project`}
            disabled={saveDisabled}
            onPress={save}
          >
            Save
          </Button>
        </View>
      )}
    </View>
  );
  return (
    <MessageGestureBoundary value={protectTouch}>
      {Platform.OS === "web" ? (
        content
      ) : (
        <GestureDetector gesture={nativeGesture}>{content}</GestureDetector>
      )}
    </MessageGestureBoundary>
  );
}
const styles = StyleSheet.create({
  swipeArea: { overflow: "hidden", minHeight: 24 },
  reveal: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: REVEAL_OFFSET,
    justifyContent: "center",
  },
  target: { minHeight: 44, paddingVertical: 0 },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },
});
