import { useKeyboardFocus } from "../../hooks/useKeyboardFocus";
import { InstallationProvider } from "../pwa/Installation";
import { ClientBuildMonitor } from "../clientBuild/ClientBuildMonitor";
import { useWebLifecycle } from "../../hooks/useWebLifecycle";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AudioPlaybackProvider } from "../../hooks/useAudioPlayback";
import { useFonts } from "expo-font";
import { fonts } from "../../styles/fonts";
import { ActivityIndicator, Platform, Text } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider } from "../../hooks/useSession";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { tokens } from "../../styles/tokens";
export function AppLayout() {
  useKeyboardFocus();
  useWebLifecycle();
  const reducedMotion = useReducedMotion();
  const [loaded, error] = useFonts(fonts);
  if (error)
    return <Text>Could not load the app fonts. Restart to try again.</Text>;
  if (!loaded) return <ActivityIndicator accessibilityLabel="Loading A Fire" />;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SessionProvider>
        <AudioPlaybackProvider>
          <InstallationProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                animation:
                  Platform.OS === "web"
                    ? "none"
                    : reducedMotion
                      ? "fade"
                      : "default",
                contentStyle: { backgroundColor: tokens.surface },
              }}
            />
            <ClientBuildMonitor />
          </InstallationProvider>
        </AudioPlaybackProvider>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}
