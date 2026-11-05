import { useWindowDimensions } from "react-native";

export function useViewportGeometry() {
  const { height } = useWindowDimensions();
  return { height, offsetTop: 0, keyboardInset: 0, keyboardOpen: false };
}
