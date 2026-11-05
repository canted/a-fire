import { createContext, createElement, useContext, useEffect, type ReactNode } from "react";
type StoryRouter = {
  push(path: string): void;
  replace(path: string): void;
  back(): void;
  canGoBack(): boolean;
  setParams(params: Record<string, unknown>): void;
};
const Router = createContext<StoryRouter | null>(null);
export function StoryRouterProvider({ children, router }: { children: ReactNode; router: StoryRouter }) {
  return createElement(Router.Provider, { value: router }, children);
}
export const Stack = Object.assign(() => null, { Screen: () => null });
// Isolated presentations are always foreground. Real routes are checked separately.
export function useIsFocused() {
  return true;
}

export function useFocusEffect(effect: () => void | (() => void)) {
  useEffect(effect, [effect]);
}

export function useLocalSearchParams() {
  return {};
}
const unavailableNavigation = () => {
  throw new Error("This isolated story does not provide route navigation.");
};
function defaultRouter(): StoryRouter {
  return { push: (_path: string) => unavailableNavigation(), replace: (_path: string) => unavailableNavigation(), back: unavailableNavigation, canGoBack: () => false, setParams: (_params: Record<string, unknown>) => unavailableNavigation() };
}
export function useRouter() {
  return useContext(Router) ?? defaultRouter();
}
export function usePathname() {
  return "/";
}
export const useGlobalSearchParams = useLocalSearchParams;
