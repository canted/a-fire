import { useEffect, useRef, useState, type RefObject } from "react";
import {
  PanResponder,
  type ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type View,
} from "react-native";
import {
  decideGestureAxis,
  type GestureAxis,
} from "../lib/roomMemberCarry";
import { containsCarryPoint } from "../lib/roomMemberCarry";

type Target = {
  view: View;
  accepts: (user: number) => boolean;
  bounds?: { left: number; top: number; right: number; bottom: number };
};
/** Platform gesture adapter; all mutations remain in useRoomDetails.submit. */
export function useRoomMemberCarry(
  enabled: boolean,
  onDrop: (user: number, target: string) => void,
  scroll?: RefObject<ScrollView | null>,
) {
  const current = useRef({ enabled, onDrop });
  current.current = { enabled, onDrop };
  const targets = useRef(new Map<string, Target>());
  const responders = useRef(
    new Map<number, ReturnType<typeof PanResponder.create>>(),
  );
  const draggable = useRef(new Map<number, boolean>());
  const draggedPress = useRef<number | undefined>(undefined);
  const bindings = useRef(
    new Map<
      string,
      { accepts: (user: number) => boolean; ref: (view: View | null) => void }
    >(),
  );
  const session = useRef<{
    user: number;
    axis: GestureAxis;
    startScroll: number;
    dy: number;
    released?: boolean;
    target?: string;
  } | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const contentHeight = useRef(0);
  const scrollY = useRef(0);
  const [drag, setDrag] = useState<{
    user: number;
    x: number;
    y: number;
    target?: string;
  }>();
  const cancel = () => {
    session.current = null;
    setDrag(undefined);
  };
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled]);
  useEffect(
    () => () => {
      session.current = null;
    },
    [],
  );
  const hoveredTarget = (user: number) =>
    [...targets.current].find(
      ([, target]) =>
        target.accepts(user) &&
        target.bounds &&
        containsCarryPoint(target.bounds, pointer.current.x, pointer.current.y),
    )?.[0];
  const refreshHover = () => {
    const active = session.current;
    if (!active) return;
    active.target = hoveredTarget(active.user);
    setDrag((previous) =>
      previous && previous.target !== active.target
        ? { ...previous, target: active.target }
        : previous,
    );
  };
  const measure = () =>
    targets.current.forEach((target) =>
      target.view.measureInWindow((x, y, width, height) => {
        const latest = [...targets.current.values()].find(
          (value) => value.view === target.view,
        );
        if (latest) {
          latest.bounds = {
            left: x,
            top: y,
            right: x + width,
            bottom: y + height,
          };
          refreshHover();
        }
      }),
    );
  useEffect(() => {
    if (!drag || !scroll) return;
    const timer = setInterval(() => {
      scroll.current
        ?.getNativeScrollRef()
        ?.measureInWindow((_x, y, _width, height) => {
          if (!session.current || session.current.released) return;
          const direction =
            pointer.current.y < y + 48
              ? -1
              : pointer.current.y > y + height - 48
                ? 1
                : 0;
          if (direction) {
            scrollY.current = Math.min(
              Math.max(0, contentHeight.current - height),
              Math.max(0, scrollY.current + direction * 60),
            );
            scroll.current?.scrollTo({ y: scrollY.current, animated: false });
            measure();
          }
        });
    }, 180);
    return () => clearInterval(timer);
  }, [Boolean(drag), scroll]);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = event.nativeEvent.contentOffset.y;
    const active = session.current;
    if (active)
      setDrag((previous) =>
        previous
          ? { ...previous, y: active.dy + scrollY.current - active.startScroll }
          : previous,
      );
    measure();
  };
  function targetRef(id: string, accepts: (user: number) => boolean) {
    let binding = bindings.current.get(id);
    if (!binding) {
      binding = {
        accepts,
        ref: (view) => {
          if (view)
            targets.current.set(id, {
              view,
              accepts: (user) => bindings.current.get(id)!.accepts(user),
            });
          else targets.current.delete(id);
        },
      };
      bindings.current.set(id, binding);
    }
    binding.accepts = accepts;
    return binding.ref;
  }
  function handlers(user: number, allowed: boolean) {
    draggable.current.set(user, allowed);
    const existing = responders.current.get(user);
    if (existing) return existing.panHandlers;
    const responder = PanResponder.create({
      onStartShouldSetPanResponderCapture: () => {
        draggedPress.current = undefined;
        session.current = {
          user,
          axis: null,
          startScroll: scrollY.current,
          dy: 0,
        };
        measure();
        return false;
      },
      onMoveShouldSetPanResponderCapture: (_, gesture) => {
        const active = session.current;
        if (!draggable.current.get(user) || !current.current.enabled || !active)
          return false;
        active.axis = decideGestureAxis(active.axis, gesture.dx, gesture.dy);
        return active.axis === "x" && gesture.dx > 0;
      },
      onPanResponderGrant: () => {
        draggedPress.current = user;
        setDrag({ user, x: 0, y: 0 });
        measure();
      },
      onPanResponderMove: (_, gesture) => {
        const active = session.current;
        if (!active) return;
        pointer.current = { x: gesture.moveX, y: gesture.moveY };
        active.dy = gesture.dy;
        const target = hoveredTarget(user);
        active.target = target;
        setDrag({
          user,
          x: gesture.dx,
          y: gesture.dy + scrollY.current - active.startScroll,
          target,
        });
      },
      onPanResponderRelease: (_, gesture) => {
        const released = session.current;
        if (!released) return;
        released.released = true;
        if (gesture) pointer.current = { x: gesture.moveX, y: gesture.moveY };
        // Native scroll events and window measurements can arrive after the last
        // move. Resolve the drop against fresh bounds, not the previous frame.
        const entries = [...targets.current.values()];
        let pending = entries.length;
        const finish = () => {
          if (session.current !== released) return;
          const target = hoveredTarget(user);
          cancel();
          if (
            target &&
            current.current.enabled &&
            targets.current.get(target)?.accepts(user)
          )
            current.current.onDrop(user, target);
        };
        if (!pending) finish();
        entries.forEach((target) =>
          target.view.measureInWindow((x, y, width, height) => {
            target.bounds = {
              left: x,
              top: y,
              right: x + width,
              bottom: y + height,
            };
            if (--pending === 0) finish();
          }),
        );
      },
      onPanResponderTerminate: cancel,
      // A programmatic edge scroll must not steal an axis-locked carry on iOS.
      onPanResponderTerminationRequest: () => session.current?.axis !== "x",
    });
    responders.current.set(user, responder);
    return responder.panHandlers;
  }
  return {
    drag,
    consumeDraggedPress: (user: number) => {
      if (draggedPress.current !== user) return false;
      draggedPress.current = undefined;
      return true;
    },
    handlers,
    targetRef,
    cancel,
    measure,
    onScroll,
    onContentSizeChange: (_width: number, height: number) => {
      contentHeight.current = height;
    },
  };
}
