import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, Text, type TextInput, View } from "react-native";
import { MentionComposerInput } from "../content/MentionComposerInput";
import { LinkPreviewCard } from "../content/LinkPreviewCard";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { useReloadBlocker } from "../../hooks/useReloadBlocker";
import { useChatPaste } from "../../hooks/useChatPaste";
import type { useChatDraft } from "../../hooks/useChatDraft";
import type { useChatComposition } from "../../hooks/useChatComposition";
import { firstLinkPreviewUrl } from "../../lib/linkPreviewDetection";
import { mentionDocument } from "../../lib/plainMentionDraft";
import { layout } from "../../styles/layout";
import { styles } from "./ChatComposer.styles";

/** Room Chat deliberately has no attachment or recording capabilities. */
export function ChatComposer({
  title,
  draft,
  composition,
  autoFocus = false,
  onEscape,
}: {
  title: string;
  draft: ReturnType<typeof useChatDraft>;
  composition: ReturnType<typeof useChatComposition>;
  autoFocus?: boolean;
  onEscape?: () => void;
}) {
  const input = useRef<TextInput>(null);
  const reducedMotion = useReducedMotion();
  const rotation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    rotation.setValue(0);
    if (!composition.busy || reducedMotion) return;
    const spin = Animated.loop(Animated.timing(rotation, {
      toValue: 1, duration: 900, easing: Easing.linear,
      useNativeDriver: Platform.OS !== "web",
    }));
    spin.start();
    return () => { spin.stop(); rotation.setValue(0); };
  }, [composition.busy, reducedMotion, rotation]);
  const disabled = composition.busy || Boolean(draft.pending);
  useReloadBlocker(disabled);
  useChatPaste(input, !disabled);
  return (
    <View style={layout.content}>
      <LinkPreviewCard
        compact
        url={firstLinkPreviewUrl(mentionDocument(draft))}
      />
      {composition.error && (
        <Text accessibilityRole="alert" style={layout.text}>
          {composition.error}
        </Text>
      )}
      <MentionComposerInput
        input={input}
        inputStyle={styles.input}
        draft={draft}
        mentions={composition.mentions}
        title={title}
        disabled={disabled}
        autoFocus={autoFocus}
        onEscape={onEscape}
        onSend={composition.send}
        trailing={
          <View style={styles.sendSlot}>
            <Button
              accessibilityLabel={composition.busy ? "Sending" : draft.pending ? "Retry send" : "Send"}
              emphasis="ghost"
              disabled={composition.busy || (!draft.text.trim() && !draft.pending)}
              style={styles.send}
              onPress={() => void composition.send()}
            >
              {composition.busy ? (
                <Animated.View style={{ transform: [{ rotate: rotation.interpolate({
                  inputRange: [0, 1], outputRange: ["0deg", "360deg"],
                }) }] }}>
                  <Icon name="circleNotch" size={32} />
                </Animated.View>
              ) : draft.pending ? (
                <Text style={styles.retry}>Retry</Text>
              ) : (
                <View style={styles.sendCircle}>
                  <View style={!draft.text.trim() ? styles.inactiveArrow : undefined}><Icon name="arrowUp" size={22} /></View>
                </View>
              )}
            </Button>
          </View>
        }
      />
    </View>
  );
}
