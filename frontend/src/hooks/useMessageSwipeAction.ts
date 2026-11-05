import { useCallback, useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Platform, type View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Gesture } from "react-native-gesture-handler";
import { useRoomNavigation } from "./useRoomNavigation";
import { useReducedMotion } from "./useReducedMotion";
import { useScreenReaderEnabled } from "./useScreenReaderEnabled";
import { COMMIT_OFFSET, MAX_SWIPE_OFFSET, REVEAL_OFFSET, rubberBandSwipeOffset } from "../lib/chatSwipe";
import { clearSwipeSelection, hasSwipeSelection } from "../lib/messageSwipeSelection";

/** Owns swipe activation, cancellation and reveal state across platform adapters. */
export function useMessageSwipeAction({ room, messageId, onSave, saveDisabled = false }: {
  room?: string; messageId: import("../lib/api/room").RoomMessage["id"]; onSave?: () => void; saveDisabled?: boolean;
}) {
  const navigation = useRoomNavigation();
  const reduced = useReducedMotion();
  const screenReader = useScreenReaderEnabled();
  const offset = useRef(new Animated.Value(0)).current;
  const current = useRef(0);
  const [revealed, setRevealed] = useState(false);
  const initial = useRef(0);
  const pointerStartX = useRef(0);
  const protectedTarget = useRef(false);
  const selectionBeforeGesture = useRef(false);
  const surfaceRef = useRef<View>(null);
  const restoreFocus = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    const frame = requestAnimationFrame(() => surfaceRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []));
  const nativeProtected = useSharedValue(false);
  const nativeOffset = useSharedValue(0);
  const protectTouch = useCallback(() => {
    protectedTarget.current = true;
    nativeProtected.value = true;
  }, [nativeProtected]);
  const save = () => {
    settle(0);
    if (saveDisabled) return;
    if (onSave) onSave();
    else if (room) {
      restoreFocus.current = true;
      navigation.save(room, messageId);
    }
  };
  const settle = (value: number) => {
    setRevealed(value > 0);
    current.current = value;
    nativeOffset.value = value;
    Animated.timing(offset, {
      toValue: value,
      duration: reduced ? 0 : 180,
      easing: Easing.out(Easing.exp),
      useNativeDriver: Platform.OS !== "web",
    }).start(({ finished }) => { if (finished) offset.setValue(value); });
  };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: (event) => {
          pointerStartX.current = event.nativeEvent.pageX;
          protectedTarget.current = false;
          selectionBeforeGesture.current = hasSwipeSelection();
          return false;
        },
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          !protectedTarget.current &&
          Math.abs(gesture.dx) > 8 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5 &&
          (gesture.dx > 0 || current.current > 0) &&
          !selectionBeforeGesture.current,
        onPanResponderGrant: (event) => {
          if (Platform.OS === "web") event.preventDefault();
          clearSwipeSelection();
          setRevealed(true);
          offset.stopAnimation();
          initial.current =
            -MAX_SWIPE_OFFSET *
            Math.log(1 - current.current / MAX_SWIPE_OFFSET);
          // Web's PanResponder resets dx on grant and can omit moves with the
          // same timestamp. Preserve the complete pointer travel, including
          // the displacement that activated the gesture.
          if (Platform.OS === "web") {
            current.current = rubberBandSwipeOffset(initial.current + event.nativeEvent.pageX - pointerStartX.current);
            offset.setValue(current.current);
          }
        },
        onPanResponderMove: (event, gesture) => {
          if (Platform.OS === "web") event.preventDefault();
          clearSwipeSelection();
          current.current = rubberBandSwipeOffset(initial.current + (Platform.OS === "web" ? event.nativeEvent.pageX - pointerStartX.current : gesture.dx));
          offset.setValue(current.current);
        },
        onPanResponderRelease: (event, gesture) => {
          clearSwipeSelection();
          if (gesture)
            current.current = rubberBandSwipeOffset(
              initial.current + (Platform.OS === "web" ? event.nativeEvent.pageX - pointerStartX.current : gesture.dx),
            );
          if (current.current >= COMMIT_OFFSET) save();
          else settle(current.current >= REVEAL_OFFSET / 2 ? REVEAL_OFFSET : 0);
        },
        onPanResponderTerminate: () => settle(0),
        onPanResponderTerminationRequest: (event) => {
          // Safari can dispatch selectionchange after the move that claimed
          // this gesture. That new selection must not cancel a horizontal swipe.
          if (Platform.OS === "web" && (event.nativeEvent as { type?: string }).type === "selectionchange") {
            clearSwipeSelection();
            return false;
          }
          return true;
        },
        // The current route, motion preference and message identity own the responder.
      }),
    [room, messageId, reduced, onSave, saveDisabled],
  );
  const nativeActive = useSharedValue(false);
  const touchOrigin = useSharedValue({ x: 0, y: 0, time: 0 });
  const startNative = () => {
    setRevealed(true);
    offset.stopAnimation();
    initial.current =
      -MAX_SWIPE_OFFSET * Math.log(1 - current.current / MAX_SWIPE_OFFSET);
  };
  const updateNative = (translation: number) => {
    current.current = rubberBandSwipeOffset(initial.current + translation);
    offset.setValue(current.current);
  };
  const endNative = (translation: number, success: boolean) => {
    if (!success) {
      settle(0);
      return;
    }
    current.current = rubberBandSwipeOffset(initial.current + translation);
    if (current.current >= COMMIT_OFFSET) save();
    else settle(current.current >= REVEAL_OFFSET / 2 ? REVEAL_OFFSET : 0);
  };
  const cancelNative = () => settle(0);
  const nativeGesture = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((event) => {
          "worklet";
          nativeActive.value = false;
          nativeProtected.value = false;
          const touch = event.allTouches[0];
          if (touch)
            touchOrigin.value = {
              x: touch.absoluteX,
              y: touch.absoluteY,
              time: Date.now(),
            };
        })
        .onTouchesMove((event, manager) => {
          "worklet";
          if (nativeActive.value) return;
          const touch = event.allTouches[0];
          if (!touch) return;
          const dx = touch.absoluteX - touchOrigin.value.x,
            dy = touch.absoluteY - touchOrigin.value.y;
          // Activation must run on the UI thread. Held touches belong to native text
          // selection; vertical movement stays with the list.
          if (
            nativeProtected.value ||
            Date.now() - touchOrigin.value.time > 350 ||
            (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx))
          ) {
            manager.fail();
            return;
          }
          if (
            Math.abs(dx) > 8 &&
            Math.abs(dx) > Math.abs(dy) * 1.5 &&
            (dx > 0 || nativeOffset.value > 0)
          )
            manager.activate();
        })
        .onStart(() => {
          "worklet";
          nativeActive.value = true;
          scheduleOnRN(startNative);
        })
        .onUpdate((event) => {
          "worklet";
          scheduleOnRN(updateNative, event.translationX);
        })
        .onEnd((event, success) => {
          "worklet";
          scheduleOnRN(endNative, event.translationX, success);
        })
        .onFinalize((_event, success) => {
          "worklet";
          nativeActive.value = false;
          if (!success) scheduleOnRN(cancelNative);
        }),
    [room, messageId, reduced, onSave, saveDisabled],
  );
  return { surfaceRef, screenReader, offset, revealed, protectedTarget, protectTouch, save, settle, responder, nativeGesture };
}
