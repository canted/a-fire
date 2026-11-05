import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { StyleSheet, Text, View } from "react-native";
import { usePathname } from "expo-router";
import { Button } from "../../components/Button";
import { useSession } from "../../hooks/useSession";
import {
  detectInstalled,
  isIosSafari,
  readBoolean,
  writeBoolean,
  observeBrowserInstallation,
  HIDE_INSTALL_KEY,
  type BeforeInstallPromptEvent,
} from "../../lib/browserInstallation";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";
const Context = createContext<{ installed: boolean; show: () => void }>({
  installed: false,
  show: () => {},
});
export function InstallationProvider({ children }: { children: ReactNode }) {
  const { ready, signedIn } = useSession();
  const path = usePathname();
  const eligible = ready && signedIn && path.startsWith("/app");
  const [installed, setInstalled] = useState(detectInstalled);
  const [event, setEvent] = useState<BeforeInstallPromptEvent>();
  const pending = useRef<BeforeInstallPromptEvent | undefined>(undefined);
  const [dismissed, setDismissed] = useState(() =>
    readBoolean(HIDE_INSTALL_KEY),
  );
  const [closed, setClosed] = useState(false);
  const [forced, setForced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(
    () =>
      observeBrowserInstallation({
        available: (next) => {
          pending.current = next;
          setEvent(next);
          setClosed(false);
        },
        changed: setInstalled,
        installed: () => {
          pending.current = undefined;
          setEvent(undefined);
          setInstalled(true);
          setForced(false);
          setClosed(true);
          writeBoolean(HIDE_INSTALL_KEY, true);
          setDismissed(true);
        },
      }),
    [],
  );
  useEffect(() => {
    if (!eligible) {
      setForced(false);
      setError(undefined);
    }
  }, [eligible]);
  const ios = isIosSafari();
  const visible =
    eligible &&
    !installed &&
    !closed &&
    (forced || (!dismissed && (event || ios || busy)));
  const dismiss = (persist: boolean) => {
    setClosed(true);
    setForced(false);
    setError(undefined);
    if (persist) {
      writeBoolean(HIDE_INSTALL_KEY, true);
      setDismissed(true);
    }
  };
  const install = async () => {
    const prompt = pending.current;
    if (!prompt || busy) return;
    // An install event can only be used once, including when the browser rejects it.
    pending.current = undefined;
    setEvent(undefined);
    setBusy(true);
    setError(undefined);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      dismiss(choice.outcome === "accepted");
    } catch {
      setError(
        "Could not open installation. Use your browser menu to install A Fire, or try again later.",
      );
      setForced(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Context.Provider
      value={{
        installed,
        show: () => {
          setForced(true);
          setClosed(false);
          setError(undefined);
        },
      }}
    >
      {children}
      {visible && (
        <View style={styles.banner} accessibilityLiveRegion="polite">
          <Text accessibilityRole="header" style={layout.title}>
            Install A Fire
          </Text>
          <Text style={layout.text}>
            {ios
              ? "Tap Share, then “Add to Home Screen” to open A Fire like an app."
              : event
                ? "Add A Fire to your home screen for quicker access and notifications."
                : "Open your browser menu and look for “Install app” or “Add to Home Screen”. Availability depends on your browser."}
          </Text>
          {error && (
            <Text accessibilityRole="alert" style={layout.text}>
              {error}
            </Text>
          )}
          <View style={[layout.row, styles.actions]}>
            {event ? (
              <Button
                disabled={busy}
                onPress={() => {
                  void install();
                }}
              >
                Install app
              </Button>
            ) : (
              <Button disabled={busy} onPress={() => dismiss(false)}>
                Got it
              </Button>
            )}
            <Button
              disabled={busy}
              emphasis="ghost"
              onPress={() => dismiss(true)}
            >
              Don’t show again
            </Button>
          </View>
        </View>
      )}
    </Context.Provider>
  );
}
export function InstallAppButton() {
  const { installed, show } = useContext(Context);
  return installed ? (
    <Text style={layout.muted}>A Fire is installed</Text>
  ) : (
    <Button emphasis="link" onPress={show}>
      Install A Fire
    </Button>
  );
}
const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    bottom: 16,
    left: 16,
    right: 16,
    maxWidth: 560,
    alignSelf: "center",
    zIndex: 90,
    padding: 16,
    gap: 12,
    backgroundColor: tokens.paper,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: tokens.radius,
  },
  actions: { flexWrap: "wrap" },
});
