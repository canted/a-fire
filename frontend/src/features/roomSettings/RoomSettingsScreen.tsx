import { PageScrollView } from "../../components/PageScrollView";
import { PopupMenu } from "../../components/PopupMenu";
import { Checkbox } from "../../components/Checkbox";
import {
  feedbackTypeLabel,
  ideaGuidancePrompt,
} from "../../lib/feedbackCopy";
import { tokens } from "../../styles/tokens";
import { Select } from "../../components/Select";
import { Icon } from "../../components/Icon";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { RoomIcon } from "../../components/RoomIcon";
import { AppImage } from "../../components/AppImage";
import { UserAvatar } from "../../components/UserAvatar";
import { ViewportShell } from "../../components/ViewportShell";
import { useRoomManagement } from "../../hooks/useRoomManagement";
import { useContentLink } from "../../hooks/useContentLink";
import { pickChatFile, releaseChatFile } from "../../lib/chatFiles";
import type { ChatAttachment } from "../../lib/chatComposition";
import { assertImageFile } from "../../lib/imageFile";
import {
  DEFAULT_FEEDBACK_TYPES,
  IDEA_GUIDANCE_VALUES,
  type RoomReplySettings,
} from "../../lib/feedback";
import { RoomInvites } from "../invites/RoomInvitesScreen";
import { layout } from "../../styles/layout";

type Management = ReturnType<typeof useRoomManagement>;
export function RoomSettingsScreen() {
  const { roomId, "#": anchor } = useLocalSearchParams<{
    roomId: string;
    "#": string;
  }>();
  const query = useRoomManagement(roomId);
  const navigation = useRoomNavigation();
  const router = useRouter();
  const links = useContentLink();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [removeMember, setRemoveMember] = useState<number>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const memberAnchor = useRef<View>(null);
  const deleteAnchor = useRef<View>(null);
  const scroll = useRef<ScrollView>(null);
  const invitesY = useRef<number | undefined>(undefined);
  const navigatedAnchor = useRef(false);
  const run = async (
    action: Parameters<Management["run"]>[0],
    done?: () => void,
  ) => {
    setError(undefined);
    setMessage(undefined);
    try {
      await query.run(action);
      setMessage("Saved.");
      done?.();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save. Try again.",
      );
    }
  };
  return (
    <ViewportShell>
      <View style={[layout.content, layout.appBar]}>
        <Button size="icon" emphasis="bare" accessibilityLabel="Back to room details"
          onPress={() => navigation.ancestor(`/app/rooms/${roomId}?panel=details`)}>
          <Icon name="caretCircleLeft" size={28} />
        </Button>
        <Text accessibilityRole="header" style={layout.appBarTitle}>Room settings</Text>
      </View>
      <PageScrollView
        ref={scroll}
        accessibilityLabel="Room Settings"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[layout.section]}
      >
        {query.room.isLoading ? (
          <ActivityIndicator accessibilityLabel="Loading Room settings" />
        ) : query.room.error ? (
          <Button
            style={styles.target}
            onPress={() => {
              void query.room.mutate().catch(() => {});
            }}
          >
            Retry Room settings
          </Button>
        ) : !query.allowed ? (
          <Text accessibilityRole="alert" style={layout.text}>
            You do not have permission to manage this Room.
          </Text>
        ) : (
          <>
            <RoomIdentitySettings key={`identity-${roomId}`} query={query} run={run} />
            {query.room.data?.replySettings && (
              <ReplySettings
                key={`replies-${roomId}`}
                settings={query.room.data.replySettings}
                query={query}
                run={run}
              />
            )}
            {error && (
              <Text accessibilityRole="alert" style={layout.text}>
                {error}
              </Text>
            )}
            {message && (
              <Text accessibilityLiveRegion="polite" style={layout.text}>
                {message}
              </Text>
            )}
            <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.panelTitle}>
                Members
              </Text>
              {query.members.isLoading && (
                <ActivityIndicator accessibilityLabel="Loading members" />
              )}
              {query.members.error && (
                <Button
                  style={styles.target}
                  onPress={() => {
                    void query.members.mutate().catch(() => {});
                  }}
                >
                  Retry members
                </Button>
              )}
              {query.members.data?.members.map((member) => (
                <View key={member.id} style={layout.section}>
                  <View style={styles.identity}>
                    <UserAvatar
                      username={member.display_username}
                      avatarUrl={member.display_avatar_url || member.avatar_url}
                      size={30}
                    />
                    <Text
                      numberOfLines={1}
                      style={[styles.memberName, layout.grow]}
                    >
                      {member.display_username}
                    </Text>
                    {query.host && (
                      <Button
                        size="sm"
                        shape="pill"
                        style={styles.target}
                        emphasis="outline"
                        color={tokens.danger}
                        disabled={query.busy}
                        ref={
                          removeMember === member.id ? memberAnchor : undefined
                        }
                        accessibilityLabel={`Delete ${member.display_username}`}
                        onPress={() => {
                          setError(undefined);
                          setRemoveMember(member.id);
                        }}
                      >
                        <View style={styles.deleteLabel}>
                          <Icon name="trash" size={14} color={tokens.danger} />
                          <Text style={styles.danger}>Delete</Text>
                        </View>
                      </Button>
                    )}
                  </View>
                </View>
              ))}
            </View>
            <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.panelTitle}>
                Requests
              </Text>
              {(query.joins.isLoading || query.knocks.isLoading) && (
                <ActivityIndicator accessibilityLabel="Loading requests" />
              )}
              {(query.joins.error || query.knocks.error) && (
                <Button
                  style={styles.target}
                  onPress={() => {
                    void Promise.all([
                      query.joins.mutate(),
                      query.knocks.mutate(),
                    ]).catch(() => {});
                  }}
                >
                  Retry requests
                </Button>
              )}
              {!query.joins.isLoading &&
                !query.knocks.isLoading &&
                !query.joins.error &&
                !query.knocks.error &&
                ![
                  ...(query.joins.data?.join_requests ?? []),
                  ...(query.knocks.data?.knocks ?? []),
                ].some(
                  (item) =>
                    item.status === "pending" || item.status === "declined",
                ) && <Text style={styles.hint}>No pending requests.</Text>}
              {[
                ...(query.joins.data?.join_requests ?? []).map((item) => ({
                  kind: "join" as const,
                  item,
                })),
                ...(query.knocks.data?.knocks ?? []).map((item) => ({
                  kind: "knock" as const,
                  item,
                })),
              ]
                .filter(
                  ({ item }) =>
                    item.status === "pending" || item.status === "declined",
                )
                .map(({ kind, item }) => (
                  <View key={`${kind}-${item.id}`} style={layout.section}>
                    <Text style={layout.text}>
                      {item.user.display_username} ·{" "}
                      {kind === "join" ? "Asked to join" : "Knocked"} ·{" "}
                      {item.status}
                    </Text>
                    <View style={styles.wrap}>
                      <Button
                        size="sm"
                        shape="pill"
                        style={styles.target}
                        disabled={query.busy}
                        onPress={() => {
                          void run(
                            kind === "join"
                              ? {
                                  kind,
                                  request: item.id,
                                  status:
                                    item.status === "declined"
                                      ? "pending"
                                      : "approved",
                                }
                              : { kind, request: item.id, status: "admitted" },
                          );
                        }}
                      >
                        {item.status === "declined" ? "Reconsider" : "Approve"}
                      </Button>
                      {item.status === "pending" && (
                        <Button
                          style={styles.target}
                          emphasis="ghost"
                          disabled={query.busy}
                          onPress={() => {
                            void run({
                              kind,
                              request: item.id,
                              status: "declined",
                            });
                          }}
                        >
                          Decline
                        </Button>
                      )}
                    </View>
                  </View>
                ))}
            </View>
            <View
              style={styles.panel}
              onLayout={(event) => {
                invitesY.current = event.nativeEvent.layout.y;
                if (anchor === "invites" && !navigatedAnchor.current) {
                  navigatedAnchor.current = true;
                  scroll.current?.scrollTo({
                    y: invitesY.current,
                    animated: false,
                  });
                }
              }}
            >
              <Text accessibilityRole="header" style={styles.panelTitle}>
                Invites
              </Text>
              <RoomInvites room={roomId} />
            </View>
            {query.host && (
              <>
                <View style={styles.panel}>
                  <Text accessibilityRole="header" style={styles.panelTitle}>
                    Notification deliveries
                  </Text>
                  {query.deliveries.isLoading && (
                    <ActivityIndicator accessibilityLabel="Loading notification deliveries" />
                  )}
                  {query.deliveries.error && (
                    <>
                      <Text accessibilityRole="alert" style={styles.hint}>
                        Could not load notification deliveries.
                      </Text>
                      <Button
                        style={styles.target}
                        onPress={() => {
                          void query.deliveries.mutate().catch(() => {});
                        }}
                      >
                        Retry deliveries
                      </Button>
                    </>
                  )}
                  {!query.deliveries.isLoading &&
                    !query.deliveries.error &&
                    query.deliveries.data?.items.length === 0 && (
                      <Text style={styles.hint}>
                        No notification deliveries found.
                      </Text>
                    )}
                  {!query.deliveries.error &&
                    query.deliveries.data?.items.map((delivery) => (
                      <View key={delivery.id} style={layout.section}>
                        <Text style={layout.text}>
                          {delivery.user_name} · {delivery.state}
                        </Text>
                        <Text style={layout.muted}>
                          {new Date(delivery.created_at).toLocaleString()} ·{" "}
                          {delivery.content_seen ? "Seen" : "Not seen"}
                        </Text>
                        {delivery.link_path ? (
                          <Button
                            style={styles.target}
                            emphasis="link"
                            onPress={() => {
                              void links.open(delivery.link_path);
                            }}
                          >
                            {delivery.link_label}
                          </Button>
                        ) : (
                          <Text style={layout.text}>{delivery.link_label}</Text>
                        )}
                        {(delivery.skip_reason || delivery.last_error) && (
                          <Text style={layout.muted}>
                            {delivery.skip_reason || delivery.last_error}
                          </Text>
                        )}
                      </View>
                    ))}
                  {links.error && (
                    <Text accessibilityRole="alert" style={layout.text}>
                      {links.error}
                    </Text>
                  )}
                </View>
                <View style={styles.panel}>
                  <Text accessibilityRole="header" style={styles.panelTitle}>
                    First entry prompt
                  </Text>
                  <View style={styles.actions}>
                    <Button
                      shape="pill"
                      emphasis="outline"
                      onPress={() =>
                        navigation.destination(
                          `/app/rooms/${roomId}/first-entry-prompt`,
                        )
                      }
                    >
                      Customize
                    </Button>
                  </View>
                </View>
                <View style={styles.panel}>
                  <Text
                    accessibilityRole="header"
                    style={[styles.panelTitle, { color: tokens.danger }]}
                  >
                    Delete Room
                  </Text>
                  <View style={styles.dangerRow}>
                    <Text style={[layout.text, layout.grow]}>
                      Deleting this Room will permanently remove all of its
                      entries, notes, chat messages, members, and other data. This
                      cannot be undone.
                    </Text>
                    <Button
                      ref={deleteAnchor}
                      shape="pill"
                      emphasis="outline"
                      color={tokens.danger}
                      onPress={() => {
                        setError(undefined);
                        setDeleteOpen(true);
                      }}
                    >
                      Delete Room
                    </Button>
                  </View>
                </View>
              </>
            )}
          </>
        )}
      </PageScrollView>
      <PopupMenu
        mode="dialog"
        open={removeMember !== undefined}
        title="Delete member"
        actions={[]}
        anchor={memberAnchor}
        width={480}
        dismissDisabled={query.busy}
        onClose={() => setRemoveMember(undefined)}
        footer={
          <View style={styles.actions}>
            <Button
              size="sm"
              shape="pill"
              emphasis="outline"
              disabled={query.busy}
              onPress={() => setRemoveMember(undefined)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              shape="pill"
              color={tokens.danger}
              disabled={query.busy}
              onPress={() => {
                if (removeMember !== undefined)
                  void run(
                    { kind: "remove-member", membership: removeMember },
                    () => setRemoveMember(undefined),
                  );
              }}
            >
              {query.busy ? "Deleting…" : "Delete member"}
            </Button>
          </View>
        }
      >
        <View style={styles.dialog}>
          <Text style={layout.text}>
            Remove{" "}
            {query.members.data?.members.find(
              (member) => member.id === removeMember,
            )?.display_username || "this member"}{" "}
            from {query.room.data?.name || "Room"}?
          </Text>
          <Text style={layout.muted}>
            They will lose access to this room.
          </Text>
          {error && (
            <Text accessibilityRole="alert" style={styles.danger}>
              {error}
            </Text>
          )}
        </View>
      </PopupMenu>
      <PopupMenu
        mode="dialog"
        open={deleteOpen}
        title="Delete Room"
        actions={[]}
        anchor={deleteAnchor}
        width={480}
        dismissDisabled={query.busy}
        onClose={() => {
          setDeleteOpen(false);
          setConfirmation("");
        }}
        footer={
          <View style={styles.actions}>
            <Button
              size="sm"
              shape="pill"
              emphasis="outline"
              disabled={query.busy}
              onPress={() => {
                setDeleteOpen(false);
                setConfirmation("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              shape="pill"
              color={tokens.danger}
              disabled={
                query.busy ||
                confirmation !== (query.room.data?.name?.trim() || "Room")
              }
              onPress={() => {
                void run({ kind: "remove-room" }, () => router.replace("/app"));
              }}
            >
              {query.busy ? "Deleting…" : "Delete Room"}
            </Button>
          </View>
        }
      >
        <View style={styles.dialog}>
          <Text style={layout.text}>
            All data in this Room will be lost. To confirm, type{" "}
            {query.room.data?.name || "Room"}.
          </Text>
          <Input
            accessibilityLabel="Type Room name to confirm deletion"
            placeholder={query.room.data?.name || "Room"}
            value={confirmation}
            editable={!query.busy}
            onChangeText={setConfirmation}
          />
          {error && (
            <Text accessibilityRole="alert" style={styles.danger}>
              {error}
            </Text>
          )}
        </View>
      </PopupMenu>
    </ViewportShell>
  );
}
export function RoomFirstEntryPromptScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const query = useRoomManagement(roomId);
  const navigation = useRoomNavigation();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const run: FormProps["run"] = async (action, done) => {
    setError(undefined);
    setSaved(false);
    try {
      await query.run(action);
      setSaved(true);
      done?.();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save prompts.",
      );
    }
  };
  return (
    <ViewportShell>
      <PageScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[layout.section]}
      >
        <View style={layout.row}>
          <Button
            size="icon"
            emphasis="bare"
            accessibilityLabel="Back"
            disabled={query.busy}
            onPress={() =>
              navigation.returnTo(`/app/rooms/${roomId}/settings`)
            }
          >
            <Icon name="caretCircleLeft" size={28} />
          </Button>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            ellipsizeMode="tail"
            style={layout.appBarTitle}
          >
            First entry prompt
          </Text>
        </View>
        {query.room.isLoading || query.identity.isLoading ? (
          <ActivityIndicator accessibilityLabel="Loading prompts" />
        ) : query.room.error || query.identity.error ? (
          <>
            <Text accessibilityRole="alert" style={layout.text}>
              Could not check Room access.
            </Text>
            <Button
              onPress={() => {
                void Promise.allSettled([
                  query.room.mutate(),
                  query.identity.mutate(),
                ]);
              }}
            >
              Retry Room access
            </Button>
          </>
        ) : !query.host ? (
          <Text accessibilityRole="alert" style={layout.text}>
            Only the Room host can customize these prompts.
          </Text>
        ) : query.prompts.error ? (
          <Button
            onPress={() => {
              void query.prompts.mutate().catch(() => {});
            }}
          >
            Retry prompts
          </Button>
        ) : query.prompts.data ? (
          <FirstEntryPrompts query={query} run={run} />
        ) : (
          <ActivityIndicator accessibilityLabel="Loading prompts" />
        )}
        {error && (
          <Text accessibilityRole="alert" style={layout.text}>
            {error}
          </Text>
        )}
        {saved && (
          <Text accessibilityLiveRegion="polite" style={layout.text}>
            Saved.
          </Text>
        )}
      </PageScrollView>
    </ViewportShell>
  );
}
type FormProps = {
  query: Management;
  run: (
    action: Parameters<Management["run"]>[0],
    done?: () => void,
  ) => Promise<void>;
};
function RoomIdentitySettings({ query, run }: FormProps) {
  const [name, setName] = useState(query.room.data?.name || "");
  const [avatar, setAvatar] = useState<ChatAttachment>();
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [error, setError] = useState<string>();
  const hasIcon = Boolean(
    avatar || (!removeAvatar && query.room.data?.avatar_url),
  );
  const file = useRef(avatar);
  file.current = avatar;
  useEffect(() => () => releaseChatFile(file.current), []);
  const choose = async () => {
    let next: ChatAttachment | undefined;
    try {
      next = await pickChatFile("photo");
      if (!next) return;
      assertImageFile(next);
      releaseChatFile(avatar);
      setAvatar(next);
      setRemoveAvatar(false);
      setError(undefined);
    } catch (reason) {
      releaseChatFile(next);
      setError(
        reason instanceof Error ? reason.message : "Could not choose an image.",
      );
    }
  };
  return (
    <View style={styles.panel}>
      <Text style={layout.text}>Room name</Text>
      <Input
        accessibilityLabel="Room name"
        placeholder="Room name"
        value={name}
        editable={!query.busy}
        onChangeText={setName}
      />
      <Text style={layout.text}>Room icon</Text>
      <View style={styles.identity}>
        {avatar ? (
          <View style={styles.image}>
            <AppImage
              src=""
              localPreview={{ uri: avatar.uri }}
              alt="Room icon preview"
              tiled
            />
          </View>
        ) : (
          <RoomIcon
            name={name}
            avatarUrl={removeAvatar ? null : query.room.data?.avatar_url}
            size={80}
          />
        )}
        <Button
          style={styles.target}
          emphasis="link"
          disabled={query.busy}
          onPress={() => {
            void choose();
          }}
        >
          {hasIcon ? "Change icon" : "Add icon"}
        </Button>
        {hasIcon && (
          <Button
            style={styles.target}
            emphasis="link"
            disabled={query.busy}
            onPress={() => {
              releaseChatFile(avatar);
              setAvatar(undefined);
              setRemoveAvatar(true);
            }}
          >
            Remove icon
          </Button>
        )}
      </View>
      {error && (
        <Text accessibilityRole="alert" style={layout.text}>
          {error}
        </Text>
      )}
      <Button
        size="sm"
        shape="pill"
        style={[styles.target, styles.save]}
        disabled={
          query.busy ||
          (name.trim() === (query.room.data?.name || "") &&
            !avatar &&
            !removeAvatar)
        }
        onPress={() => {
          void run({ kind: "identity", name, avatar, removeAvatar }, () => {
            releaseChatFile(avatar);
            setAvatar(undefined);
            setRemoveAvatar(false);
          });
        }}
      >
        Save changes
      </Button>
    </View>
  );
}
function ReplySettings({
  query,
  run,
  settings,
}: FormProps & { settings: RoomReplySettings }) {
  const [value, setValue] = useState(settings);
  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.panelTitle}>
        Reply settings
      </Text>
      <Select
        label="Reply style"
        value={value.replyMode}
        options={[
          { value: "simple", label: "simple" },
          { value: "guided", label: "structured" },
        ]}
        disabled={query.busy}
        onValueChange={(replyMode) => setValue({ ...value, replyMode })}
      />
      {value.replyMode === "guided" && (
        <>
          <Text style={layout.text}>Kinds of replies</Text>
          <View style={styles.wrap}>
            {DEFAULT_FEEDBACK_TYPES.map((type) => (
              <Checkbox
                key={type}
                label={feedbackTypeLabel(type)}
                checked={value.defaultFeedbackTypes.includes(type)}
                disabled={
                  query.busy ||
                  (value.defaultFeedbackTypes.includes(type) &&
                    value.defaultFeedbackTypes.length === 1)
                }
                onChange={(checked) =>
                  setValue({
                    ...value,
                    defaultFeedbackTypes: checked
                      ? [...value.defaultFeedbackTypes, type]
                      : value.defaultFeedbackTypes.filter(
                          (item) => item !== type,
                        ),
                  })
                }
              />
            ))}
          </View>
          <Text style={layout.text}>Idea guidance</Text>
          <Select
            label="Idea replies"
            value={value.defaultIdeaGuidance}
            options={IDEA_GUIDANCE_VALUES.map((guidance) => ({
              value: guidance,
              label: ideaGuidancePrompt(guidance),
            }))}
            disabled={query.busy}
            onValueChange={(defaultIdeaGuidance) =>
              setValue({ ...value, defaultIdeaGuidance })
            }
          />
        </>
      )}
      <Button
        size="sm"
        shape="pill"
        style={[styles.target, styles.save]}
        disabled={
          query.busy || JSON.stringify(value) === JSON.stringify(settings)
        }
        onPress={() => {
          void run({ kind: "reply", settings: value });
        }}
      >
        Save reply settings
      </Button>
    </View>
  );
}
function FirstEntryPrompts({ query, run }: FormProps) {
  const [prompt, setPrompt] = useState(
    query.prompts.data?.room_prompt || "",
  );
  const [members, setMembers] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      query.prompts.data!.members.map((member) => [
        member.id,
        member.first_entry_prompt_override || "",
      ]),
    ),
  );
  const dirty =
    prompt.trim() !== (query.prompts.data?.room_prompt || "").trim() ||
    query.prompts.data!.members.some(
      (member) =>
        (members[member.id] || "").trim() !==
        (member.first_entry_prompt_override || "").trim(),
    );
  const fallback = prompt.trim() || query.prompts.data!.default_prompt;
  return (
    <View style={styles.panel}>
      <Text style={layout.text}>Room prompt</Text>
      <Input
        testID="room-first-post-prompt"
        accessibilityLabel="Room first entry prompt"
        placeholder={query.prompts.data!.default_prompt}
        maxLength={140}
        value={prompt}
        editable={!query.busy}
        onChangeText={setPrompt}
      />
      <Text style={styles.hint}>
        Blank uses: {query.prompts.data!.default_prompt}
      </Text>
      {query.prompts.data?.members.map((member) => (
        <View key={member.id} style={styles.promptField}>
          <Text style={layout.text}>{member.display_username}</Text>
          <Input
            testID={`member-prompt-${member.display_username}`}
            accessibilityLabel={`First post prompt for ${member.display_username}`}
            placeholder={fallback}
            maxLength={140}
            value={members[member.id] || ""}
            editable={!query.busy}
            onChangeText={(value) =>
              setMembers((current) => ({ ...current, [member.id]: value }))
            }
          />
          <Text style={styles.hint}>Blank uses the room prompt</Text>
        </View>
      ))}
      <View style={styles.actions}>
        <Button
          size="sm"
          shape="pill"
          style={styles.target}
          disabled={query.busy || !dirty}
          onPress={() => {
            void run({
              kind: "prompts",
              payload: {
                room_prompt: prompt.trim() || null,
                member_prompts: Object.entries(members).map(([id, value]) => ({
                  membership_id: Number(id),
                  prompt: value.trim() || null,
                })),
              },
            });
          }}
        >
          {query.busy ? "Saving…" : "Save prompts"}
        </Button>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  hint: { fontFamily: "Lato", fontSize: 12, color: tokens.inkMuted },
  panel: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: tokens.border,
    gap: 12,
  },
  panelTitle: {
    fontFamily: "PoppinsSemibold",
    fontSize: 18,
    color: tokens.ink,
  },
  memberName: {
    fontFamily: "BarlowCondensedBold",
    fontSize: 18,
    lineHeight: 21.6,
    letterSpacing: -0.36,
    color: tokens.ink,
  },
  save: { alignSelf: "flex-end" },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: 8,
    padding: 8,
  },
  dialog: { padding: 16, gap: 12 },
  dangerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 16,
  },
  deleteLabel: { flexDirection: "row", gap: 6, alignItems: "center" },
  danger: { fontFamily: "Lato", fontSize: 14, color: tokens.danger },
  promptField: { gap: 8 },
  target: { minHeight: 48, minWidth: 48 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  image: { width: 80, height: 80 },
});
