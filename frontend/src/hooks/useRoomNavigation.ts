import { useRouter } from "expo-router";
import { markRoomNavigation } from "./useRoomBenchmark";
export function useRoomNavigation() {
  const router = useRouter();
  return {
    ancestor: (href: string) => router.dismissTo(href as "/app"),
    returnTo: (fallback: string = "/app") =>
      (() => {
        if (router.canGoBack()) router.back();
        else router.replace(fallback as "/app");
      })(),
    destination: (href: string) => router.push(href as "/app"),
    thread: (room: string, message: number) =>
      router.push(`/app/rooms/${room}/chat/messages/${message}`),
    save: (room: string, message: number) =>
      router.push(`/app/rooms/${room}/chat/messages/${message}/save`),
    back: (room: string, message: string) =>
      router.canGoBack()
        ? router.back()
        : router.replace(`/app/rooms/${room}/chat?message=${message}`),
    source: (room: string, message: string) =>
      router.dismissTo(`/app/rooms/${room}/chat?message=${message}`),
    parent: (id: string) => {
      markRoomNavigation(id);
      router.dismissTo(`/app/rooms/${id}`);
    },
    enter: (id: string) => {
      markRoomNavigation(id);
      router.push(`/app/rooms/${id}`);
    },
    home: () => {
      if (process.env.EXPO_PUBLIC_ROOM_BENCHMARK === "1")
        console.warn(
          "[Room reading]",
          JSON.stringify({
            event: "home-press",
            canGoBack: router.canGoBack(),
          }),
        );
      router.dismissTo("/app");
    },
  };
}
