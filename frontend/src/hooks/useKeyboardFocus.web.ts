import { useEffect } from "react";

/** App-level input modality: text fields must not gain a ring from a tap. */
export function installKeyboardFocus(document: Document) {
  const root = document.documentElement;
  const previous = root.getAttribute("data-keyboard-focus");
  const keyboard = (event: KeyboardEvent) => {
    if (event.key === "Tab") root.setAttribute("data-keyboard-focus", "true");
  };
  const pointer = () => root.removeAttribute("data-keyboard-focus");
  document.addEventListener("keydown", keyboard, true);
  document.addEventListener("pointerdown", pointer, true);
  return () => {
    document.removeEventListener("keydown", keyboard, true);
    document.removeEventListener("pointerdown", pointer, true);
    if (previous === null) root.removeAttribute("data-keyboard-focus");
    else root.setAttribute("data-keyboard-focus", previous);
  };
}
export function useKeyboardFocus() {
  useEffect(() => installKeyboardFocus(document), []);
}
