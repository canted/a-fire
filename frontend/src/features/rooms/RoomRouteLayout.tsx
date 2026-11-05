import { Stack, useGlobalSearchParams, useLocalSearchParams, usePathname } from "expo-router";
import { StyleSheet, View } from "react-native";
import { RoomScreen, type RoomRouteParams } from "./RoomScreen";
import { SessionGate } from "../app/SessionLayout";
import { layout } from "../../styles/layout";

/** Root and /chat are two URL states of one mounted Room workspace. */
export function RoomRouteLayout() {
  const params = useLocalSearchParams<{ roomId: string }>();
  const routeParams = useGlobalSearchParams<RoomRouteParams & { roomId?: string }>();
  const roomId = routeParams.roomId ?? params.roomId;
  const path = usePathname().replace(/\/$/, "");
  const root = `/app/rooms/${roomId}`;
  const savingMessage = /^chat\/messages\/[1-9]\d*\/save$/.test(path.slice(root.length + 1));
  const isWorkspace = path === root || path === `${root}/chat` || savingMessage;
  // Keep the nested navigator registered while its screens restore the session.
  // The workspace stays outside individual screens so /chat never remounts it.
  return <View style={layout.page}>
    <View style={[layout.grow, savingMessage && styles.modalStack]}><Stack screenOptions={({ route }) => ({ headerShown: false, animation: "none",
      ...(route.name === "chat/messages/[messageId]/save" ? {
        presentation: "transparentModal", gestureEnabled: false,
        contentStyle: { backgroundColor: "transparent" },
      } : {}),
    })}
      screenLayout={({ children, route }) => <SessionGate params={route.params as Readonly<Record<string, unknown>> | undefined}>{children}</SessionGate>} />
    </View>
    {isWorkspace && <View style={StyleSheet.absoluteFill} pointerEvents={savingMessage ? "none" : "auto"}><SessionGate params={params}>
      <RoomScreen roomId={roomId} routeParams={routeParams} key={roomId} chatOpen={path.endsWith("/chat") || savingMessage} covered={savingMessage} />
    </SessionGate></View>}
  </View>;
}
const styles = StyleSheet.create({ modalStack: { zIndex: 1 } });
export function RoomSurfaceRoute() { return null; }
