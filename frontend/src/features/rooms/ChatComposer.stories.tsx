import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ChatComposer } from "./ChatComposer";
import { emptyRoomDraft, type RoomDraft } from "../../lib/chatComposition";
import { useMentionTargets } from "../../hooks/useMentionTargets";
import type { useRoomDraft } from "../../hooks/useRooms";
import type { useChatComposition } from "../../hooks/useChatComposition";
import { layout } from "../../styles/layout";

export default { title: "Expo/Rooms/Chat composer", component: ChatComposer };

type State = "empty" | "sending" | "failed" | "uncertain";
function Fixture({ state = "empty", narrow = false }: { state?: State; narrow?: boolean }) {
  const [value, setValue] = useState<RoomDraft>(() => ({
    ...emptyRoomDraft(),
    text: state === "empty" ? "" : "I left a little more space in this version.",
    ...(state === "uncertain" ? { pending: {
      body: "I left a little more space in this version.", nonce: "story-uncertain-send", revision: 0,
      content: { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text: "I left a little more space in this version." }] }] },
    } } : {}),
  }));
  const current = useRef(value);
  current.current = value;
  const [error, setError] = useState<string | null>(state === "failed" || state === "uncertain" ? "Could not confirm delivery. Retry the same message." : null);
  const [sent, setSent] = useState(false);
  // The production presentation consumes typed fixture state; no requests are sent.
  const mentions = useMentionTargets(undefined, false);
  const draft: ReturnType<typeof useRoomDraft> = {
    ...value,
    read: () => current.current,
    update: patch => setValue(previous => ({ ...previous, ...(typeof patch === "function" ? patch(previous) : patch) })),
  };
  const composition: ReturnType<typeof useChatComposition> = {
    mentions, error, setError, busy: state === "sending", stage: state === "sending" ? "sending" : "idle",
    send: async () => { setValue(emptyRoomDraft()); setError(null); setSent(true); },
  };
  return <View style={[styles.frame, narrow && styles.narrow]}>
    <Text style={layout.text}>Room Chat</Text>
    <ChatComposer title="the Room" draft={draft} composition={composition} />
    {sent && <Text accessibilityLiveRegion="polite" style={layout.muted}>Message sent in this preview.</Text>}
  </View>;
}
export const Empty = () => <Fixture />;
export const Sending = () => <Fixture state="sending" />;
export const FailedSend = () => <Fixture state="failed" />;
export const UncertainDelivery = () => <Fixture state="uncertain" />;
export const NarrowFailedSend = () => <Fixture state="failed" narrow />;
const styles = StyleSheet.create({ frame: { width: "100%", maxWidth: 720, alignSelf: "center", padding: 16, gap: 24 }, narrow: { maxWidth: 390 } });
