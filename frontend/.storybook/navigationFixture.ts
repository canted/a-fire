import { createContext, createElement, useContext, type ReactNode } from "react";

const Navigation = createContext<(destination: string) => void>(() => {});
export function StoryNavigation({ children, onNavigate }: { children: ReactNode; onNavigate: (destination: string) => void }) {
  return createElement(Navigation.Provider, { value: onNavigate }, children);
}

/** Storybook stays outside Expo Router. No production routing is replaced. */
export function useRoomNavigation() {
  const navigate = useContext(Navigation);
  return {
    destination: navigate,
    ancestor: () => {},
    returnTo: () => {},
    enter: () => {},
    home: () => {},
    parent: () => {},
    thread: () => {},
    save: () => {},
    back: () => {},
    source: () => {},
  };
}
