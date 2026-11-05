import type { RefObject } from "react";
import type { TextInput } from "react-native";
/** Native TextInput accepts text; file selection belongs exclusively to ReplyComposer. */
export function useChatPaste(_input: RefObject<TextInput | null>, _enabled: boolean) {}
