import { useIsFocused } from "expo-router/react-navigation";
import { useLayoutEffect } from "react";
import { registerPageSurface } from "../lib/pageSurface";
export function usePageSurface(
  background?: string,
  foreground?: string,
  enabled = true,
) {
  const focused = useIsFocused();
  useLayoutEffect(
    () =>
      focused && enabled
        ? registerPageSurface(background, foreground)
        : undefined,
    [focused, enabled, background, foreground],
  );
}
