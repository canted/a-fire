import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { SvgXml } from "react-native-svg";
import { fireFrames } from "../styles/artwork";
export function Fire() {
  const [frame, setFrame] = useState(0);
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value);
    });
    const listener = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => {
      active = false;
      listener.remove();
    };
  }, []);
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(
      () => setFrame((value) => (value + 1) % fireFrames.length),
      200,
    );
    return () => clearInterval(timer);
  }, [reduced]);
  return (
    <SvgXml
      xml={fireFrames[reduced ? 0 : frame]}
      width="100%"
      height="100%"
      aria-hidden={true}
    />
  );
}
