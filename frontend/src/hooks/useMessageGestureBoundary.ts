import { createContext, useContext } from "react";

const unprotected = () => {};

// MessageActions owns gesture arbitration. Interactive descendants opt out for
// the current touch; ordinary native Text need not bubble a touch-start event.
export const MessageGestureBoundary = createContext<() => void>(unprotected);
export function useMessageGestureBoundary() {
  return useContext(MessageGestureBoundary);
}

/** The native gesture owner yields held touches to the platform text selection. */
export function useMessageTextSelectable() {
  return true;
}
