import type { RefObject } from "react";
import type { TextInput } from "react-native";
import type { ChatAttachment } from "../lib/chatComposition";
export function useReplyPaste(
  _input: RefObject<TextInput | null>,
  _attach: (file: ChatAttachment) => Promise<void>,
  _enabled: boolean,
) {}
