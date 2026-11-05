import { useRef, useState, type RefObject } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../../../components/Button";
import {
  UserIdentity,
  UserIdentityName,
} from "../../../components/UserIdentity";
import { ResponseSummary } from "../MessageContent";
import { AuthorStripe, SavedReplyPreview } from "../MessageGroup";
import { PopupMenu } from "../../../components/PopupMenu";
import { EntryContent } from "../../content/EntryContent";
import { Icon } from "../../../components/Icon";
import { tokens } from "../../../styles/tokens";
import { layout } from "../../../styles/layout";
import {
  type WallProcessEntry,
  type WallProcessSlot,
} from "./selectWallProcess";

export type WallTreatment =
  | "joined"
  | "grid"
  | "signals"
  | "thread"
  | "white"
  | "mirrored"
  | "outlinedCompact"
  | "outlinedSelected";
/** Shared member presentation. Selection and access decisions belong to callers. */
export function WallMember({
  artist,
  slots,
  treatment = "outlinedSelected",
  avatarUrl,
  onOpenEntry,
  onOpenFeedback,
  onActions,
}: {
  onActions?: (entry: WallProcessEntry, anchor: RefObject<View | null>) => void;
  artist: string;
  avatarUrl?: string | null;
  onOpenEntry?: (entry: WallProcessEntry) => void;
  onOpenFeedback?: (entry: WallProcessEntry, reply: string) => void;
  slots: WallProcessSlot[];
  treatment?: WallTreatment;
}) {
  const outlined =
    treatment === "outlinedCompact" || treatment === "outlinedSelected";
  const [width, setWidth] = useState(177);
  const [replyEntry, setReplyEntry] = useState<WallProcessEntry>();
  const [opened, setOpened] = useState<WallProcessSlot>();
  const menuAnchor = useRef<View>(null);
  const [menuEntryId, setMenuEntryId] = useState<string>();
  return (
    <View
      style={styles.root}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <UserIdentity username={artist} avatarUrl={avatarUrl} />
      {!slots.length && <Text style={layout.muted}>Nothing shared yet.</Text>}
      <View style={styles.slots}>
        {slots.map((slot, index) => {
          const feedback = slot.kind === "feedback";
          const statement = slot.kind === "statement";
          const related =
            index > 0 && slots[index - 1].entry.id === slot.entry.id;
          const memberSlot = treatment === "grid";
          return (
            <View key={`${slot.kind}-${slot.entry.id}`}>
              {slot.kind === "entry" && (
                <View style={styles.entryLabel}>
                  <View style={styles.projectSpace}>
                    <Text numberOfLines={1} style={styles.project}>
                      {slot.entry.project}
                    </Text>
                  </View>
                  <Text style={[styles.meta, styles.dateLabel]}>
                    {slot.entry.dateLabel}
                  </Text>
                </View>
              )}
              {related && (
                <View
                  style={[
                    styles.connector,
                    slot.kind === "entry" && styles.entryConnector,
                  ]}
                />
              )}
              <View
                style={[
                  styles.slot,
                  feedback && styles.feedback,
                  feedback && treatment === "signals" && styles.signal,
                  feedback &&
                    (treatment === "white" ||
                      treatment === "mirrored" ||
                      outlined) &&
                    styles.whiteFeedback,
                  statement && styles.plainStatement,
                  statement &&
                    treatment === "mirrored" &&
                    styles.whiteStatement,
                  statement && outlined && styles.insetStatement,
                  memberSlot && styles.fixed,
                ]}
              >
                {slot.kind === "entry" ? (
                  <>
                    <View
                      style={[styles.entryBody, memberSlot && styles.fixedEntry]}
                    >
                      <EntryContent
                        entry={slot.entry.entry}
                        interactive={false}
                        preview
                        compactPreview
                        previewLines={memberSlot ? 0 : 2}
                        previewMediaHeight={memberSlot ? width * 0.32 : undefined}
                        previewTitleLines={memberSlot ? 1 : 2}
                        previewTextStyle={styles.previewText}
                        previewTitleStyle={styles.previewTitle}
                        showCoverCredit={false}
                        onOpen={() => onOpenEntry ? onOpenEntry(slot.entry) : setOpened(slot)}
                        onMediaOpen={() => onOpenEntry ? onOpenEntry(slot.entry) : setOpened(slot)}
                      />
                    </View>
                    <View style={styles.footer}>
                      {onActions ? <View
                        ref={
                          menuEntryId === slot.entry.id
                            ? menuAnchor
                            : undefined
                        }
                      >
                        <Button
                          emphasis="bare"
                          size="md"
                          hitSlop={8}
                          style={styles.footerControl}
                          accessibilityLabel={`Actions for ${slot.entry.entry.format_data?.title ?? "shared work"}`}
                          onPress={() => { setMenuEntryId(slot.entry.id); onActions(slot.entry, menuAnchor); }}
                        >
                          <Icon name="dotsThree" size={18} />
                        </Button>
                      </View> : <View />}
                      <ResponseSummary
                        compact
                        count={
                          slot.entry.replyCount ??
                          slot.entry.replies?.length ??
                          slot.entry.savedResponses?.length ??
                          0
                        }
                        participants={
                          slot.entry.replyParticipants ??
                          slot.entry.replies ??
                          slot.entry.savedResponses?.map((reply, index) => ({
                            id: index,
                            username: reply.author,
                          })) ??
                          []
                        }
                        onPress={() => onOpenEntry ? onOpenEntry(slot.entry) : setReplyEntry(slot.entry)}
                      />
                    </View>
                  </>
                ) : statement ? (
                  <Button
                    emphasis="bare"
                    style={[
                      styles.statementButton,
                      (treatment === "mirrored" ||
                        treatment === "outlinedCompact") &&
                        styles.feedbackButton,
                      treatment === "outlinedSelected" &&
                        styles.selectedStatement,
                    ]}
                    onPress={() => setOpened(slot)}
                    accessibilityLabel={`Read ${artist}'s statement`}
                  >
                    <Text
                      numberOfLines={memberSlot ? 5 : outlined ? 6 : 4}
                      style={styles.statementText}
                    >
                      <Text style={styles.inlineStatementLabel}>
                        {artist} says{"\u2002"}
                      </Text>
                      {slot.text}
                    </Text>
                  </Button>
                ) : (
                  <SavedReplyPreview author={slot.feedback.author} text={slot.feedback.text}
                    onPress={() => onOpenFeedback ? onOpenFeedback(slot.entry, slot.feedback.id) : setOpened(slot)} />
                )}
              </View>
            </View>
          );
        })}
      </View>
      <PopupMenu
        mode="dialog"
        open={Boolean(replyEntry)}
        title="Replies"
        actions={[]}
        onClose={() => setReplyEntry(undefined)}
      >
        <View style={styles.detail}>
          {replyEntry?.replies?.length ? (
            replyEntry.replies.map((reply) => (
              <View key={reply.id} style={styles.reply}>
                <AuthorStripe name={reply.username} />
                <Text style={styles.replyText}>
                  <UserIdentityName username={reply.username} compact inline />
                  {"\u2002"}
                  {reply.text}
                </Text>
              </View>
            ))
          ) : (
            <Text style={layout.muted}>
              No replies yet. This preview does not publish replies.
            </Text>
          )}
        </View>
      </PopupMenu>
      <PopupMenu
        mode="dialog"
        open={Boolean(opened)}
        title={
          opened?.kind === "feedback"
            ? `${opened.feedback.author}'s feedback`
            : opened?.kind === "statement"
              ? `${artist}'s statement`
              : "Shared work"
        }
        actions={[]}
        onClose={() => setOpened(undefined)}
      >
        <View style={styles.detail}>
          {opened?.kind === "entry" ? (
            <EntryContent entry={opened.entry.entry} interactive={false} />
          ) : (
            <Text style={layout.text}>
              {opened?.kind === "statement"
                ? opened.text
                : opened?.feedback.text}
            </Text>
          )}
          {opened?.kind === "feedback" && (
            <Text style={styles.meta}>
              Originally on: {opened.feedback.sourceTitle}
            </Text>
          )}
        </View>
      </PopupMenu>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { gap: 10 },
  entryLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
    paddingHorizontal: 10,
    zIndex: 1,
  },
  projectSpace: { flex: 1, minWidth: 0, alignItems: "flex-start" },
  dateLabel: { backgroundColor: tokens.surface, paddingLeft: 3 },
  inlineStatementLabel: { fontFamily: "LatoBold", fontStyle: "normal" },
  project: {
    maxWidth: "100%",
    paddingRight: 3,
    fontFamily: "LatoBold",
    fontSize: 11,
    color: tokens.muted,

    backgroundColor: tokens.surface,
    zIndex: 1,
  },
  slots: { gap: 12 },
  connector: {
    position: "absolute",
    top: -12,
    left: "50%",
    height: 12,
    width: 2,
    marginLeft: -1,
    backgroundColor: tokens.muted,
    opacity: 0.325,
  },
  entryConnector: { height: 29 },
  slot: { backgroundColor: tokens.paper, borderRadius: 16, overflow: "hidden" },
  entryBody: { padding: 6 },
  previewTitle: { fontSize: 15, lineHeight: 19 },
  previewText: { fontSize: 12, lineHeight: 16 },
  footer: {
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.border,
  },
  footerControl: {
    minHeight: 22,
    minWidth: 22,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  meta: { fontFamily: "Lato", fontSize: 11, color: tokens.muted },
  feedback: {
    marginHorizontal: 14,
    backgroundColor: "rgba(57, 47, 47, 0.075)",
  },
  feedbackButton: {
    padding: 4,
    paddingHorizontal: 4,
    paddingVertical: 4,
    alignItems: "stretch",
  },
  reply: { flexDirection: "row", gap: 6, alignItems: "stretch" },
  replyText: {
    flex: 1,
    minWidth: 0,
    fontFamily: "Lato",
    fontSize: 12,
    lineHeight: 17,
    color: tokens.ink,
  },
  statementButton: { padding: 10, alignItems: "stretch", gap: 5 },
  statementText: {
    fontFamily: "Lato",
    fontStyle: "italic",
    fontSize: 14,
    lineHeight: 20,
    color: tokens.ink,
  },
  fixed: { aspectRatio: 1, marginHorizontal: 0, justifyContent: "center" },
  fixedEntry: { flex: 1, overflow: "hidden" },
  whiteFeedback: {
    backgroundColor: tokens.paper,
    marginLeft: 22,
    marginRight: 0,
    borderRadius: 10,
  },
  insetStatement: { borderRadius: 10, marginRight: 22 },
  selectedStatement: { padding: 8, paddingHorizontal: 8, paddingVertical: 8 },
  whiteStatement: {
    backgroundColor: tokens.paper,
    borderWidth: 0,
    borderRadius: 10,
    marginRight: 22,
  },
  signal: {
    backgroundColor: tokens.coolSoft,
    borderWidth: 1,
    borderColor: "rgba(57, 47, 47, 0.06)",
  },
  plainStatement: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(57, 47, 47, 0.22)",
  },
  detail: { padding: 12, gap: 16 },
});
