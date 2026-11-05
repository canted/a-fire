export type ExposureRect = { x: number; y: number; width: number; height: number };
/** Keep a restored reading anchor visible when rotation or text reflow shrinks its viewport. */
export function readingAnchorTop(savedTop: number | undefined, viewportHeight: number, rowHeight: number) {
  // The top reading anchor can be partly clipped; restoring it must not
  // snap the conversation down merely to expose the whole message.
  if (savedTop !== undefined && savedTop < 0 && savedTop + rowHeight > 0) return savedTop;
  const available = viewportHeight - rowHeight;
  const desired = savedTop ?? Math.max(0, available / 2);
  return Math.max(Math.min(0, available), Math.min(desired, Math.max(0, available)));
}
/** Inverted Chat and forward reply lists move measured rows in opposite directions. */
export function readingAnchorCorrection(desiredTop: number, currentTop: number, inverted: boolean) {
  return inverted ? desiredTop - currentTop : currentTop - desiredTop;
}
/** Half of the area that can fit in the viewport, including oversized messages. */
export function isMessageExposed(row: ExposureRect, viewport: ExposureRect) {
  const width = Math.max(0, Math.min(row.x + row.width, viewport.x + viewport.width) - Math.max(row.x, viewport.x));
  const height = Math.max(0, Math.min(row.y + row.height, viewport.y + viewport.height) - Math.max(row.y, viewport.y));
  const possible = Math.min(row.width, viewport.width) * Math.min(row.height, viewport.height);
  return possible > 0 && width * height >= possible * 0.5;
}

/** A visible edge message cannot always be centered beyond the scroll range. */
export function readingAnchorAtBoundary(offset: number, correction: number, maximum: number, top: number, rowHeight: number, viewportHeight: number) {
  const visible = rowHeight <= viewportHeight ? top >= -2 && top + rowHeight <= viewportHeight + 2 : top <= 2 && top + rowHeight >= viewportHeight - 2;
  return visible && ((offset <= 2 && correction < 0) || (offset >= maximum - 2 && correction > 0));
}
