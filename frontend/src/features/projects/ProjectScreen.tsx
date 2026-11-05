import { plainTextFromTiptap } from "../../lib/tiptap";
import { ProjectIcon } from "./ProjectIcon";
import { ResponseSummary } from "../rooms/MessageContent";
import { projectTimelineGroups } from "../../lib/projectTimeline";
import { useProjectTimeline, useProjectCopies } from "../../hooks/useProjectTimeline";
import { PageScrollView } from "../../components/PageScrollView";
import { useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { RoomIcon } from "../../components/RoomIcon";
import { AppImage } from "../../components/AppImage";
import { PopupMenu } from "../../components/PopupMenu";
import { ViewportShell } from "../../components/ViewportShell";
import { ViewportToolbar } from "../../components/ViewportToolbar";
import { EntryContent } from "../content/EntryContent";
import { AuthorStripe, SavedReplyPreview } from "../rooms/MessageGroup";
import { useProject, useProjectInvitation } from "../../hooks/useProjects";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { useContentLink } from "../../hooks/useContentLink";
import type { ProjectEntry } from "../../lib/api/projectEntries";
import { materialPresentation } from "../../lib/materialDocument";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";

export function ProjectScreen() {
  const { projectId, entryId } = useLocalSearchParams<{
    projectId: string;
    entryId?: string;
  }>();
  const query = useProject(projectId);
  const invitation = useProjectInvitation(projectId);
  const navigation = useRoomNavigation();
  const router = useRouter();
  const links = useContentLink();
  const [error, setError] = useState<string>();
  const [options, setOptions] = useState(false);
  const shareEntry = (entry: ProjectEntry) => navigation.destination(`/app/projects/${projectId}/entries/${entry.id}/share`);
  const anchor = useRef<View>(null);
  const project = query.data;
  const [copyEntryId, setCopyEntryId] = useState<string>();
  const copies = useProjectCopies(projectId, copyEntryId, Boolean(project && !query.error && !project.invitation_only && project.viewer_participation !== "pending"));
  const answer = async (response: "accept" | "decline") => {
    setError(undefined);
    try {
      await invitation.trigger(response);
      if (response === "decline") router.replace("/app/projects");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not update your invitation.",
      );
    }
  };
  const invitationOnly =
    project?.invitation_only || project?.viewer_participation === "pending";
  const timeline = useProjectTimeline(projectId, Boolean(project && !query.error && !invitationOnly), entryId);
  const entries = timeline.entries;
  const groups = projectTimelineGroups(entries);
  const detailEntry = entryId ? entries.find(entry => String(entry.id) === entryId) : undefined;
  return (
    <ViewportShell
      entryPage={Boolean(entryId)}
      surface={entryId ? tokens.paper : tokens.surface}
    >
      <View style={[layout.content, layout.appBar]}>
        <Button
          size="icon"
          emphasis="bare"
          hitSlop={7}
          accessibilityLabel={entryId ? "Back to project" : "Back to projects"}
          onPress={() =>
            navigation.ancestor(
              entryId ? `/app/projects/${projectId}` : "/app/projects",
            )
          }
        >
          <Icon name="caretCircleLeft" size={28} />
        </Button>
        {entryId && project && <ProjectIcon name={project.name} imageUrl={project.icon_url}
          symbol={project.icon_symbol} themeColor={project.icon_color} size={24} />}
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            ellipsizeMode="tail"
            style={layout.appBarTitle}
          >
            {project?.name || "Project"}
          </Text>
        {detailEntry && (
          <View style={styles.actions}>
            {(detailEntry.can_edit || detailEntry.can_share) && (
              <Button
                ref={anchor}
                emphasis="bare"
                size="icon"
                accessibilityLabel="Entry options"
                onPress={() => setOptions(true)}
              >
                <Icon name="dotsThree" size={24} />
              </Button>
            )}
            {detailEntry.can_edit && (
              <Button
                emphasis="bare"
                style={styles.footerControl}
                onPress={() =>
                  navigation.destination(
                    `/app/projects/${projectId}/entries/${detailEntry.id}/edit`,
                  )
                }
              >
                Edit
              </Button>
            )}
          </View>
        )}
        {project?.can_edit && !entryId && (
          <Button
            ref={anchor}
            emphasis="bare"
            size="icon"
            accessibilityLabel="Project options"
            onPress={() => setOptions(true)}
          >
            <Icon name="dotsThree" size={24} />
          </Button>
        )}
      </View>
      <PageScrollView contentContainerStyle={[layout.section, styles.pageContent]}>
        {query.isLoading && (
          <ActivityIndicator accessibilityLabel="Loading project" />
        )}
        {query.error ? (
          <View style={layout.section}>
            <Text accessibilityRole="alert" style={layout.text}>
              Couldn’t load this project. It may no longer be available to you.
            </Text>
            <Button
              onPress={() => {
                void query.mutate().catch(() => {});
              }}
            >
              Try again
            </Button>
          </View>
        ) : (
          project && (
            <>
              {invitationOnly ? (
                <View style={styles.panel}>
                  <Text accessibilityRole="header" style={layout.title}>
                    Join this project
                  </Text>
                  <Text style={layout.text}>
                    Accept {project.owner.username}’s invitation to see the
                    entries and add your own.
                  </Text>
                  <View style={styles.actions}>
                    <Button
                      shape="pill"
                      disabled={invitation.isMutating}
                      onPress={() => {
                        void answer("accept");
                      }}
                    >
                      Accept invitation
                    </Button>
                    <Button
                      shape="pill"
                      emphasis="outline"
                      disabled={invitation.isMutating}
                      onPress={() => {
                        void answer("decline");
                      }}
                    >
                      Decline
                    </Button>
                  </View>
                </View>
              ) : (
                <>
                  {!entryId &&
                    Boolean(entries.length) &&
                    project.banner_url && (
                      <View style={styles.banner}>
                        <AppImage
                          src={project.banner_url}
                          width={project.banner_width ?? undefined}
                          height={project.banner_height ?? undefined}
                          alt=""
                        />
                      </View>
                    )}
                  {timeline.query.isLoading && <ActivityIndicator accessibilityLabel="Loading Entries" />}
                  {timeline.query.error && <View><Text accessibilityRole="alert">Couldn’t load Entries. Access may have changed.</Text><Button onPress={() => { void timeline.query.mutate().catch(() => {}); }}>Try again</Button></View>}
                  {groups.map(({ entry, savedReplies }, index) => (
                    <ProjectTimelineEntry
                      key={entry.id}
                      entry={entry}
                      savedReplies={savedReplies}
                      connected={entry.kind === "feedback" && Boolean(entry.source_entry_id) && (groups[index - 1]?.entry.id === entry.source_entry_id || (groups[index - 1]?.entry.kind === "feedback" && groups[index - 1]?.entry.source_entry_id === entry.source_entry_id))}
                      onCopies={() => setCopyEntryId(String(entry.id))}
                      detail={Boolean(entryId)}
                      open={() =>
                        navigation.destination(
                          `/app/projects/${projectId}/entries/${entry.id}`,
                        )
                      }
                      edit={() =>
                        navigation.destination(
                          `/app/projects/${projectId}/entries/${entry.id}/edit`,
                        )
                      }
                      share={() => shareEntry(entry)}
                      openLink={(href) => {
                        void links.open(href);
                      }}
                      projectId={projectId}
                    />
                  ))}
                  {timeline.hasMore && <Button disabled={timeline.query.isValidating} onPress={() => { void timeline.query.setSize(timeline.query.size + 1).catch(() => {}); }}>Load more</Button>}
                  {!timeline.query.isLoading && !timeline.query.error && !entries.length && (
                    <View style={styles.empty}>
                      <Text accessibilityRole="header" style={layout.title}>
                        {entryId ? "Entry unavailable" : "No Entries"}
                      </Text>
                      <Text style={layout.muted}>
                        {entryId
                          ? "This entry may no longer be available to you."
                          : project.can_add_material
                            ? "To add an entry, tap the plus button."
                            : "Entries will appear here."}
                      </Text>
                    </View>
                  )}
                </>
              )}
            </>
          )
        )}
        {(error || links.error) && (
          <Text accessibilityRole="alert" style={layout.text}>
            {error || links.error}
          </Text>
        )}
      </PageScrollView>
      {!entryId &&
        !query.error &&
        project?.can_add_material &&
        !invitationOnly && (
          <ViewportToolbar floating>
            <View pointerEvents="box-none" style={[layout.content, styles.dock]}>
              <Button
                style={layout.entryFab}
                color={tokens.projectEntryAction}
                shape="pill"
                accessibilityLabel="Add entry"
                onPress={() =>
                  navigation.destination(
                    `/app/projects/${projectId}/entries/new`,
                  )
                }
              >
                <Icon name="plusBold" color={tokens.paper} size={24} />
              </Button>
            </View>
          </ViewportToolbar>
        )}
      <PopupMenu mode="dialog" open={Boolean(copyEntryId)} title="Room copies" actions={[]} onClose={() => setCopyEntryId(undefined)}>
        <View style={layout.section}>
          {copies.query.isLoading && <ActivityIndicator accessibilityLabel="Loading Room copies" />}
          {copies.query.error && <Button onPress={() => { void copies.query.mutate().catch(() => {}); }}>Retry Room copies</Button>}
          {copies.submissions.map(copy => <Button key={copy.id} emphasis="link" onPress={() => { setCopyEntryId(undefined); void links.open(`/app/entries/${copy.id}`); }}>{copy.room_name}, {copy.reply_count} replies</Button>)}
          {!copies.query.isLoading && !copies.query.error && !copies.submissions.length && <Text>No accessible Room copies.</Text>}
          {copies.hasMore && <Button disabled={copies.query.isValidating} onPress={() => { void copies.query.setSize(copies.query.size + 1).catch(() => {}); }}>Load more copies</Button>}
        </View>
      </PopupMenu>
      <PopupMenu
        mode="menu"
        open={options}
        title={detailEntry ? "Entry options" : "Project options"}
        anchor={anchor}
        onClose={() => setOptions(false)}
        actions={
          detailEntry
            ? [
                ...(detailEntry.can_edit
                  ? [
                      {
                        id: "edit",
                        label: "Edit entry",
                        onSelect: () => {
                          setOptions(false);
                          navigation.destination(
                            `/app/projects/${projectId}/entries/${detailEntry.id}/edit`,
                          );
                        },
                      },
                    ]
                  : []),
                ...(detailEntry.can_share
                  ? [
                      {
                        id: "share",
                        label: "Share with a room",
                        onSelect: () => {
                          setOptions(false);
                          shareEntry(detailEntry);
                        },
                      },
                    ]
                  : []),
              ]
            : [
                {
                  id: "settings",
                  label: "Project settings",
                  onSelect: () => {
                    setOptions(false);
                    navigation.destination(`/app/projects/${projectId}/edit`);
                  },
                },
              ]
        }
      />

    </ViewportShell>
  );
}
export function ProjectTimelineEntry({
  entry,
  connected = false,
  nested = false,
  savedReplies = [],
  detail,
  whiteSurface = detail,
  open,
  edit,
  share,
  openLink,
  onCopies,
  projectId,
}: {
  entry: ProjectEntry;
  connected?: boolean;
  nested?: boolean;
  savedReplies?: ProjectEntry[];
  detail: boolean;
  whiteSurface?: boolean;
  open: () => void;
  edit: () => void;
  share: () => void;
  openLink: (href: string) => void;
  onCopies?: () => void;
  projectId: string;
}) {
  const [options, setOptions] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const anchor = useRef<View>(null);
  const presentation = materialPresentation(entry);
  const feedback = entry.kind === "feedback";
  const openFeedbackSource = () => {
    if (entry.source_available && entry.source_chat_message_id && entry.source_room_id) {
      openLink(`/app/rooms/${entry.source_room_id}/chat#chat-${entry.source_chat_message_id}`);
    } else if (entry.source_available && entry.source_shared_entry_id) {
      openLink(`/app/entries/${entry.source_shared_entry_id}${entry.source_reply_id ? `#reply-${entry.source_reply_id}` : ""}`);
    } else {
      open();
    }
  };
  const actions = [
    ...(entry.can_edit
      ? [{ id: "edit", label: "Edit entry", onSelect: edit }]
      : []),
    ...(entry.can_share
      ? [{ id: "share", label: "Share with a room", onSelect: share }]
      : []),
  ];
  return (
    <View style={styles.timelineGroup}>
      {detail && <Text style={styles.entryDate}>{new Date(entry.created_at).toLocaleDateString(undefined, {
        weekday: "long", month: "short", day: "numeric",
      })}</Text>}
      {connected && <View pointerEvents="none" style={[styles.connector, nested && styles.shortConnector]} />}
    <View
      nativeID={`entry-${entry.id}`}
      style={[styles.entry, (!detail || feedback) && styles.card, feedback && styles.feedbackCard, feedback && !detail && styles.compactFeedback, nested && styles.nestedFeedback, feedback && whiteSurface && styles.cardOutline]}
    >
      {entry.automated_creation && <Text accessibilityLabel="Added by automation" style={layout.muted}>⚡ Added by automation</Text>}
      {feedback && !detail ? <SavedReplyPreview stripeSize="savedReply"
        author={entry.source_author_name || entry.author.username}
        text={plainTextFromTiptap(presentation.content) || "Shared media feedback"}
        onPress={openFeedbackSource} /> : <View style={feedback ? styles.feedback : undefined}>
        {feedback && (
          <AuthorStripe
            name={entry.source_author_name || entry.author.username}
          />
        )}
        <View style={feedback ? layout.grow : undefined}>
          {feedback && (
            <Text style={styles.author}>
              {entry.source_author_name || entry.author.username}
            </Text>
          )}
          <EntryContent
            entry={presentation}
            onOpen={!detail ? open : undefined}
            preview={!detail}
            onMediaOpen={(index) =>
              openLink(
                `/app/projects/${projectId}/entries/${entry.id}/media/${index}`,
              )
            }
          />
        </View>
      </View>}
      {entry.lyrics && <>
        <Button emphasis="link" expanded={expanded} onPress={() => setExpanded(value => !value)}>Lyrics</Button>
        {expanded && <Text style={layout.text}>{entry.lyrics}</Text>}
      </>}
      {feedback && (
        <>
          {expanded && (
            <View style={layout.section}>
              {entry.source_entry_id && (
                <Button
                  emphasis="link"
                  onPress={() =>
                    openLink(
                      `/app/projects/${projectId}/entries/${entry.source_entry_id}`,
                    )
                  }
                >
                  Source entry
                </Button>
              )}
              {entry.source_available &&
              entry.source_chat_message_id &&
              entry.source_room_id ? (
                <Button
                  emphasis="link"
                  onPress={() =>
                    openLink(
                      `/app/rooms/${entry.source_room_id}/chat#chat-${entry.source_chat_message_id}`,
                    )
                  }
                >
                  Original message
                </Button>
              ) : entry.source_available && entry.source_shared_entry_id ? (
                <Button
                  emphasis="link"
                  onPress={() =>
                    openLink(
                      `/app/entries/${entry.source_shared_entry_id}${entry.source_reply_id ? `#reply-${entry.source_reply_id}` : ""}`,
                    )
                  }
                >
                  Original discussion
                </Button>
              ) : (
                <Text style={layout.muted}>Original source unavailable.</Text>
              )}
            </View>
          )}
        </>
      )}
      {((!detail && !feedback) || (detail && feedback)) && (
        <View style={styles.footer}>
          {!detail ? (
            <Button emphasis="bare" style={styles.date} onPress={open}>
              <Text numberOfLines={1} style={styles.footerLabel}>
                {new Date(entry.created_at).toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </Text>
            </Button>
          ) : (
            <View />
          )}
          {feedback && <Button emphasis="bare" style={styles.footerControl} expanded={expanded} onPress={() => setExpanded(value => !value)}>
            <Text style={styles.footerLabel}>{entry.source_available ? "Source" : "Source unavailable"}</Text>
          </Button>}
          {actions.length > 0 && (
            <View style={styles.actions}>
              <Button
                ref={anchor}
                emphasis="bare"
                style={styles.footerControl}
                accessibilityLabel="Entry options"
                onPress={() => setOptions(true)}
              >
                <Icon name="dotsThree" size={24} />
              </Button>
              {entry.can_edit && (
                <Button
                  emphasis="bare"
                  style={styles.footerControl}
                  onPress={edit}
                >
                  <Text style={styles.footerLabel}>Edit</Text>
                </Button>
              )}
            </View>
          )}
        </View>
      )}
      <PopupMenu
        mode="menu"
        open={options}
        title="Entry options"
        anchor={anchor}
        onClose={() => setOptions(false)}
        actions={actions.map((action) => ({
          ...action,
          onSelect: () => {
            setOptions(false);
            action.onSelect();
          },
        }))}
      />
    </View>
      {entry.submissions.map(submission => <View key={submission.id} style={styles.timelineGroup}>
        <View pointerEvents="none" style={[styles.connector, styles.shortConnector]} />
        <View style={[styles.shareCard, whiteSurface && styles.cardOutline]}>
          <Button emphasis="bare" style={[styles.copy, layout.grow]}
            accessibilityLabel={`${submission.room_name}, ${submission.reply_count} replies`}
            onPress={() => openLink(`/app/entries/${submission.id}`)}>
            <RoomIcon name={submission.room_name} avatarUrl={submission.circle_icon_url} size={20} />
            <Text numberOfLines={1} style={[styles.roomName, layout.grow]}>{submission.room_name}</Text>
          </Button>
          <View>
          <ResponseSummary compact count={submission.reply_count} participants={submission.reply_participants ?? []}
            onPress={() => openLink(`/app/entries/${submission.id}`)} />
          </View>
        </View>
        {savedReplies.filter(reply => reply.source_shared_entry_id === submission.id).map(reply => <ProjectTimelineEntry
          key={reply.id} entry={reply} detail={false} whiteSurface={whiteSurface} connected nested projectId={projectId}
          open={() => openLink(`/app/projects/${projectId}/entries/${reply.id}`)}
          edit={edit} share={share} openLink={openLink} />)}
      </View>)}
      {entry.submissions_next_cursor && onCopies && <Button emphasis="link" onPress={onCopies}>View all Room copies</Button>}
    </View>
  );
}
const styles = StyleSheet.create({
  pageContent: { paddingTop: 4 },
  cardOutline: { borderWidth: 1, borderColor: tokens.border },
  entryDate: { fontFamily: "Lato", fontSize: 12, color: tokens.inkMuted, textAlign: "right", paddingHorizontal: 4 },
  timelineGroup: { gap: 12 },
  roomName: { fontFamily: "BarlowCondensedSemibold", fontSize: 18, color: tokens.ink },
  shareCard: { flexDirection: "row", alignItems: "center", paddingRight: 12, marginLeft: 22, borderRadius: 20, backgroundColor: tokens.paper },
  nestedFeedback: { marginLeft: 44 },
  shortConnector: { top: -12, height: 12 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: 44,
    flexShrink: 0,
  },
  panel: {
    padding: 16,
    gap: 16,
    backgroundColor: tokens.paper,
    borderRadius: 16,
  },
  entry: { gap: 8, padding: 4 },
  card: { backgroundColor: tokens.paper, borderRadius: 20 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  date: {
    flex: 1,
    minWidth: 0,
    alignItems: "flex-start",
    paddingHorizontal: 4,
    paddingVertical: 0,
    minHeight: 28,
  },
  footerControl: { paddingHorizontal: 8, paddingVertical: 0, minHeight: 28 },
  footerLabel: { fontFamily: "LatoBold", fontSize: 12, color: tokens.inkMuted },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.border,
  },
  compactFeedback: { padding: 0, gap: 0 },
  feedbackCard: { marginLeft: 22, marginRight: 0, borderRadius: 7 },
  connector: { position: "absolute", top: -tokens.gap, left: "50%", marginLeft: -1, height: tokens.gap, width: 2, backgroundColor: tokens.muted, opacity: 0.325 },
  feedback: {
    flexDirection: "row",
    gap: 8,
    padding: 4,
    borderRadius: 16,
    backgroundColor: tokens.paper,
  },
  author: {
    fontFamily: "BarlowCondensedBold",
    color: tokens.ink,
    fontSize: 19,
    paddingVertical: 4,
  },
  banner: { borderRadius: 16, overflow: "hidden" },
  copy: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "flex-start", height: 36, minHeight: 36, paddingVertical: 0, paddingHorizontal: 12 },
  empty: {
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  dock: { alignItems: "flex-end", paddingTop: 12 },
});
