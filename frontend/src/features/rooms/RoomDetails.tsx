import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import type { useRoomMemberCarry } from "../../hooks/useRoomMemberCarry";
import { useRoomDetailsInteraction } from "../../hooks/useRoomDetailsInteraction";
import { appRoutes } from "../../lib/appRoutes";
import { PopupMenu } from "../../components/PopupMenu";
import { useEffect, useMemo, useRef } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { RoomIcon } from "../../components/RoomIcon";
import { UserAvatar } from "../../components/UserAvatar";
import { Icon } from "../../components/Icon";
import { useRoomDetails } from "../../hooks/useRoomDetails";
import { useContentLink } from "../../hooks/useContentLink";
import { roomPorosityLabel } from "../../lib/api/rooms";
import {
  introductionPairKey,
  memberId,
  memberTitle,
  memberLocation,
  orderMembers,
  roomTitle,
} from "../../lib/roomDetailsModel";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";

type Details = ReturnType<typeof useRoomDetails>;
export function RoomDetails({
  details,
  viewer,
  close,
  compact = false,
  expand,
}: {
  details: Details;
  viewer?: number;
  close: () => void;
  compact?: boolean;
  expand?: () => void;
}) {
  const navigation = useRoomNavigation();
  const links = useContentLink();
  const sideChatAnchor = useRef<View>(null);
  const memberControls = useRef(new Map<number, View>());
  const restoreSelectionFocus = useRef<"side" | "members" | undefined>(
    undefined,
  );
  const scroll = useRef<ScrollView>(null);
  const { selection, mode, note, setNote, feedback, error, duplicate, changeMode, toggle, run, carry } =
    useRoomDetailsInteraction({ details, close, compact, scroll,
      onReturn: (target) => { restoreSelectionFocus.current = target; },
    });
  const confirmation = useRef<Text>(null);
  const introductionError = useRef<Text>(null);
  const introductionOpen = mode === "introduce" && selection.length === 2;
  const memberAnchor = useRef<View>(null);
  const closeButton = useRef<View>(null);
  useEffect(() => {
    if (compact && Platform.OS === "web") closeButton.current?.focus();
  }, [compact]);
  useEffect(() => {
    if (!feedback && !error) return;
    if (introductionOpen) {
      if (error) {
        if (Platform.OS === "web") introductionError.current?.focus();
        else AccessibilityInfo.announceForAccessibility(error);
      }
      return;
    }
    Keyboard.dismiss();
    // Feedback is first in this feature's scroll region, including after the
    // selection form collapses. Avoid motion when revealing an action result.
    scroll.current?.scrollTo({ y: 0, animated: false });
    if (Platform.OS === "web") confirmation.current?.focus();
    else AccessibilityInfo.announceForAccessibility(error || feedback || "");
  }, [feedback, error, introductionOpen]);
  const roomDetails = details.room.data;
  const members = useMemo(
    () => orderMembers(details.members.data?.members ?? [], roomDetails?.id ?? ""),
    [details.members.data, roomDetails?.id],
  );
  const busy = details.action.isMutating;
  const canCreate =
    details.sides.data?.can_create ?? roomDetails?.access?.can_create_adjacent_room;
  const member = roomDetails?.access?.kind === "member";
  const selected = members.filter((person) =>
    selection.includes(memberId(person)),
  );
  useEffect(() => {
    if (mode !== "details" || !restoreSelectionFocus.current) return;
    const target =
      restoreSelectionFocus.current === "side" ? sideChatAnchor : memberAnchor;
    restoreSelectionFocus.current = undefined;
    if (Platform.OS === "web") target.current?.focus();
  }, [mode]);
  if (!roomDetails || details.room.error)
    return (
      <View style={[layout.content, layout.section]}>
        {details.room.isLoading ? (
          <ActivityIndicator accessibilityLabel="Loading Room details" />
        ) : (
          <>
            <Text accessibilityRole="alert" style={layout.text}>
              Could not load this Room.
            </Text>
            <Button
              style={styles.target}
              onPress={() => {
                void details.room.mutate().catch(() => {});
              }}
            >
              Retry details
            </Button>
          </>
        )}
        <Button style={styles.target} emphasis="ghost" onPress={close}>
          Back to Chat
        </Button>
      </View>
    );
  if (compact)
    return (
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.shelfContent}
        accessibilityLabel={`${roomDetails.name || "Room"} side rooms`}
      >
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={layout.text}>
            Side Rooms
          </Text>
          <Button
            emphasis="ghost"
            ref={closeButton}
            accessibilityLabel="Close Side Rooms"
            onPress={close}
          >
            <Icon name="x" size={18} />
          </Button>
        </View>
        {!introductionOpen && (error || feedback) && (
          <Text
            ref={confirmation}
            accessibilityLiveRegion="polite"
            accessibilityRole={error ? "alert" : undefined}
            style={layout.text}
          >
            {error || feedback}
          </Text>
        )}
        {canCreate && expand && (
          <Button emphasis="outline" style={styles.startChat} onPress={expand}>
            <Text style={styles.startChatLabel}>Start a side chat</Text>
          </Button>
        )}
        <RoomSideList
          details={details}
          activate={(room) => {
            void run({ kind: "activate", room });
          }}
        />
        {expand && (
          <Button emphasis="link" onPress={expand}>
            Room details
          </Button>
        )}
      </ScrollView>
    );
  return (
    <View style={styles.panel}>
    <ScrollView
      ref={scroll}
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
      scrollEnabled={!carry.drag}
      onScroll={carry.onScroll}
      onContentSizeChange={carry.onContentSizeChange}
      scrollEventThrottle={100}
      contentContainerStyle={[layout.content, styles.detailsContent]}
    >
      {!introductionOpen && (error || feedback) && (
        <Text
          ref={confirmation}
          {...(Platform.OS === "web" ? { tabIndex: -1 } : {})}
          accessibilityRole={error ? "alert" : undefined}
          accessibilityLiveRegion="polite"
          style={layout.text}
        >
          {error || feedback}
        </Text>
      )}
      {roomDetails.parent && (
        <View style={styles.wrap}>
          {(details.ancestry.data ?? [roomDetails.parent]).map(
            (parent) =>
              parent && (
                <Button
                  style={styles.target}
                  key={parent.id}
                  emphasis="link"
                  onPress={() => navigation.enter(String(parent.id))}
                >
                  {parent.name || "Parent Room"}
                </Button>
              ),
          )}
        </View>
      )}
      <Text style={styles.overview}>
        {roomPorosityLabel(roomDetails.porosity)} • {members.length}{" "}
        {members.length === 1 ? "member" : "members"}
      </Text>
      {links.error && (
        <Text accessibilityRole="alert" style={layout.text}>
          {links.error}
        </Text>
      )}

      <View style={styles.columns}>
        <View style={[styles.column, { zIndex: 2 }]}>
          <View
            ref={memberAnchor}
            {...(Platform.OS === "web" ? { tabIndex: -1 } : {})}
            style={styles.heading}
          >
            <Text
              accessibilityRole="header"
              aria-level={Platform.OS === "web" ? 2 : undefined}
              style={styles.sectionTitle}
            >
              Members
            </Text>
          </View>
          {details.members.isLoading && (
            <ActivityIndicator accessibilityLabel="Loading members" />
          )}
          {details.members.error ? (
            <Button
              style={styles.target}
              onPress={() => {
                void details.members.mutate().catch(() => {});
              }}
            >
              Retry members
            </Button>
          ) : (
            members.map((person) => (
              <View
                key={memberId(person)}
                collapsable={false}
                ref={carry.targetRef(
                  `member:${memberId(person)}`,
                  (user) =>
                    mode === "details" &&
                    memberId(person) !== viewer &&
                    user !== memberId(person),
                )}
                {...carry.handlers(
                  memberId(person),
                  memberId(person) !== viewer,
                )}
                style={[
                  styles.memberFrame,
                  mode !== "details" && styles.selectionFrame,
                  carry.drag &&
                    carry.drag.user !== memberId(person) &&
                    memberId(person) !== viewer &&
                    styles.availableDropTarget,
                  Platform.OS === "web" &&
                    ({ userSelect: "none", touchAction: "pan-y" } as ViewStyle),
                  carry.drag?.target === `member:${memberId(person)}` &&
                    styles.dropTarget,
                  carry.drag?.user === memberId(person) && {
                    zIndex: 5,
                    transform: [
                      { translateX: carry.drag.x },
                      { translateY: carry.drag.y },
                    ],
                  },
                ]}
              >
                <Button
                  ref={view => { if (view) memberControls.current.set(memberId(person), view); else memberControls.current.delete(memberId(person)); }}
                  emphasis="bare"
                  checked={
                    mode !== "details"
                      ? selection.includes(memberId(person)) ||
                        (mode === "side" && memberId(person) === viewer)
                      : undefined
                  }
                  disabled={
                    busy || (mode !== "details" && memberId(person) === viewer)
                  }
                  style={
                    mode === "details"
                      ? styles.memberCard
                      : styles.selectableRow
                  }
                  accessibilityLabel={
                    mode !== "details"
                      ? `${selection.includes(memberId(person)) ? "Deselect" : "Select"} ${memberTitle(person)}`
                      : `${memberTitle(person)}, ${memberLocation(person)}${memberId(person) === viewer ? ". This is you" : ". Swipe right to drag to a side room"}`
                  }
                  onPress={() => {
                    if (carry.consumeDraggedPress(memberId(person))) return;
                    if (mode !== "details" && memberId(person) !== viewer)
                      toggle(memberId(person));
                    else if (
                      mode === "details" &&
                      !carry.drag
                    ) {
                      close();
                      navigation.destination(appRoutes.roomMember(roomDetails.id, memberId(person)));
                    }
                  }}
                >
                  {mode !== "details" && (
                    <View
                      style={[
                        styles.selectionBox,
                        (selection.includes(memberId(person)) ||
                          (mode === "side" && memberId(person) === viewer)) &&
                          styles.selectionBoxChecked,
                      ]}
                    >
                      {(selection.includes(memberId(person)) ||
                        (mode === "side" && memberId(person) === viewer)) && (
                        <Icon name="checkBold" size={20} color={tokens.paper} />
                      )}
                    </View>
                  )}
                  <View
                    style={
                      mode !== "details"
                        ? styles.selectionCard
                        : styles.memberContents
                    }
                  >
                    <UserAvatar
                      username={memberTitle(person)}
                      avatarUrl={person.display_avatar_url ?? person.avatar_url}
                      size={28}
                    />
                    <View style={styles.copy}>
                      <Text numberOfLines={1} style={styles.cardTitle}>
                        {memberTitle(person)}
                      </Text>
                      <Text numberOfLines={1} style={styles.meta}>
                        {memberLocation(person)}
                      </Text>
                    </View>
                    {mode !== "details" ? null : carry.drag &&
                      carry.drag.user !== memberId(person) &&
                      memberId(person) !== viewer ? (
                      <Icon
                        name={
                          details.pairs.data?.pairs.some(
                            (pair) =>
                              introductionPairKey(
                                ...pair.recipient_user_ids,
                              ) ===
                              introductionPairKey(
                                carry.drag!.user,
                                memberId(person),
                              ),
                          )
                            ? "checkBold"
                            : "arrowLineDown"
                        }
                        size={20}
                        color={tokens.aqua}
                      />
                    ) : (
                      <View
                        style={[
                          styles.presence,
                          person.presence?.is_here && styles.presenceHere,
                        ]}
                      />
                    )}
                  </View>
                </Button>
              </View>
            ))
          )}
          {!details.members.isLoading &&
            !details.members.error &&
            !members.length && (
              <Text style={styles.meta}>No members to show.</Text>
            )}
        </View>
        <View style={styles.column}>
          <Text
            accessibilityRole="header"
            aria-level={Platform.OS === "web" ? 2 : undefined}
            style={styles.sectionTitle}
          >
            {mode === "side" ? "New Side Chat" : "Side Rooms"}
          </Text>
          {mode !== "details" && (
            <View
              collapsable={false}
              ref={carry.targetRef("side:new", () =>
                Boolean(canCreate && mode === "side"),
              )}
              style={[
                styles.selection,
                carry.drag?.target === "side:new" && styles.dropTarget,
              ]}
            >
              <View style={styles.wrap}>
                <Button
                  size="sm"
                  shape="pill"
                  emphasis="outline"
                  accessibilityLabel="Cancel selection"
                  disabled={busy}
                  onPress={() => changeMode("details")}
                >
                  Cancel
                </Button>
                {mode === "side" && (
                  <Button
                    size="sm"
                    shape="pill"
                    accessibilityLabel="Create side chat"
                    disabled={!selection.length || busy}
                    onPress={() => {
                      void run({ kind: "create", users: selection });
                    }}
                  >
                    {busy ? "Starting…" : "Start side chat"}
                  </Button>
                )}
              </View>
              <Text style={layout.text}>
                {mode === "side"
                  ? "Choose at least one other person from Members."
                  : mode === "carry"
                    ? "Choose a person, then a Room below."
                    : "Choose two people and describe the overlap you see."}
              </Text>
              <View style={styles.wrap}>
                {selected.map((person) => (
                  <Button
                    key={memberId(person)}
                    accessibilityLabel={`Remove ${memberTitle(person)}`}
                    emphasis="ghost"
                    disabled={busy}
                    style={styles.selected}
                    onPress={() => {
                      toggle(memberId(person));
                      memberControls.current.get(memberId(person))?.focus();
                    }}
                  >
                    <UserAvatar
                      username={memberTitle(person)}
                      avatarUrl={person.display_avatar_url ?? person.avatar_url}
                      size={16}
                    />
                    <Text style={styles.compact}>{memberTitle(person)}</Text>
                    <Icon name="x" size={12} />
                  </Button>
                ))}
              </View>
            </View>
          )}
          {member && canCreate && mode === "details" && (
            <View
              collapsable={false}
              ref={carry.targetRef("side:new", () => Boolean(canCreate))}
              style={styles.sideDropFrame}
            >
              <Button
                ref={sideChatAnchor}
                style={[styles.startChat, carry.drag && styles.startChatDragging, carry.drag && styles.availableDropTarget, carry.drag?.target === "side:new" && styles.dropTarget]}
                emphasis="outline"
                onPress={() => changeMode("side")}
              >
                <Text style={styles.startChatLabel}>Start a side chat</Text>
              </Button>
            </View>
          )}
          {mode !== "side" && (
            <RoomSideList
              drag={carry}
              details={details}
              activate={(room) => {
                void run({ kind: "activate", room });
              }}
              carry={
                mode === "carry" && selection.length === 1
                  ? (room) => {
                      void run({ kind: "carry", room, user: selection[0] });
                    }
                  : undefined
              }
            />
          )}
        </View>
      </View>
      <PopupMenu
        mode="dialog"
        open={mode === "introduce" && selected.length === 2}
        title={
          selected.length === 2
            ? `Introduce ${memberTitle(selected[0])} and ${memberTitle(selected[1])}`
            : "Make an introduction"
        }
        actions={[]}
        width={480}
        dismissDisabled={busy}
        onClose={() => changeMode("details")}
        footer={
          <View style={styles.modalActions}>
            <Button
              emphasis="outline"
              disabled={busy}
              onPress={() => changeMode("details")}
            >
              Cancel
            </Button>
            <Button
              disabled={!note.trim() || busy || Boolean(duplicate)}
              onPress={() => {
                void run({ kind: "introduce", users: selection, note });
              }}
            >
              {busy ? "Introducing…" : "Make introduction"}
            </Button>
          </View>
        }
      >
        <View style={styles.introductionForm}>
          <Text style={layout.text}>What overlap do you see?</Text>
          <Input
            autoFocus
            accessibilityLabel="Introduction note"
            placeholder="What overlap do you see?"
            multiline
            maxLength={1000}
            value={note}
            editable={!busy}
            onChangeText={setNote}
          />
          {duplicate && (
            <Text style={layout.muted}>
              These people have already been introduced.
            </Text>
          )}
          {error && (
            <Text
              ref={introductionError}
              {...(Platform.OS === "web" ? { tabIndex: -1 } : {})}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={layout.text}
            >
              {error}
            </Text>
          )}
        </View>
      </PopupMenu>

    </ScrollView>
      <View {...(Platform.OS === "web" ? { dataSet: { viewportBottomControls: "true" } } : {})} style={[layout.content, styles.links, layout.toolbarControls]}>
        {(
          [
            {
              title: "Rounds",
              icon: "flagBanner",
              href: `/app/rooms/${roomDetails.id}/rounds`,
              allowed: true,
            },
            {
              title: "Notifications",
              icon: "bell",
              href: "/app/notification-preferences",
              allowed: true,
            },
            {
              title: "Notes",
              icon: "bookOpenText",
              href: `/app/rooms/${roomDetails.id}/notes`,
              allowed: roomDetails.access?.can_view_notes,
            },
            {
              title: "Settings",
              icon: "gearFine",
              href: `/app/rooms/${roomDetails.id}/settings`,
              allowed: roomDetails.access?.can_manage,
            },
          ] as const
        )
          .filter((item) => item.allowed)
          .map((item) => (
            <Button
              key={item.title}
              style={styles.detailLink}
              emphasis="ghost"
              accessibilityLabel={item.title}
              onPress={() => {
                void links.open(item.href);
              }}
            >
              <Icon name={item.icon} size={23} />
              <View style={styles.copy}>
                <Text style={styles.cardTitle}>{item.title}</Text>
              </View>
            </Button>
          ))}
      </View>
    </View>
  );
}
export function RoomSideList({
  details,
  activate,
  carry,
  drag,
}: {
  drag?: ReturnType<typeof useRoomMemberCarry>;
  details: Details;
  activate: (
    room: NonNullable<Details["sides"]["data"]>["adjacent_rooms"][number],
  ) => void;
  carry?: (
    room: NonNullable<Details["sides"]["data"]>["adjacent_rooms"][number],
  ) => void;
}) {
  if (details.sides.error)
    return (
      <Button
        style={styles.target}
        emphasis="link"
        onPress={() => {
          void details.sides.mutate().catch(() => {});
        }}
      >
        Retry Side Rooms
      </Button>
    );
  if (details.sides.isLoading)
    return <ActivityIndicator accessibilityLabel="Loading Side Rooms" />;
  return (
    <View style={styles.sideList}>
      {details.sides.data?.adjacent_rooms.map((room) => {
        const acceptsDrop = Boolean(room.porosity === "closed" ? room.actions.suggest_knock : room.actions.invite);
        const action = carry
          ? room.porosity === "closed"
            ? "Suggest knock for"
            : "Invite to"
          : room.actions.enter
            ? "Enter"
            : room.actions.knock
              ? "Knock on"
              : room.actions.join
                ? "Join"
                : room.actions.request_join
                  ? "Ask to join"
                  : "Requested";
        const allowed = carry
          ? room.porosity === "closed"
            ? room.actions.suggest_knock
            : room.actions.invite
          : room.actions.enter ||
            room.actions.join ||
            room.actions.request_join ||
            room.actions.knock;
        return (
          <View
            key={room.id}
            collapsable={false}
            ref={drag?.targetRef(`side:${room.id}`, () => acceptsDrop)}
            style={styles.sideDropFrame}
          >
            <Button
              emphasis="ghost"
              style={[styles.sideCard, drag?.drag && acceptsDrop && styles.availableDropTarget, drag?.drag?.target === `side:${room.id}` && styles.dropTarget]}
              accessibilityLabel={`${action} ${roomTitle(room)}`}
              disabled={details.action.isMutating || !allowed}
              onPress={() => (carry ? carry(room) : activate(room))}
            >
              <RoomIcon name={roomTitle(room)} size={28} />
              <View style={styles.copy}>
                <Text numberOfLines={1} style={styles.cardTitle}>
                  {roomTitle(room)}
                </Text>
                <Text numberOfLines={1} style={styles.meta}>
                  {room.porosity_label} • {room.member_count} members
                  {room.viewer_state === "requested" ? " • Requested" : ""}
                </Text>
              </View>
              {drag?.drag &&
              (room.porosity === "closed"
                ? room.actions.suggest_knock
                : room.actions.invite) ? (
                <Icon name="arrowLineDown" size={20} color={tokens.aqua} />
              ) : (
                <View style={styles.sideArrow}>
                  <Icon name="arrowUpLeft" size={18} />
                </View>
              )}
            </Button>
          </View>
        );
      })}
      {!details.sides.data?.adjacent_rooms.length && (
        <Text style={styles.meta}>No Side Rooms yet.</Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  sideDropFrame: { borderRadius: 8 },
  availableDropTarget: {
    outlineColor: tokens.aqua,
    outlineWidth: 1,
    outlineStyle: "solid",
    borderRadius: 8,
    backgroundColor: tokens.surface,
  },
  dropTarget: {
    backgroundColor: tokens.coolPale,
    outlineColor: tokens.aqua,
    outlineWidth: 1,
    borderRadius: 8,
    outlineStyle: "solid",
  },
  scroll: { flex: 1, minHeight: 0 },
  panel: {
    flex: 1,
    minHeight: 0,
    backgroundColor: tokens.paper,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  detailsContent: { paddingTop: 0, paddingBottom: 12, gap: 16 },
  shelfContent: { padding: 12, gap: 8 },
  overview: {
    textAlign: "center",
    color: tokens.muted,
    fontFamily: "LatoBold",
    fontSize: 12,
    lineHeight: 16,
  },
  columns: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  column: { flex: 1, minWidth: 0, gap: 8 },
  sectionTitle: {
    minHeight: 36,
    paddingTop: 8,
    fontFamily: "PoppinsSemibold",
    fontSize: 18,
    color: tokens.ink,
  },
  memberFrame: {
    borderRadius: 20,
    backgroundColor: tokens.surface,
  },
  memberCard: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    gap: 8,
    minHeight: 50,
    paddingVertical: 6,
    paddingHorizontal: 7,
  },
  selectionFrame: { borderWidth: 0, backgroundColor: "transparent" },
  selectableRow: {
    flexDirection: "row",
    width: "100%",
    paddingHorizontal: 0,
    paddingVertical: 0,
    gap: 8,
  },
  selectionBox: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderColor: tokens.inkMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  selectionBoxChecked: { backgroundColor: tokens.inkMuted },
  selectionCard: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 50,
    paddingVertical: 6,
    paddingHorizontal: 7,
    backgroundColor: tokens.surface,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: tokens.radius,
  },
  memberContents: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  presence: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: tokens.surface,
    backgroundColor: tokens.inkMuted,
  },
  presenceHere: { backgroundColor: tokens.green },
  introductionForm: { padding: 16, gap: 8 },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    padding: 8,
  },
  copy: { flex: 1, minWidth: 0 },
  cardTitle: {
    fontFamily: "BarlowCondensedBold",
    fontSize: 18,
    lineHeight: 21,
    color: tokens.ink,
  },
  meta: {
    fontFamily: "Lato",
    fontSize: 12,
    lineHeight: 15,
    color: tokens.muted,
  },
  selection: { gap: 8 },
  sideList: { gap: 8 },
  sideCard: {
    flexDirection: "row",
    justifyContent: "flex-start",
    minHeight: 52,
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 25,
  },
  sideArrow: { transform: [{ rotate: "180deg" }] },
  startChatDragging: { borderColor: "transparent", backgroundColor: tokens.surface },
  startChatLabel: { fontFamily: "LatoBold", fontSize: 14, color: tokens.ink },
  startChat: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: tokens.paper,
    borderWidth: 1,
    borderColor: tokens.inkMuted,
    borderRadius: 8,
    minHeight: 44,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  links: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: 1,
    borderTopColor: tokens.border,
    paddingVertical: 8,
    flexShrink: 0,
    backgroundColor: tokens.paper,
    gap: 4,
  },
  detailLink: {
    width: "49%",
    minHeight: 44,
    flexDirection: "row",
    gap: 8,
    padding: 8,
  },
  heading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
  },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  selected: {
    flexDirection: "row",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 8,
  },
  compact: { fontFamily: "Lato", fontSize: 13, color: tokens.ink },
  selectPerson: { minWidth: 32, paddingHorizontal: 6 },
  target: { minHeight: 48, minWidth: 48 },
});
