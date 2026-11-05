import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  AccessibilityInfo,
  Platform,
  ScrollView,
  Text,
  type TextInput,
  type StyleProp,
  type TextStyle,
  View,
} from "react-native";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { layout } from "../../styles/layout";
import {
  editMentionDraft,
  insertMention,
  mentionQuery,
  submitsPlainComposer,
} from "../../lib/plainMentionDraft";
import { filterMentionTargets } from "../../lib/mentionTargets";
import type { MentionTarget } from "../../lib/api/mentions";
import type { useMentionTargets } from "../../hooks/useMentionTargets";
import type { useRoomDraft } from "../../hooks/useRooms";
import { styles } from "./MentionComposerInput.styles";

/** Shared text/mention interaction only. Callers supply their own actions and draft policy. */
export function MentionComposerInput({
  input,
  draft,
  mentions,
  title,
  disabled,
  autoFocus = false,
  onEscape,
  onSend,
  leading,
  trailing,
  inputStyle,
  placeholder,
}: {
  input: RefObject<TextInput | null>;
  draft: ReturnType<typeof useRoomDraft>;
  mentions: ReturnType<typeof useMentionTargets>;
  title: string;
  disabled: boolean;
  autoFocus?: boolean;
  onEscape?: () => void;
  onSend: () => Promise<void>;
  leading?: ReactNode;
  trailing?: ReactNode;
  inputStyle?: StyleProp<TextStyle>;
  placeholder?: string;
}) {
  const nativeText = useRef(draft.text);
  const nativeSeed = useRef(draft.text);
  const projectedNativeText =
    nativeText.current === draft.text ? undefined : draft.text;
  // Native typing owns its cursor. Echoing each synchronous external-store
  // update through `value` can apply an older selection during prediction.
  // The session draft still owns persistence; only external edits (mentions,
  // acknowledgement, restored drafts) need to be projected back to the input.
  useLayoutEffect(() => {
    if (nativeText.current !== draft.text) nativeSeed.current = draft.text;
    nativeText.current = draft.text;
  }, [draft.text]);
  const suggestions = useRef<ScrollView>(null);
  const suggestionPositions = useRef<Record<string, number>>({});
  const [selection, setSelection] = useState({
    start: draft.text.length,
    end: draft.text.length,
  });
  const [cursor, setCursor] = useState<{ start: number; end: number }>();
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const query = !disabled && !dismissed ? mentionQuery(draft, selection) : null;
  const targets = query
    ? filterMentionTargets(mentions.data?.targets ?? [], query.query)
    : [];
  const activeTarget = targets.length
    ? targets[selected % targets.length]
    : undefined;
  const selectionAnnouncement = activeTarget
    ? `${activeTarget.label}${activeTarget.subtitle ? `, ${activeTarget.subtitle}` : ""}, ${(selected % targets.length) + 1} of ${targets.length}. ${Platform.OS === "web" ? "Enter" : "Activate"} to mention.`
    : "";
  useEffect(() => {
    if (!activeTarget) return;
    suggestions.current?.scrollTo({
      y: suggestionPositions.current[activeTarget.id] ?? 0,
      animated: false,
    });
    if (Platform.OS !== "web")
      AccessibilityInfo.announceForAccessibility(selectionAnnouncement);
  }, [activeTarget?.id, selectionAnnouncement]);
  function choose(target: MentionTarget) {
    if (!query) return;
    const next = insertMention(draft, query, target);
    draft.update((current) => ({
      text: next.text,
      mentions: next.mentions,
      revision: current.revision + 1,
    }));
    setCursor({ start: next.cursor, end: next.cursor });
    setSelection({ start: next.cursor, end: next.cursor });
    setDismissed(true);
    input.current?.focus();
  }
  return (
    <View>
      {query && (
        <View>
          <Text
            accessibilityLiveRegion="polite"
            role="status"
            style={styles.announcement}
          >
            {selectionAnnouncement}
          </Text>
          <ScrollView
            ref={suggestions}
            keyboardShouldPersistTaps="always"
            style={styles.suggestions}
            accessibilityLabel="Mention suggestions"
          >
            {mentions.isLoading ? (
              <Text style={layout.muted}>Loading mentions…</Text>
            ) : mentions.error ? (
              <Button
                emphasis="link"
                style={styles.target}
                onPress={() => void mentions.mutate()}
              >
                Retry mentions
              </Button>
            ) : !targets.length ? (
              <Text style={layout.muted}>No matching people or Rooms.</Text>
            ) : (
              targets.map((target, index) => (
                <View
                  key={target.id}
                  onLayout={(event) => {
                    suggestionPositions.current[target.id] =
                      event.nativeEvent.layout.y;
                  }}
                >
                  <Button
                    emphasis="ghost"
                    accessibilityLabel={`Mention ${target.label}${target.subtitle ? `, ${target.subtitle}` : ""}`}
                    style={[
                      styles.suggestion,
                      index === selected % targets.length && styles.selected,
                    ]}
                    onPress={() => choose(target)}
                  >
                    <Text style={layout.text}>{target.label}</Text>
                    {target.subtitle && (
                      <Text style={layout.muted}>{target.subtitle}</Text>
                    )}
                  </Button>
                </View>
              ))
            )}
            <Button
              emphasis="link"
              style={styles.target}
              onPress={() => {
                setDismissed(true);
                input.current?.focus();
              }}
            >
              Close mentions
            </Button>
          </ScrollView>
        </View>
      )}
      <View style={styles.row}>
        {leading}
        <Input
          ref={input}
          autoFocus={autoFocus}
          accessibilityLabel={placeholder ?? `Message ${title}`}
          placeholder={placeholder ?? `Message ${title}`}
          multiline
          {...(Platform.OS === "web"
            ? { value: draft.text }
            : {
                defaultValue: projectedNativeText ?? nativeSeed.current,
                value: projectedNativeText,
              })}
          editable={!disabled}
          selection={cursor}
          onChange={(event) => {
            if (Platform.OS === "web") {
              const element = event.target as unknown as HTMLTextAreaElement;
              setSelection({
                start: element.selectionStart,
                end: element.selectionEnd,
              });
            }
          }}
          onSelectionChange={(event) => {
            setSelection(event.nativeEvent.selection);
            setCursor(undefined);
          }}
          onChangeText={(text) => {
            nativeText.current = text;
            draft.update((current) => ({
              ...editMentionDraft(current, text),
              revision: current.revision + 1,
            }));
            setDismissed(false);
            setSelected(0);
          }}
          onKeyPress={(event) => {
            if (Platform.OS !== "web") return;
            const key = event.nativeEvent as typeof event.nativeEvent & {
              shiftKey?: boolean;
              isComposing?: boolean;
              keyCode?: number;
            };
            if (key.isComposing || key.keyCode === 229) return;
            if (
              query &&
              ["ArrowDown", "ArrowUp"].includes(key.key) &&
              targets.length
            ) {
              event.preventDefault();
              setSelected(
                (value) =>
                  (value + (key.key === "ArrowDown" ? 1 : targets.length - 1)) %
                  targets.length,
              );
              return;
            }
            if (query && key.key === "Escape") {
              event.preventDefault();
              setDismissed(true);
              return;
            }
            if (key.key === "Escape" && onEscape) {
              event.preventDefault();
              onEscape();
              return;
            }
            if (submitsPlainComposer(key)) {
              event.preventDefault();
              if (query && targets.length)
                choose(targets[selected % targets.length]);
              else void onSend();
            }
          }}
          onContentSizeChange={(event) => {
            const height = Math.max(
              39.36,
              Math.min(88, event.nativeEvent.contentSize.height),
            );
            if (height !== draft.composerHeight)
              draft.update({ composerHeight: height });
          }}
          style={[styles.composer, inputStyle, { height: draft.composerHeight }]}
        />
        {trailing}
      </View>
    </View>
  );
}
