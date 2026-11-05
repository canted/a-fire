import { useIsFocused } from "expo-router/react-navigation";
import { registerPageSurface } from "../lib/pageSurface";
import { AudioPlayerWidget } from "../features/content/AudioPlayerWidget";
import {
  ViewportToolbarProvider,
  ViewportToolbarHost,
} from "./ViewportToolbar";
import {
  useEffect,
  useLayoutEffect,
  type CSSProperties,
  type ReactNode,
} from "react";
import { acquireDocumentScrollLock } from "../lib/documentScrollLock";
import { useViewportGeometry } from "../hooks/useViewportGeometry";
import { tokens } from "../styles/tokens";
import "../styles/tokens.css";
import styles from "./ViewportShell.module.css";
export function ViewportShell({
  children,
  suppressAudioPlayer = false,
  suppressToolbar = false,
  surface = tokens.surface,
  toolbarSurface,
  entryPage = false,
  floatingAudioPlayer = true,
}: {
  children: ReactNode;
  suppressAudioPlayer?: boolean;
  suppressToolbar?: boolean;
  surface?: string;
  toolbarSurface?: string;
  entryPage?: boolean;
  floatingAudioPlayer?: boolean;
}) {
  const focused = useIsFocused();
  useLayoutEffect(
    () => (focused ? registerPageSurface(surface, tokens.ink) : undefined),
    [focused, surface],
  );
  const viewport = useViewportGeometry();
  useEffect(() => acquireDocumentScrollLock(document, window), []);
  return (
    <ViewportToolbarProvider>
      <div
        data-entry-page={entryPage || undefined}
        data-keyboard-open={viewport.keyboardOpen || undefined}
        className={styles.shell}
        style={
          {
            "--room-surface": surface,
            "--toolbar-surface": toolbarSurface ?? surface,
            height: viewport.height || "100dvh",
            transform: `translateY(${viewport.offsetTop}px)`,
          } as CSSProperties
        }
        data-visual-viewport-scrollable="true"
      >
        {children}
        {!floatingAudioPlayer && !suppressAudioPlayer && <AudioPlayerWidget />}
        <div className={styles.dock}>
          {floatingAudioPlayer && !suppressAudioPlayer && (
            <div className={styles.floatingPlayer}>
              <AudioPlayerWidget />
            </div>
          )}
          {!suppressToolbar && <ViewportToolbarHost />}
        </div>
      </div>
    </ViewportToolbarProvider>
  );
}
