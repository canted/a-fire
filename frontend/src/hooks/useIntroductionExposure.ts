import type { View } from "react-native";
/** Native foreground exposure validation is deferred; never acknowledge on mount. */
export function useIntroductionExposure(
  _id: string,
  _onVisible?: () => void,
): (node: View | null) => void {
  return () => {};
}
