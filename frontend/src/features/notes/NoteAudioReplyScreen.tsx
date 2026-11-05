import { Icon } from "../../components/Icon";
import { useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../../components/Button";
import { ViewportShell } from "../../components/ViewportShell";
import {
  DocumentEditor,
  type DocumentEditorHandle,
} from "../content/DocumentEditor";
import { DocumentAttachmentControls } from "../content/DocumentAttachmentControls";
import { useNoteAudioReply } from "../../hooks/useNoteAudioReply";
import { useDocumentAttachments } from "../../hooks/useDocumentAttachments";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { useDraftNavigation } from "../../hooks/useDraftNavigation";
import {
  normalizeAudioSeconds,
  formatAudioTimestamp,
  hasAudioReplyContent,
} from "../../lib/audioTimestamp";
import { layout } from "../../styles/layout";

export function NoteAudioReplyScreen() {
  const params = useLocalSearchParams<{
    pageId: string;
    audio?: string;
    audioNode?: string;
    t?: string;
  }>();
  if (!params.audio || !/^[1-9]\d*$/.test(params.audio))
    return (
      <ViewportShell suppressAudioPlayer>
        <View style={[layout.content, layout.section]}>
          <Text accessibilityRole="alert" style={layout.text}>
            Audio reply target not found.
          </Text>
        </View>
      </ViewportShell>
    );
  return (
    <AudioReply
      key={`${params.pageId}:${params.audio}:${params.audioNode}:${params.t}`}
      page={params.pageId}
      audio={params.audio}
      audioNode={params.audioNode}
      seconds={normalizeAudioSeconds(params.t)}
    />
  );
}
function AudioReply({
  page,
  audio,
  audioNode,
  seconds,
}: {
  page: string;
  audio: string;
  audioNode?: string;
  seconds: number;
}) {
  const router = useRouter();
  const navigation = useRoomNavigation();
  const reply = useNoteAudioReply(page, audio, audioNode, seconds);
  const editor = useRef<DocumentEditorHandle>(null);
  const [error, setError] = useState<string>();
  const [committing, setCommitting] = useState(false);
  const flight = useRef(false);
  const current = useRef(reply);
  current.current = reply;
  const attachments = useDocumentAttachments(
    Number(page),
    async (node) => {
      const content =
        (await editor.current?.flush()) ?? current.current.content;
      reply.change({ ...content, content: [...(content.content ?? []), node] });
    },
    setError,
  );
  const save = async () => {
    if (editor.current) reply.change(await editor.current.flush());
  };
  const guard = useDraftNavigation({
    protect: Boolean(reply.note.data),
    dirty: false,
    busy: committing || reply.busy || attachments.pending,
    save,
    onError: setError,
  });
  const publish = async () => {
    if (flight.current) return;
    flight.current = true;
    setCommitting(true);
    setError(undefined);
    try {
      const content =
        (await editor.current?.flush()) ?? current.current.content;
      await reply.publish(content);
      guard.release();
      router.replace(`/app/note/${page}#${reply.nodeId}` as "/app");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not publish. Your reply is retained.",
      );
    } finally {
      flight.current = false;
      setCommitting(false);
    }
  };
  const busy = committing || reply.busy || attachments.busy;
  return (
    <ViewportShell suppressAudioPlayer>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[layout.content, layout.section]}
      >
        <Button
          size="icon"
          style={styles.target}
          emphasis="ghost"
          disabled={busy || attachments.pending}
          onPress={() => {
            void save()
              .then(() => navigation.returnTo(`/app/note/${page}`))
              .catch((reason) =>
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Could not retain your reply.",
                ),
              );
          }}
          accessibilityLabel="Back"
        >
          <Icon name="caretCircleLeft" size={28} />
        </Button>
        <Text accessibilityRole="header" style={layout.title}>
          Reply to audio at {formatAudioTimestamp(seconds)}
        </Text>
        {reply.note.isLoading || reply.asset.isLoading ? (
          <ActivityIndicator accessibilityLabel="Loading audio reply" />
        ) : reply.note.error || reply.asset.error || !reply.note.data ? (
          <>
            <Text accessibilityRole="alert" style={layout.text}>
              This Note or audio is unavailable to you.
            </Text>
            <Button
              onPress={() => {
                void Promise.all([
                  reply.note.mutate(),
                  reply.asset.mutate(),
                ]).catch(() => {});
              }}
            >
              Retry audio reply
            </Button>
          </>
        ) : (
          <>
            <DocumentEditor
              attachments={
                <DocumentAttachmentControls
                  attachments={attachments}
                  disabled={busy}
                />
              }
              autoFocus
              ref={editor}
              room={reply.note.data.room_id ?? undefined}
              content={reply.content}
              onChange={reply.change}
              disabled={busy}
            />

            <Button
              style={styles.target}
              disabled={
                busy ||
                attachments.pending ||
                !hasAudioReplyContent(reply.content)
              }
              onPress={() => {
                void publish();
              }}
            >
              {busy ? "Publishing…" : "Publish audio reply"}
            </Button>
          </>
        )}
        {error && (
          <Text accessibilityRole="alert" style={layout.text}>
            {error}
          </Text>
        )}
      </ScrollView>
    </ViewportShell>
  );
}
const styles = StyleSheet.create({ target: { minHeight: 48, minWidth: 48 } });
