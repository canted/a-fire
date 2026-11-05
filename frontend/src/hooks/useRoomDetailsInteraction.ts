import { useState, type RefObject } from "react";
import type { ScrollView } from "react-native";
import type { useRoomDetails } from "./useRoomDetails";
import { useRoomNavigation } from "./useRoomNavigation";
import { useRoomOverlayDismiss } from "./useRoomOverlayDismiss";
import { useRoomMemberCarry } from "./useRoomMemberCarry";
import { introductionPairKey } from "../lib/roomDetailsModel";
type Details = ReturnType<typeof useRoomDetails>;

/** Selection and action transitions; the view retains element focus and scrolling. */
export function useRoomDetailsInteraction({ details, close, compact, scroll, onReturn }: {
  details: Details; close: () => void; compact: boolean;
  scroll: RefObject<ScrollView | null>; onReturn: (target: "side" | "members") => void;
}) {
  const navigation = useRoomNavigation();
  const busy = details.action.isMutating;
  const member = details.room.data?.access?.kind === "member";
  const [selection, setSelection] = useState<number[]>([]);
  const [mode, setMode] = useState<"details" | "side" | "carry" | "introduce">(
    "details",
  );
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<string>();
  const [error, setError] = useState<string>();
  const duplicate =
    selection.length === 2 &&
    details.pairs.data?.pairs.some(
      (pair) =>
        introductionPairKey(...pair.recipient_user_ids) ===
        introductionPairKey(selection[0], selection[1]),
    );
  const changeMode = (next: typeof mode) => {
    if (busy) return;
    if (next === "details") onReturn(mode === "side" ? "side" : "members");
    setMode(next);
    setSelection([]);
    setNote("");
    setFeedback(undefined);
    setError(undefined);
  };
  useRoomOverlayDismiss(mode !== "details", () => changeMode("details"));
  const toggle = (id: number) => {
    if (busy) return;
    setSelection((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : mode === "carry"
          ? [id]
          : mode === "introduce" && current.length === 2
            ? current
            : [...current, id],
    );
  };
  async function run(action: Parameters<Details["submit"]>[0]) {
    setError(undefined);
    try {
      const result = await details.submit(action);
      if (result.destination) {
        close();
        navigation.enter(String(result.destination));
      } else {
        setFeedback(result.message);
        if (action.kind === "introduce" || action.kind === "carry") {
          setMode("details");
          setSelection([]);
          setNote("");
        }
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not complete this action. Try again.",
      );
    }
  }
  const carry = useRoomMemberCarry(
    Boolean(member && !busy && !compact),
    (user, target) => {
      if (target === "side:new") {
        setMode("side");
        setSelection((current) => [...new Set([...current, user])]);
        setFeedback("Added to the new side chat.");
      } else if (target.startsWith("member:")) {
        const other = Number(target.slice(7));
        if (
          details.pairs.data?.pairs.some(
            (pair) =>
              introductionPairKey(...pair.recipient_user_ids) ===
              introductionPairKey(user, other),
          )
        ) {
          setFeedback("These people have already been introduced.");
          return;
        }
        setMode("introduce");
        setSelection([user, other]);
        setNote("");
        setError(undefined);
      } else {
        const room = details.sides.data?.adjacent_rooms.find(
          (room) => `side:${room.id}` === target,
        );
        if (room) void run({ kind: "carry", room, user });
      }
    },
    scroll,
  );
  return { selection, mode, note, setNote, feedback, error, duplicate, changeMode, toggle, run, carry };
}
