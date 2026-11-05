import { useEffect, useState } from "react";
import {
  getVisualViewportState,
  observeVisualViewport,
} from "../lib/visualViewport";

/** Shells and portalled overlays share the canonical browser viewport observer. */
export function useViewportGeometry() {
  const [viewport, setViewport] = useState(getVisualViewportState);
  useEffect(() => observeVisualViewport(setViewport), []);
  return viewport;
}
