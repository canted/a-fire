import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSession } from "./useSession";
import { MediaPlaybackSession } from "../lib/mediaPlayback";

const sessions = new WeakMap<object, MediaPlaybackSession>();
export function usePlaybackSession() {
  const { draftScope } = useSession();
  let session = sessions.get(draftScope);
  if (!session) {
    session = new MediaPlaybackSession();
    sessions.set(draftScope, session);
  }
  return session;
}
export function usePauseMediaPlayback() {
  const { draftScope } = useSession();
  return useCallback(
    () => sessions.get(draftScope)?.pauseActive(),
    [draftScope],
  );
}
/** Position survives virtual-row recycling; players and private bytes do not. */
export function useMediaPlayback(
  key: string,
  controls: {
    pause: () => void;
    position: number;
    seek: (seconds: number) => void;
  },
  loaded: boolean,
) {
  const state = usePlaybackSession();
  const owner = useRef(Symbol("media-player")).current;
  const current = useRef(controls);
  current.current = controls;
  const restored = useRef(false);
  const pause = useCallback(() => {
    // Expo releases shared player objects during unmount. Cleanup may follow
    // that release; navigation/foreground pauses still capture live positions.
    try {
      state.remember(key, owner, current.current.position);
      current.current.pause();
    } catch {
      /* The native player has already been released. */
    }
    state.paused(owner);
  }, [key, state, owner]);
  useEffect(() => {
    if (loaded && !restored.current) {
      restored.current = true;
      const position = state.position(key);
      if (position) current.current.seek(position);
    }
  }, [loaded, state, key]);
  // Capture status updates while the shared native object is still alive;
  // Expo may dispose it before React runs unmount cleanup.
  useEffect(() => {
    state.remember(key, owner, controls.position);
  }, [state, key, owner, controls.position]);
  useFocusEffect(useCallback(() => () => pause(), [pause]));
  useEffect(() => {
    const listener = AppState.addEventListener("change", (value) => {
      if (value !== "active") pause();
    });
    return () => {
      listener.remove();
      pause();
    };
  }, [pause]);
  return useCallback(() => {
    state.activate(key, owner, pause);
  }, [state, key, owner, pause]);
}
