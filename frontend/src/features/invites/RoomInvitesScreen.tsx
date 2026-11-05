import { useEffect, useRef, useState } from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { useRoomInvites } from "../../hooks/useRoomInvites";
import type {
  InviteSuggestionPayload,
  CreateInvitePayload,
} from "../../lib/api/invites";
import {
  inviteSuggestionLabel,
  inviteDate,
} from "../../lib/invitePresentation";
import { submitsPlainComposer } from "../../lib/plainMentionDraft";
import { tokens } from "../../styles/tokens";
import { layout } from "../../styles/layout";

export function RoomInvitesScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  return (
    <Redirect
      href={{
        pathname: "/app/rooms/[roomId]/settings",
        params: { roomId, "#": "invites" },
      }}
    />
  );
}
export function RoomInvites({ room }: { room: string }) {
  const [wide, setWide] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(blurTimer.current), []);
  const [hostEmail, setHostEmail] = useState("");
  const [selected, setSelected] = useState<InviteSuggestionPayload>();
  const query = useRoomInvites(room, selected ? "" : recipient);
  const suggestions = query.suggestions.data?.suggestions.slice(0, 8) ?? [];
  const chooseSuggestion = (person: InviteSuggestionPayload) => {
    setSelected(person);
    setRecipient(inviteSuggestionLabel(person));
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
  };
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  async function send(payload: CreateInvitePayload) {
    setError(undefined);
    setMessage(undefined);
    try {
      await query.send(payload);
      if (payload.invite_type === "room_invite") {
        setRecipient("");
        setSelected(undefined);
        setSuggestionsOpen(false);
        setMessage("Invitation created. Email delivery is pending.");
      } else {
        setHostEmail("");
        setMessage("Host invite sent.");
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not send the invite. Try again.",
      );
    }
  }
  if (query.room.isLoading)
    return (
      <ActivityIndicator accessibilityLabel="Loading invite permissions" />
    );
  if (query.room.error)
    return (
      <Button
        style={styles.target}
        onPress={() => {
          void query.room.mutate().catch(() => {});
        }}
      >
        Retry invite permissions
      </Button>
    );
  if (!query.allowed)
    return (
      <Text accessibilityRole="alert" style={layout.text}>
        You do not have permission to manage invitations for this Room.
      </Text>
    );
  const sendRoom = () => {
    if (!query.busy && recipient.trim())
      void send({
        invite_type: "room_invite",
        room_id: room,
        ...(selected
          ? { invitee_membership_id: selected.invitee_membership_id }
          : { email: recipient.trim() }),
      });
  };
  const sendHost = () => {
    if (!query.busy && hostEmail.trim())
      void send({
        invite_type: "new_room_invite",
        room_id: null,
        email: hostEmail.trim(),
      });
  };
  return (
    <View
      style={styles.root}
      onLayout={(event) => setWide(event.nativeEvent.layout.width >= 700)}
    >
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {message && (
        <Text accessibilityLiveRegion="polite" style={styles.helper}>
          {message}
        </Text>
      )}
      {query.list.data?.permissions.new_room_invite_allowed && (
        <View style={styles.hostPanel}>
          <View style={styles.hostHeader}>
            <Text accessibilityRole="header" style={styles.hostTitle}>
              Invite to make a NEW room
            </Text>
          </View>
          <View style={styles.hostBody}>
            <Text style={styles.description}>
              They can be the host of a new room
            </Text>
            <View style={[styles.form, wide && styles.formWide]}>
              <View style={styles.grow}>
                <Text style={styles.label}>Email</Text>
                <Input
                  accessibilityLabel="New Room host email"
                  placeholder="host@example.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={hostEmail}
                  editable={!query.busy}
                  onChangeText={setHostEmail}
                  onSubmitEditing={sendHost}
                />
              </View>
              <Button
                disabled={query.busy || !hostEmail.trim()}
                onPress={sendHost}
              >
                {query.busy ? "Sending…" : "Send host invite"}
              </Button>
            </View>
          </View>
        </View>
      )}
      <View style={[styles.form, wide && styles.formWide, { zIndex: 2 }]}>
        <View style={styles.grow}>
          <Text style={styles.label}>Email or member</Text>
          <Input
            accessibilityLabel="Invite email or person"
            placeholder="name or email"
            autoCapitalize="none"
            value={recipient}
            editable={!query.busy}
            onFocus={() => {
              clearTimeout(blurTimer.current);
              setSuggestionsOpen(true);
            }}
            onBlur={() => {
              blurTimer.current = setTimeout(
                () => setSuggestionsOpen(false),
                100,
              );
            }}
            onSubmitEditing={Platform.OS === "web" ? undefined : sendRoom}
            onKeyPress={(event) => {
              const key = event.nativeEvent.key;
              if (key === "Escape") {
                event.preventDefault();
                setSuggestionsOpen(false);
                setActiveSuggestion(-1);
              } else if (
                (key === "ArrowDown" || key === "ArrowUp") &&
                suggestions.length
              ) {
                event.preventDefault();
                setSuggestionsOpen(true);
                setActiveSuggestion((index) =>
                  index < 0
                    ? key === "ArrowDown"
                      ? 0
                      : suggestions.length - 1
                    : (index +
                        (key === "ArrowDown" ? 1 : -1) +
                        suggestions.length) %
                      suggestions.length,
                );
              } else if (submitsPlainComposer(event.nativeEvent)) {
                if (suggestionsOpen && suggestions[activeSuggestion]) {
                  event.preventDefault();
                  chooseSuggestion(suggestions[activeSuggestion]);
                } else if (Platform.OS === "web") {
                  event.preventDefault();
                  sendRoom();
                }
              }
            }}
            onChangeText={(value) => {
              setRecipient(value);
              setSelected(undefined);
              setSuggestionsOpen(true);
              setActiveSuggestion(-1);
            }}
          />
          {!selected && suggestionsOpen && suggestions.length > 0 && (
            <View style={styles.suggestions}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={{ maxHeight: 256 }}
              >
                {suggestions.map((person, index) => (
                  <Button
                    key={person.invitee_membership_id}
                    style={styles.suggestion}
                    emphasis={activeSuggestion === index ? "outline" : "bare"}
                    onPress={() => chooseSuggestion(person)}
                  >
                    <Text style={styles.suggestionLabel}>
                      {inviteSuggestionLabel(person)}
                    </Text>
                  </Button>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
        <Button disabled={query.busy || !recipient.trim()} onPress={sendRoom}>
          {query.busy ? "Sending…" : "Send invite"}
        </Button>
      </View>
      {query.suggestions.error && (
        <Text style={styles.helper}>
          Could not load member suggestions. You can still enter an email.
        </Text>
      )}
      <View>
        <Text accessibilityRole="header" style={styles.recent}>
          Recent invites
        </Text>
        {query.list.isLoading && (
          <ActivityIndicator accessibilityLabel="Loading invitations" />
        )}
        {query.list.error && (
          <Button
            emphasis="link"
            onPress={() => {
              void query.list.mutate().catch(() => {});
            }}
          >
            Retry invitations
          </Button>
        )}
        {!query.list.error &&
          query.list.data?.invites.map((invite, index) => (
            <View
              key={invite.id}
              style={[styles.invite, index > 0 && styles.divider]}
            >
              <Text style={styles.recipient}>
                {invite.recipient_label || invite.email || "Invitee"}
              </Text>
              <View style={styles.metadata}>
                <Text style={[styles.helper, { textTransform: "capitalize" }]}>
                  {invite.status}
                  {invite.status === "used" && invite.used_at
                    ? ` ${inviteDate(invite.used_at)}`
                    : !invite.used_at && invite.expires_at
                      ? ` ${inviteDate(invite.expires_at)}`
                      : ""}
                </Text>
                <Text style={styles.helper}>
                  Created {inviteDate(invite.created_at)}
                </Text>
              </View>
            </View>
          ))}
        {query.list.data?.invites.length === 0 && (
          <Text style={styles.description}>No invites for this room yet.</Text>
        )}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  target: { minHeight: 48, minWidth: 48 },
  root: { gap: 24 },
  label: {
    fontFamily: "Lato",
    fontSize: 14,
    color: tokens.ink,
    marginBottom: 8,
  },
  form: { gap: 12 },
  formWide: { flexDirection: "row", alignItems: "flex-end", gap: 16 },
  grow: { flex: 1, minWidth: 0 },
  hostPanel: {
    borderWidth: 2,
    borderColor: tokens.fire,
    borderRadius: tokens.radius,
    backgroundColor: tokens.paper,
  },
  hostHeader: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  hostBody: { paddingVertical: 12, paddingHorizontal: 16 },
  hostTitle: { fontFamily: "BarlowCondensedSemibold", fontSize: 20, color: tokens.ink },
  description: {
    fontFamily: "Lato",
    fontSize: 14,
    color: tokens.inkMuted,
    paddingBottom: 16,
  },
  helper: { fontFamily: "Lato", fontSize: 12, color: tokens.inkMuted },
  error: { fontFamily: "Lato", fontSize: 12, color: tokens.danger },
  suggestions: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    marginTop: 4,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: tokens.radius,
    backgroundColor: tokens.paper,
    zIndex: 3,
    boxShadow: "0 8px 24px rgba(26,37,39,0.15)",
  },
  suggestion: {
    alignItems: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  suggestionLabel: { fontFamily: "LatoBold", fontSize: 16, color: tokens.ink },
  recent: { fontFamily: "BarlowCondensedSemibold", fontSize: 14, color: tokens.ink },
  invite: { paddingVertical: 12, gap: 4 },
  divider: { borderTopWidth: 1, borderTopColor: tokens.border },
  recipient: { fontFamily: "LatoBold", fontSize: 16, color: tokens.ink },
  metadata: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
});
