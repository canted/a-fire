import { useAudioDeepLinkPlayback } from "../../hooks/useAudioDeepLinkPlayback";
import { useHistoryMotion } from "../../hooks/useHistoryMotion";
import type { ReactNode } from "react";
import { Redirect, Stack, usePathname } from "expo-router";
import { ActivityIndicator, Platform, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { sessionReturnPath } from "../../lib/roomLinks";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { useSession } from "../../hooks/useSession";
import { layout } from "../../styles/layout";

export function SessionLayout() {
  useHistoryMotion();
  useAudioDeepLinkPlayback();
  const reducedMotion = useReducedMotion();
  // Keep route registration mounted while restoring/authenticating. Otherwise
  // the nested path and its message anchor are normalized away before redirect.
  return (
    <Stack
      screenOptions={({ route }) => ({
        headerShown: false,
        headerBackButtonMenuEnabled: false,
        animation:
          Platform.OS === "web" ? "none" : reducedMotion ? "fade" : "default",
        ...(route.name ===
          "projects/[projectId]/entries/[entryId]/media/[mediaIndex]"
          ? {
              presentation: "transparentModal",
              animation: "fade",
              gestureEnabled: false,
              contentStyle: { backgroundColor: "transparent" },
            }
          : {}),
      })}
      screenLayout={({ children, route }) => route.name === "rooms/[roomId]" ? children : (
        <SessionGate
          params={route.params as Readonly<Record<string, unknown>> | undefined}
        >
          {children}
        </SessionGate>
      )}
    />
  );
}
export function SessionGate({
  children,
  params,
}: {
  children: ReactNode;
  params?: Readonly<Record<string, unknown>>;
}) {
  const session = useSession();
  const path = usePathname();
  const roomId = typeof params?.roomId === "string" ? params.roomId : undefined;
  const destination = path.startsWith("/app/rooms/")
    ? path
    : roomId && /^\d+$/.test(roomId)
      ? `/app/rooms/${roomId}/chat`
      : path;
  const next = sessionReturnPath(destination, params);
  if (!session.ready)
    return (
      <SafeAreaView style={layout.page}>
        <ActivityIndicator accessibilityLabel="Restoring session" />
      </SafeAreaView>
    );
  if (session.error)
    return (
      <SafeAreaView style={layout.page}>
        <Text accessibilityRole="alert" style={layout.text}>
          {session.error}
        </Text>
      </SafeAreaView>
    );
  if (!session.signedIn)
    return <Redirect href={{ pathname: "/auth", params: { next: session.returnTo ?? next } }} />;
  return children;
}
