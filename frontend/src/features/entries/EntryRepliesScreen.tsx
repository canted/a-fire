import { appRoutes } from "../../lib/appRoutes";
import { useEntryNoteSave } from "../../hooks/useNotes";
import { NoteTree } from "../notes/NoteTree";
import { RoomHeader } from "../rooms/RoomHeader";
import { Toast } from "../../components/Toast";
import { useEntryWithdrawal } from "../../hooks/useEntryWithdrawal";
import { PopupMenu } from "../../components/PopupMenu";
import { useEntryReplySave } from "../../hooks/useEntryReplySave";
import { seedAudioReply } from "../../lib/entryReplyDraft";
import { normalizeAudioSeconds } from "../../lib/audioTimestamp";
import { ViewportToolbar } from "../../components/ViewportToolbar";
import { EntryContent } from "../content/EntryContent";
import { ProjectIcon } from "../projects/ProjectIcon";
import { UserAvatar } from "../../components/UserAvatar";
import { Icon } from "../../components/Icon";
import { replyAsRoomMessage } from "../../lib/api/chatThread";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { entryReplyTarget } from "../../lib/roomLinks";
import { useMessageReading } from "../../hooks/useRoomReading";
import {
  AccessibilityInfo,
  Platform,
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { plainTextFromTiptap } from "../../lib/tiptap";
import { groupChatAuthors, virtualMessageGroups } from "../../lib/messageGroups";
import type { RoomMessage } from "../../lib/api/room";
import {
  defaultFeedbackType,
  type FeedbackType,
} from "../../lib/feedback";
import { Button } from "../../components/Button";
import { ViewportShell } from "../../components/ViewportShell";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import {
  useEntryReplies,
  useEntryComposition,
} from "../../hooks/useEntryReplies";
import { useRoomDraft } from "../../hooks/useRooms";
import { RoomExposure, useRoomExposure } from "../../hooks/useRoomExposure";
import { ReplyComposer } from "./ReplyComposer";
import { MessageExposure, MessageGroup } from "../rooms/MessageGroup";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";

export function EntryReplyComposerScreen() {
  const { entryId: entryId } = useLocalSearchParams<{ entryId: string }>();
  return <EntryFlow key={entryId} id={entryId} compose />;
}
export function EntryRepliesScreen() {
  const { entryId: entryId } = useLocalSearchParams<{ entryId: string }>();
  return <EntryFlow key={entryId} id={entryId} />;
}
export function EntryFlow({
  id,
  compose = false,
  embedded = false,
  onBack,
  onClose,
  onSelectPost,
}: {
  id: string;
  compose?: boolean;
  embedded?: boolean;
  onBack?: () => void;
  onClose?: () => void;
  onSelectPost?: (id: string) => void;
}) {
  const navigation = useRoomNavigation();
  const router = useRouter();
  const params = useLocalSearchParams<{
    "#": string;
    reply: string;
    audio: string;
    t: string;
    feedback_type: string;
  }>();
  const target = embedded ? null : entryReplyTarget(params["#"], params.reply);
  const readingDraft = useRoomDraft(`post-reading:${id}`);
  const entry = useEntryReplies(id);
  const post = entry.entry.data?.entry;
  const noteSave = useEntryNoteSave(post);
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const [noteFeedback, setNoteFeedback] = useState<string>();
  const replySave = useEntryReplySave(post);
  const withdrawal = useEntryWithdrawal(post);
  const [confirmWithdrawal, setConfirmWithdrawal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<View>(null);
  const roomChip = useRef<View>(null);
  const roomShelf = useRef<View>(null);
  const heading = useRef<Text>(null);
  useEffect(() => {
    if (!embedded || !post) return;
    if (Platform.OS === "web") heading.current?.focus();
    else AccessibilityInfo.announceForAccessibility("Replies");
  }, [embedded, post?.id]);
  const unavailable = Boolean(
    entry.entry.error || (embedded && post && post.status !== "published"),
  );
  const [selected, setSelected] = useState<FeedbackType | null>(null);
  const guided = post?.feedback_request.reply_mode === "guided";
  const feedback = guided
    ? defaultFeedbackType(
        post.feedback_request.requested_feedback_types,
        selected ??
          post.feedback_request.requested_feedback_types.find(
            (type) => type === params.feedback_type,
          ) ??
          null,
      )
    : null;
  const draft = useRoomDraft(`post:${id}:${feedback ?? "simple"}`);
  const enabled = Boolean(
    post &&
    !entry.entry.error &&
    post.status === "published" &&
    post.viewer_access?.can_reply !== false &&
    !post.locked,
  );
  const seeded = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!compose || !enabled || !params.audio) return;
    const key = `${id}:${feedback}:${params.audio}:${params.t}`;
    if (seeded.current === key) return;
    seeded.current = key;
    draft.update((current) =>
      seedAudioReply(
        current,
        id,
        params.audio,
        normalizeAudioSeconds(params.t),
      ),
    );
  }, [compose, enabled, id, feedback, params.audio, params.t, draft.update]);
  const composition = useEntryComposition(
    id,
    post?.room_id ? String(post.room_id) : undefined,
    draft,
    entry,
    enabled,
    feedback,
  );
  const list = useRef<FlatList>(null);
  const revealedSend = useRef<string | undefined>(undefined);
  const sourceExposure = useRoomExposure(id, undefined, "post");
  const replyExposure = useRoomExposure(id, undefined, "post-replies");
  const onViewableItemsChanged = useCallback(
    (info: Parameters<typeof replyExposure.onViewableItemsChanged>[0]) => {
      sourceExposure.onViewableItemsChanged(info);
      replyExposure.onViewableItemsChanged(info);
    },
    [
      sourceExposure.onViewableItemsChanged,
      replyExposure.onViewableItemsChanged,
    ],
  );
  const groups = useMemo(() => {
    const adapted: RoomMessage[] = entry.replies.map(replyAsRoomMessage);
    const cardIds = new Map<number, number[]>();
    for (const card of groupChatAuthors(adapted, item => item.author?.id)) {
      const ids = card.map(item => item.id);
      for (const item of card) cardIds.set(item.id, ids);
    }
    const replies = virtualMessageGroups(
      adapted,
      (item) => String(item.id),
      (item) => item.author?.id,
    ).map((group) => ({ ...group, saveIds: cardIds.get(group.entries[0].id) ?? [], key: `reply-${group.key}` }));
    if (!post || embedded) return replies;
    const source: RoomMessage = {
      id: post.id,
      kind: "message",
      client_nonce: null,
      body: plainTextFromTiptap(post.content),
      created_at: post.published_at ?? post.created_at ?? "",
      author: {
        id: post.user.id,
        display_username:
          post.display_username ??
          post.user.display_username ??
          post.user.username,
        avatar_url:
          post.display_avatar_url ??
          post.user.display_avatar_url ??
          post.user.avatar_url,
      },
      masked_author: null,
      entry: {
        id: post.id,
        creation_origin: "chat_attachment",
        available: true,
        room_statement: post.room_statement, shared_feedback: post.shared_feedback,
        content: post.content,
        format: post.format,
        format_data: post.format_data ?? null,
        reply_count: entry.replies.length,
      },
    };
    return [
      {
        ...virtualMessageGroups(
          [source],
          (item) => String(item.id),
          (item) => item.author?.id,
        )[0],
        key: "source",
        saveIds: [] as number[],
        ids: [],
      },
      ...replies,
    ];
  }, [post, entry.replies, embedded]);
  const replyIds = useMemo(
    () => entry.replies.map((reply) => ({ id: Number(reply.id) })),
    [entry.replies],
  );
  const reading = useMessageReading({
    source: {
      ready: Boolean(post) && !unavailable,
      error: entry.entry.error || entry.pages.error,
      validating: entry.entry.isValidating || entry.pages.isValidating,
      messages: replyIds,
      hasMore: entry.hasMore,
      loadMore: entry.loadMore,
      refresh: () => entry.entry.mutate(),
    },
    draft: readingDraft,
    groups,
    list,
    exposure: replyExposure,
    target,
    consumeTarget: () => router.setParams({ "#": "", reply: undefined }),
    inverted: false,
    followInitially: false,
    noun: "reply",
  });
  useEffect(() => {
    if (
      !composition.lastSentId ||
      composition.lastSentId === revealedSend.current
    )
      return;
    revealedSend.current = composition.lastSentId;
    reading.latest();
  }, [composition.lastSentId, reading.latest]);
  const back =
    onBack ??
    (() =>
      navigation.returnTo(
        post?.room_id ? `/app/rooms/${post.room_id}` : "/app",
      ));
  const selectPost =
    onSelectPost ??
    ((entryId: string) => navigation.destination(`/app/entries/${entryId}`));
  const sourcePath = post?.source_entry_id && post.keep_project_id
    ? `/app/projects/${post.keep_project_id}/entries/${post.source_entry_id}` : undefined;
  const menuActions = [
    ...(noteSave.available ? [{ id: "note", label: "Save to Note", onSelect: () => { setMenuOpen(false); setNotePickerOpen(true); } }] : []),
    ...(sourcePath ? [{ id: "source", label: "View source", onSelect: () => { setMenuOpen(false); navigation.destination(sourcePath); } }] : []),
    ...(withdrawal.available ? [{ id: "remove", label: "Remove from room", onSelect: () => { setMenuOpen(false); setConfirmWithdrawal(true); } }] : []),
  ];
  const menuButton = !unavailable && menuActions.length ? <Button ref={menuAnchor} emphasis="ghost" style={styles.menuButton} accessibilityLabel="More options" disabled={composition.busy || withdrawal.busy} onPress={() => setMenuOpen(true)}><Icon name="dotsThree" /></Button> : <View style={styles.menuSpace} />;
  const sourceCard = post ? (
    <View style={styles.source}>
      <View style={[layout.row, styles.identityRow]}>
        <Button emphasis="ghost" style={styles.identityLink}
          disabled={!post.room_id || composition.busy}
          accessibilityLabel={`View ${post.display_username ?? post.user.display_username ?? post.user.username}'s profile`}
          onPress={() => post.room_id && navigation.destination(appRoutes.roomMember(post.room_id, post.user.id))}>
        <UserAvatar
          username={
            post.display_username ??
            post.user.display_username ??
            post.user.username
          }
          avatarUrl={post.display_avatar_url ?? post.user.avatar_url}
          size={24}
        />
        <Text style={styles.author}>
          {post.display_username ??
            post.user.display_username ??
            post.user.username}
        </Text>
        </Button>
        {post.previous_author_entry && (
          <Button
            size="icon"
            emphasis="ghost"
            accessibilityLabel="Previous share by this person"
            disabled={composition.busy}
            onPress={() => selectPost(String(post.previous_author_entry!.id))}
          >
            <Icon name="caretCircleLeft" size={28} />
          </Button>
        )}
        {post.next_author_entry && (
          <Button
            size="icon"
            emphasis="ghost"
            accessibilityLabel="Next share by this person"
            disabled={composition.busy}
            onPress={() => selectPost(String(post.next_author_entry!.id))}
          >
            <View style={{ transform: [{ scaleX: -1 }] }}>
              <Icon name="caretCircleLeft" size={28} />
            </View>
          </Button>
        )}
      </View>
      <EntryContent
        entry={{
          room_statement: post.room_statement, shared_feedback: post.shared_feedback,
        content: post.content,
          format: post.format,
          format_data: post.format_data ?? null,
        }}
      />
      {(post.project || post.room_project) && (
        <View style={styles.projectRow}>
          <Button emphasis="ghost" style={styles.identityLink}
            accessibilityLabel={`Open ${post.project?.name ?? post.room_project!.name}`}
            onPress={() => navigation.destination(post.project
              ? `/app/projects/${post.project.id}` : `/app/entries/${post.id}/shared-project`)}>
            <ProjectIcon name={post.project?.name ?? post.room_project!.name} imageUrl={post.project?.icon_url} size={24} />
            <Text style={styles.author}>{post.project?.name ?? post.room_project!.name}</Text>
          </Button>
        {post.project_id && post.previous_project_entry && (
          <Button
            size="icon"
            emphasis="ghost"
            accessibilityLabel="Previous project contribution"
            disabled={composition.busy}
            onPress={() => selectPost(String(post.previous_project_entry!.id))}
          >
            <Icon name="caretCircleLeft" size={28} />
          </Button>
        )}
        {post.project_id && post.next_project_entry && (
          <Button
            size="icon"
            emphasis="ghost"
            accessibilityLabel="Next project contribution"
            disabled={composition.busy}
            onPress={() => selectPost(String(post.next_project_entry!.id))}
          >
            <View style={{ transform: [{ scaleX: -1 }] }}>
              <Icon name="caretCircleLeft" size={28} />
            </View>
          </Button>
        )}
        </View>
      )}
      <View style={styles.replyDivider} />
    </View>
  ) : null;
  const Shell = embedded ? View : ViewportShell;
  return (
    <Shell
      {...(embedded
        ? { style: layout.grow }
        : { suppressAudioPlayer: compose, toolbarSurface: tokens.paper })}
    >
      <Toast message={noteFeedback || replySave.feedback || reading.notice} onDismiss={noteFeedback ? () => setNoteFeedback(undefined) : replySave.feedback ? replySave.clearFeedback : reading.dismissNotice} />
      {post?.room && !embedded ? <RoomHeader title={post.room.name || "Room"} avatar={post.room.avatar_url}
        detailsOpen={false} shelfOpen={false} hasSides={false} detailsRef={roomChip} shelfRef={roomShelf}
        backIcon="caretLeft" backLabel="Back to room" onBack={() => navigation.ancestor(`/app/rooms/${post.room!.id}`)}
        onDetails={() => navigation.destination(`/app/rooms/${post.room!.id}?panel=details`)} onShelf={() => {}} trailing={menuButton} /> : <View style={[layout.content, styles.header]}>
        <Button
          size="icon"
          style={styles.target}
          emphasis="ghost"
          onPress={back}
          accessibilityLabel={embedded ? "Back to Room" : "Back"}
        >
          <Icon name="caretCircleLeft" size={28} />
        </Button>
        <Text
          ref={heading}
          {...(Platform.OS === "web" ? { tabIndex: -1 } : {})}
          accessibilityRole="header"
          style={styles.hiddenTitle}
        >
          Replies
        </Text>
        <View style={layout.grow} />
        {menuButton}
        {onClose && (
          <Button
            emphasis="ghost"
            accessibilityLabel="Back to Chat"
            onPress={onClose}
          >
            <Icon name="x" size={20} />
          </Button>
        )}
      </View>}
      <PopupMenu mode="menu" anchor={menuAnchor} open={menuOpen} title="Options" onClose={() => setMenuOpen(false)} actions={menuActions} />
      <PopupMenu mode="page" open={notePickerOpen} title="Save to Note" dismissDisabled={noteSave.save.isMutating} onClose={() => setNotePickerOpen(false)} actions={[]}>
        {noteSave.tree.isLoading && <ActivityIndicator accessibilityLabel="Loading Notes" />}
        {noteSave.tree.error && <Button onPress={() => void noteSave.tree.mutate().catch(() => {})}>Retry Notes</Button>}
        {noteSave.save.error && <Text accessibilityRole="alert" style={layout.text}>{noteSave.save.error.message || "Could not save to the Note. Try again."}</Text>}
        {!noteSave.tree.isLoading && !noteSave.tree.error && !noteSave.tree.data?.pages.length && <Text style={layout.muted}>No Notes in this room yet.</Text>}
        <NoteTree nodes={noteSave.tree.data?.pages ?? []} destination disabled={!noteSave.available || noteSave.save.isMutating} onOpen={note => {
          void noteSave.save.trigger(note.id).then(() => { setNotePickerOpen(false); setNoteFeedback("Saved to Note."); }).catch(() => {});
        }} />
      </PopupMenu>
      {entry.entry.isLoading && (
        <ActivityIndicator accessibilityLabel="Loading entry and replies" />
      )}
      {unavailable ? (
        <View style={[layout.content, layout.section]}>
          <Text accessibilityRole="alert" style={layout.text}>
            This entry could not be loaded. It may no longer be available to
            you.
          </Text>
          <Button
            style={styles.target}
            onPress={() => {
              void entry.entry.mutate().catch(() => {});
            }}
          >
            Retry
          </Button>
        </View>
      ) : (
        <View
          style={layout.grow}
          ref={(node) => {
            sourceExposure.viewport.current = node;
            replyExposure.viewport.current = node;
          }}
          collapsable={false}
        >
          <FlatList
            ref={list}
            onContentSizeChange={(_, height) =>
              reading.onContentSizeChange(height)
            }
            accessibilityLabel="Discussion and replies"
            contentContainerStyle={[
              layout.content,
              styles.timeline,
              layout.audioClearance,
            ]}
            data={groups}
            keyExtractor={(group) => group.key}
            initialNumToRender={3}
            windowSize={5}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onLayout={(event) =>
              reading.onLayout(event.nativeEvent.layout.height)
            }
            onScroll={reading.onScroll}
            scrollEventThrottle={100}
            onScrollBeginDrag={reading.beginReading}
            onScrollToIndexFailed={reading.onScrollToIndexFailed}
            viewabilityConfig={replyExposure.viewabilityConfig}
            onViewableItemsChanged={onViewableItemsChanged}
            renderItem={({ item }) => {
              const saveIds = groups.find(group => group.key === item.key)?.saveIds ?? [];
              const saved = replySave.isSaved(saveIds);
              return (
              <RoomExposure.Provider
                value={
                  item.key === "source"
                    ? sourceExposure.register
                    : replyExposure.register
                }
              >
                {item.key === "source" && post ? (
                  <MessageExposure id={post.id} group={item.key} prefix="post">
                    {sourceCard}
                  </MessageExposure>
                ) : (
                  <View style={styles.replyIndent}>
                  <MessageGroup
                    headerAction={replySave.available ? <Button emphasis="ghost" style={styles.saveStar}
                      accessibilityLabel={saved ? "Remove saved replies from source" : "Save replies to source"}
                      selected={saved}
                      disabled={replySave.busy} onPress={() => void replySave.toggle(saveIds)}>
                      <Icon name={saved ? "starFill" : "star"} size={22} color={saved ? tokens.ink : tokens.muted} />
                    </Button> : undefined}
                    rowPrefix="reply"
                    group={item}
                    showDestinations={false}
                    renderActions={message => {
                      const type = entry.replies.find(reply => Number(reply.id) === Number(message.id))?.feedback_type;
                      return type ? <Text style={layout.muted}>{type[0].toUpperCase() + type.slice(1)}</Text> : null;
                    }}
                  />
                  </View>
                )}
              </RoomExposure.Provider>
              );
            }}
            ListHeaderComponent={embedded ? sourceCard : null}
            ListFooterComponent={
              <View style={layout.section}>
                {entry.pages.error && (
                  <Text accessibilityRole="alert" style={layout.text}>
                    Could not load more replies.
                  </Text>
                )}
                {entry.hasMore && (
                  <Button
                    style={styles.target}
                    disabled={entry.pages.isValidating}
                    onPress={() => {
                      void (
                        entry.pages.error
                          ? entry.pages.mutate()
                          : entry.loadMore()
                      ).catch(() => {});
                    }}
                  >
                    {entry.pages.isValidating
                      ? "Loading…"
                      : entry.pages.error
                        ? "Retry replies"
                        : "Load more replies"}
                  </Button>
                )}
                {post && !entry.replies.length && (
                  <Text style={layout.muted}>No replies yet.</Text>
                )}
              </View>
            }
          />
        </View>
      )}
      <PopupMenu mode="dialog" open={confirmWithdrawal} title="Remove from room?" dismissDisabled={withdrawal.busy} onClose={() => setConfirmWithdrawal(false)} actions={[
        { id: "cancel", label: "Keep in room", disabled: withdrawal.busy, onSelect: () => setConfirmWithdrawal(false) },
        { id: "withdraw", label: withdrawal.busy ? "Removing…" : "Remove from Room", disabled: withdrawal.busy, onSelect: () => { void withdrawal.withdraw().then((removed) => { if (removed) { setConfirmWithdrawal(false); back(); } }); } },
      ]}>
        <Text style={layout.text}>This item and its replies will no longer be available in the room. Private Project originals are unchanged.</Text>
        {withdrawal.error && <Text accessibilityRole="alert" style={layout.text}>{withdrawal.error}</Text>}
      </PopupMenu>
      <ViewportToolbar>
        <View style={styles.dock}>
          {enabled ? (
            <>
              {guided && (
                <View style={styles.feedback}>
                  {post.feedback_request.requested_feedback_types.map(
                    (type) => (
                      <Button
                        key={type}
                        style={styles.target}
                        emphasis={feedback === type ? "solid" : "ghost"}
                        disabled={composition.busy || Boolean(draft.pending)}
                        onPress={() => setSelected(type)}
                      >
                        {type[0].toUpperCase() + type.slice(1)}
                      </Button>
                    ),
                  )}
                </View>
              )}
              <ReplyComposer
                onEscape={embedded ? onBack : undefined}
                autoFocus={compose}
                title="this entry"
                draft={draft}
                composition={composition}
              />
            </>
          ) : (
            post &&
            !entry.entry.error && (
              <Text style={layout.muted}>
                Replies are unavailable.
              </Text>
            )
          )}
        </View>
      </ViewportToolbar>
    </Shell>
  );
}
const styles = StyleSheet.create({
  menuButton: { marginRight: -12 },
  menuSpace: { width: 40 },
  source: { gap: 8 },
  identityRow: { gap: 8 },
  identityLink: { flex: 1, flexDirection: "row", justifyContent: "flex-start", gap: 8, paddingHorizontal: 0, paddingVertical: 0 },
  projectRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  replyDivider: { borderTopWidth: 1, borderTopColor: tokens.border, marginTop: 2, marginBottom: -2 },
  timeline: { gap: 12, paddingTop: 0 },
  saveStar: { paddingVertical: 0, paddingHorizontal: 4.8, minHeight: 22 },
  hiddenTitle: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
  author: { fontFamily: "BarlowCondensedBold", fontSize: 18.9, color: tokens.ink },
  replyIndent: { marginLeft: 16 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    minHeight: 48,
  },
  target: { minHeight: 48 },
  dock: { backgroundColor: tokens.paper, paddingTop: 8, paddingBottom: 0 },
  feedback: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
