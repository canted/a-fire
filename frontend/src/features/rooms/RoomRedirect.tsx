import { Redirect, useLocalSearchParams } from "expo-router";
export function RoomRedirect() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  return <Redirect href={`/app/rooms/${roomId}`} />;
}

export function SideRoomsRedirect() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  return (
    <Redirect
      href={{
        pathname: "/app/rooms/[roomId]",
        params: { roomId, panel: "side" },
      }}
    />
  );
}
