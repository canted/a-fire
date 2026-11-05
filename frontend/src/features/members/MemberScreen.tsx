import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { PageScrollView } from "../../components/PageScrollView";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { Select } from "../../components/Select";
import { MemberProfileHeader } from "./MemberProfileHeader";
import { ViewportShell } from "../../components/ViewportShell";
import { RoomHeader } from "../rooms/RoomHeader";
import { ProjectIcon } from "../projects/ProjectIcon";
import { EntryContent } from "../content/EntryContent";
import { useMemberProfile } from "../../hooks/useMembers";
import { useRoomDetails } from "../../hooks/useRoomDetails";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";
export function MemberScreen() {
  const { roomId, memberUserId } = useLocalSearchParams<{ roomId: string; memberUserId: string }>();
  const { query, profile, room: roomDetails, entries: entries, hasMore, profilePath } = useMemberProfile({ roomId, memberUserId });
  const navigation = useRoomNavigation();
  if (!profile || roomDetails.error)
    return (
      <ViewportShell>
        <View style={[layout.content, layout.section]}>
          {query.isLoading ? (
            <ActivityIndicator accessibilityLabel="Loading profile" />
          ) : (
            <>
              <Text accessibilityRole="alert" style={layout.text}>
                Couldn’t load this profile.
              </Text>
              <Button
                onPress={() => {
                  void Promise.allSettled([query.mutate(), roomDetails.mutate()]);
                }}
              >
                Try again
              </Button>
              <Button onPress={() => navigation.home()}>Back to Home</Button>
            </>
          )}
        </View>
      </ViewportShell>
    );
  const content = (
    <PageScrollView contentContainerStyle={styles.content}>
      <MemberProfileHeader
        username={profile.displayUsername}
        profileLine={profile.profileLine}
        avatarUrl={profile.displayAvatarUrl ?? profile.avatarUrl}
        isCurrentUser={profile.isCurrentUser}
        onEdit={() => navigation.destination("/app/profile")}
      />
      {!!profile.introductionOverview && (
        <Button
          emphasis="outline"
          onPress={() =>
            navigation.destination(`${profilePath}/introductions`)
          }
        >
          {profile.introductionOverview.count} introductions
          {profile.introductionOverview.unseenCount
            ? ` · ${profile.introductionOverview.unseenCount} new`
            : ""}
        </Button>
      )}
      {!profile.isCurrentUser &&
        profile.userId &&
        profile.roomId &&
        roomDetails.data?.access?.kind === "member" && (
          <IntroducePerson
            onCreated={() => {
              void query.mutate().catch(() => {});
            }}
            room={profile.roomId}
            user={profile.userId}
            viewer={profile.viewerUserId}
            name={profile.displayUsername}
          />
        )}
      {!!profile.projects.length && (
        <View style={styles.group}>
          <Text accessibilityRole="header" style={layout.text}>
            Projects
          </Text>
          {profile.projects.map((project) => (
            <Button
              key={project.id}
              emphasis="outline"
              onPress={() =>
                navigation.destination(`/app/projects/${project.id}`)
              }
            >
              <ProjectIcon
                name={project.name}
                imageUrl={
                  project.viewer_participation === "pending"
                    ? undefined
                    : project.icon_url
                }
                symbol={project.icon_symbol}
                themeColor={project.icon_color}
              />
              <Text style={layout.text}>{project.name}</Text>
              {project.viewer_participation === "pending" && (
                <Text style={layout.muted}>Invited</Text>
              )}
            </Button>
          ))}
        </View>
      )}
      {entries.map((entry) => (
        <View key={entry.id} style={styles.card}>
          <Button
            emphasis="bare"
            style={styles.entry}
            accessibilityLabel={`Open shared work${entry.createdAt ? ` from ${new Date(entry.createdAt).toLocaleDateString()}` : ""}`}
            onPress={() => navigation.destination(`/app/entries/${entry.id}`)}
          >
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <EntryContent
                interactive={false}
                preview
                entry={{
                  content: entry.content,
                  format: entry.format ?? "mixed_media",
                  format_data: entry.formatData ?? null,
                }}
              />
            </View>
          </Button>
          {!!entry.replyCount && (
            <Text style={layout.muted}>{entry.replyCount} replies</Text>
          )}
        </View>
      ))}
      {!entries.length && <Text style={layout.muted}>Nothing shared yet.</Text>}
      {query.error && (
        <Text accessibilityRole="alert" style={layout.text}>
          Couldn’t load more shared work.
        </Text>
      )}
      {hasMore && (
        <Button
          disabled={query.isValidating}
          onPress={() => {
            void query.setSize(query.size + 1).catch(() => {});
          }}
        >
          Load more
        </Button>
      )}
    </PageScrollView>
  );
  return profile.roomId ? (
    <ViewportShell>
      <RoomHeader
        title={roomDetails.data?.name || "Room"}
        avatar={roomDetails.data?.avatar_url}
        backIcon="caretLeft"
        backLabel="Back to room home"
        onBack={() => navigation.ancestor(`/app/rooms/${profile.roomId}`)}
        detailsOpen={false}
        shelfOpen={false}
        hasSides={false}
        detailsRef={null}
        shelfRef={null}
        onDetails={() => navigation.destination(`/app/rooms/${profile.roomId}?panel=details`)}
        onShelf={() => {}}
      />
      {content}
    </ViewportShell>
  ) : (
    <ViewportShell>
      <Button onPress={() => navigation.home()}>Back to Home</Button>
      {content}
    </ViewportShell>
  );
}
function IntroducePerson({
  room,
  user,
  viewer,
  name,
  onCreated,
}: {
  room: string;
  user: string;
  viewer: string;
  name: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState(""),
    [note, setNote] = useState(""),
    [message, setMessage] = useState("");
  const details = useRoomDetails(room, open, "member");
  const members = (details.members.data?.members ?? []).filter(
    (member) =>
      member.user_id &&
      String(member.user_id) !== user &&
      String(member.user_id) !== String(viewer),
  );
  const chosen = members.some((member) => String(member.user_id) === selected)
    ? selected
    : String(members[0]?.user_id ?? "");
  return (
    <View style={styles.group}>
      <Button emphasis="outline" onPress={() => setOpen((value) => !value)}>
        {open ? "Cancel introduction" : `Introduce ${name} and someone else`}
      </Button>
      {open && (
        <>
          {details.members.isLoading ? (
            <ActivityIndicator accessibilityLabel="Loading members" />
          ) : details.members.error ? (
            <Button
              onPress={() => {
                void details.members.mutate().catch(() => {});
              }}
            >
              Retry loading members
            </Button>
          ) : members.length ? (
            <Select
              label={`Introduce ${name} to`}
              value={chosen}
              options={members.map((member) => ({
                value: String(member.user_id),
                label: member.display_username,
              }))}
              onValueChange={setSelected}
            />
          ) : (
            <Text style={layout.muted}>No one else is available.</Text>
          )}
          <Input
            accessibilityLabel="What overlap do you see?"
            placeholder="What overlap do you see?"
            multiline
            maxLength={1000}
            value={note}
            onChangeText={setNote}
          />
          <Button
            disabled={details.action.isMutating || !chosen || !note.trim()}
            onPress={() => {
              setMessage("");
              void details
                .submit({
                  kind: "introduce",
                  users: [Number(user), Number(chosen)],
                  note,
                })
                .then((result) => {
                  setMessage(result.message ?? "Introduction sent.");
                  setOpen(false);
                  setNote("");
                  onCreated();
                })
                .catch((error) =>
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "Couldn’t make this introduction.",
                  ),
                );
            }}
          >
            Make introduction
          </Button>
        </>
      )}
      {!!message && (
        <Text accessibilityRole="alert" style={layout.text}>
          {message}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  content: { paddingTop: 12, gap: 12 },
  group: { gap: 8 },
  card: {
    backgroundColor: tokens.paper,
    borderRadius: 16,
    padding: 12,
    gap: 8,
  },
  entry: { alignItems: "stretch" },
});
