import { useState } from "react";
import { Icon } from "../../components/Icon";
import { StyleSheet, Text, View } from "react-native";
import { RecordingDrawer } from "./RecordingDrawer";
import { Button } from "../../components/Button";
import type { useDocumentAttachments } from "../../hooks/useDocumentAttachments";
import { layout } from "../../styles/layout";

export function DocumentAttachmentControls({
  attachments,
  disabled,
  media,
}: {
  attachments: ReturnType<typeof useDocumentAttachments>;
  disabled?: boolean;
  media?: readonly string[];
}) {
  const [recorderOpen, setRecorderOpen] = useState(false);
  const { recording, attachment } = attachments;
  const busy = disabled || attachments.busy;
  return (
    <>
      <View style={[styles.wrap, styles.actions]}>
        <Button
          style={styles.target}
          emphasis="bare"
          disabled={busy}
          onPress={() => {
            void attachments.pick("file");
          }}
          accessibilityLabel="Attach file"
        >
          <Icon name="paperclip" size={28} />
        </Button>
        {(!media || media.includes("image") || media.includes("video")) && (
          <Button
            style={styles.target}
            emphasis="bare"
            disabled={busy}
            onPress={() => {
              void attachments.pick("photo");
            }}
            accessibilityLabel="Choose photo"
          >
            <Icon name="imageSquare" size={28} />
          </Button>
        )}
        {(!media || media.includes("image")) && (
          <Button
            style={styles.target}
            emphasis="bare"
            disabled={busy}
            onPress={() => {
              void attachments.pick("camera");
            }}
            accessibilityLabel="Take photo"
          >
            <Icon name="camera" size={28} />
          </Button>
        )}
        {(!media || media.includes("audio")) && (
          <Button
            style={styles.target}
            emphasis="bare"
            disabled={busy}
            onPress={() => {
              setRecorderOpen(true);
            }}
            accessibilityLabel="Record audio"
          >
            <Icon name="microphone" size={28} />
          </Button>
        )}
      </View>
      <RecordingDrawer
        recording={recording}
        open={recorderOpen}
        onClose={() => setRecorderOpen(false)}
      />
      {attachment && !attachments.busy && (
        <View style={layout.section}>
          <Text style={layout.text}>{attachment.name}</Text>
          <Button
            style={styles.target}
            disabled={busy}
            onPress={() => {
              void attachments.insert();
            }}
          >
            Retry attachment
          </Button>
          <Button
            style={styles.target}
            emphasis="link"
            disabled={busy}
            onPress={() => {
              void attachments.remove();
            }}
          >
            Remove attachment
          </Button>
        </View>
      )}
    </>
  );
}
const styles = StyleSheet.create({
  actions: { justifyContent: "center", alignItems: "center" },
  target: { minHeight: 48, minWidth: 48 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
