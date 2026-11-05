import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Text,
  type TextInput,
  View,
} from "react-native";
import { DocumentContent } from "../content/DocumentContent";
import { RecordingDrawer } from "../content/RecordingDrawer";
import { MentionComposerInput } from "../content/MentionComposerInput";
import { useReloadBlocker } from "../../hooks/useReloadBlocker";
import { PopupMenu } from "../../components/PopupMenu";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { AppImage } from "../../components/AppImage";
import { layout } from "../../styles/layout";
import { contentFileSize } from "../../lib/contentFile";
import type { useRoomDraft } from "../../hooks/useRooms";
import type { useEntryComposition } from "../../hooks/useEntryReplies";
import { useChatRecording } from "../../hooks/useChatRecording";
import { useReplyPaste } from "../../hooks/useReplyPaste";
import { pickChatFile } from "../../lib/chatFiles";
import { styles } from "./ReplyComposer.styles";

export function ReplyComposer({
  title,
  draft,
  composition,
  autoFocus = false,
  onEscape,
}: {
  onEscape?: () => void;
  autoFocus?: boolean;
  title: string;
  draft: ReturnType<typeof useRoomDraft>;
  composition: ReturnType<typeof useEntryComposition>;
}) {
  const input = useRef<TextInput>(null);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [fileChoices, setFileChoices] = useState(false);
  const recording = useChatRecording(
    (file) => composition.replaceAttachment(file),
    composition.setError,
  );
  const operationInProgress =
    composition.busy ||
    recording.recording ||
    recording.preparing ||
    Boolean(recording.review);
  const disabled = operationInProgress || Boolean(draft.pending);
  useReloadBlocker(disabled);
  useReplyPaste(input, composition.replaceAttachment, !disabled);
  async function pick(kind: "file" | "photo" | "camera" = "file") {
    setMenu(false);
    setFileChoices(false);
    try {
      const file = await pickChatFile(kind);
      if (file) await composition.replaceAttachment(file);
    } catch (error) {
      composition.setError(
        error instanceof Error
          ? error.message
          : "Could not open files. Try again.",
      );
    }
  }
  return (
    <View style={layout.content}>
      {draft.prefix && (
        <View style={styles.row}>
          <View style={layout.grow}>
            <DocumentContent content={draft.prefix} />
          </View>
          <Button
            emphasis="bare"
            accessibilityLabel="Remove audio timestamp"
            disabled={disabled}
            onPress={() =>
              draft.update((current) => ({
                prefix: undefined,
                revision: current.revision + 1,
              }))
            }
          >
            <Icon name="x" size={16} />
          </Button>
        </View>
      )}
      {composition.error && (
        <Text accessibilityRole="alert" style={layout.text}>
          {composition.error}
        </Text>
      )}
      {composition.busy && (
        <Text accessibilityLiveRegion="polite" style={layout.muted}>
          {composition.stage === "uploading"
            ? "Uploading attachment…"
            : composition.stage === "removing"
              ? "Removing attachment…"
              : "Sending…"}
        </Text>
      )}
      {draft.attachment && (
        <View style={styles.attachment}>
          {draft.attachment.type.startsWith("image/") && (
            <View style={styles.preview}>
              <AppImage
                key={draft.attachment.id}
                src=""
                localPreview={{ uri: draft.attachment.uri }}
                alt={`Selected ${draft.attachment.name}`}
                width={draft.attachment.width}
                height={draft.attachment.height}
                tiled
              />
            </View>
          )}
          <View style={layout.grow}>
            <Text numberOfLines={2} style={layout.text}>
              {draft.attachment.name}
            </Text>
            <Text style={layout.muted}>
              {contentFileSize(draft.attachment.size)}
            </Text>
          </View>
          <Button
            emphasis="ghost"
            disabled={disabled}
            accessibilityLabel="Remove attachment"
            onPress={() => void composition.replaceAttachment()}
            style={styles.target}
          >
            <Icon name="x" size={18} />
          </Button>
        </View>
      )}
      <PopupMenu mode="drawer" open={menu || fileChoices} title="Add attachment" actions={[]}
        onClose={() => { setMenu(false); setFileChoices(false); }}>
            {!fileChoices && (
              <View style={styles.choices}>
                <Button
                  emphasis="ghost"
                  style={styles.choice}
                  onPress={() => void pick("camera")}
                >
                  <Icon name="camera" size={28} />
                  <Text style={styles.choiceLabel}>Camera</Text>
                </Button>
                <Button
                  emphasis="ghost"
                  style={styles.choice}
                  onPress={() => {
                    if (Platform.OS === "web") void pick();
                    else {
                      setMenu(false);
                      setFileChoices(true);
                    }
                  }}
                >
                  <Icon name="paperclip" size={28} />
                  <Text style={styles.choiceLabel}>Choose photo or file</Text>
                </Button>
                <Button
                  emphasis="ghost"
                  style={styles.choice}
                  onPress={() => {
                    setMenu(false);
                    setRecorderOpen(true);
                  }}
                >
                  <Icon name="microphone" size={28} />
                  <Text style={styles.choiceLabel}>Record audio</Text>
                </Button>
              </View>
            )}
            {fileChoices && (
              <View style={styles.choices}>
                <Button
                  emphasis="ghost"
                  style={styles.choice}
                  onPress={() => void pick("photo")}
                >
                  <Icon name="paperclip" size={28} />
                  <Text style={styles.choiceLabel}>Photo library</Text>
                </Button>
                <Button
                  emphasis="ghost"
                  style={styles.choice}
                  onPress={() => void pick()}
                >
                  <Icon name="fileText" size={28} />
                  <Text style={styles.choiceLabel}>Browse files</Text>
                </Button>
              </View>
            )}
      </PopupMenu>
      <RecordingDrawer
        recording={recording}
        open={recorderOpen}
        onClose={() => setRecorderOpen(false)}
      />
      <MentionComposerInput
        input={input}
        placeholder="Reply"
        inputStyle={styles.input}
        draft={draft}
        mentions={composition.mentions}
        title={title}
        disabled={disabled}
        autoFocus={autoFocus}
        onEscape={onEscape}
        onSend={composition.send}
        leading={
          <Button
            accessibilityLabel={
              menu || fileChoices ? "Close attachments" : "Add attachment"
            }
            emphasis="ghost"
            disabled={disabled}
            style={styles.share}
            onPress={() => {
              setMenu(!menu && !fileChoices);
              setFileChoices(false);
            }}
          >
            <Icon name="plusBold" size={20} />
          </Button>
        }
        trailing={
            <Button
              accessibilityLabel={
                draft.pending || (composition.error && draft.staging)
                  ? "Retry send"
                  : "Send"
              }
              emphasis="ghost"
              disabled={operationInProgress || (!draft.text.trim() && !draft.attachment && !draft.pending)}
              style={styles.target}
              onPress={() => void composition.send()}
            >
              {composition.busy ? (
                <ActivityIndicator />
              ) : (
                <Icon name="paperPlaneRight" size={26} />
              )}
            </Button>
        }
      />
    </View>
  );
}
