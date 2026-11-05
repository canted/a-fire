import { PageScrollView } from "../../components/PageScrollView";
import { InstallAppButton } from "../pwa/Installation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { Icon } from "../../components/Icon";
import { RoomIcon } from "../../components/RoomIcon";
import { AppImage } from "../../components/AppImage";
import { ViewportShell } from "../../components/ViewportShell";
import { AuthorStripe } from "../rooms/MessageGroup";
import { useProfiles } from "../../hooks/useProfiles";
import { useAuthentication } from "../../hooks/useSession";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { useDraftNavigation } from "../../hooks/useDraftNavigation";
import { assertImageFile } from "../../lib/imageFile";
import { pickChatFile, releaseChatFile } from "../../lib/chatFiles";
import type { ChatAttachment } from "../../lib/chatComposition";
import type { Identity, Membership } from "../../lib/api/profile";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";

export function ProfilesScreen() {
  const profiles = useProfiles();
  const { logout } = useAuthentication();
  const navigation = useRoomNavigation();
  const [error, setError] = useState<string>();
  const [dirty, setDirty] = useState(new Set<string>());
  useEffect(() => {
    if (dirty.size === 0) setError(undefined);
  }, [dirty.size]);
  const markDirty = useCallback(
    (id: string, value: boolean) =>
      setDirty((previous) => {
        if (previous.has(id) === value) return previous;
        const next = new Set(previous);
        if (value) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );
  useDraftNavigation({
    dirty: dirty.size > 0,
    busy: profiles.busy,
    busyMessage: "Wait for your profile to finish saving.",
    save: async () => {
      if (dirty.size)
        throw new Error("Save or discard your profile edits before leaving.");
    },
    onError: setError,
  });
  const data = profiles.query.data;
  const changeStatus = async (membership: Membership) => {
    setError(undefined);
    try {
      await profiles.submit({
        kind: membership.disabled ? "enable" : "disable",
        id: membership.id,
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not update your membership. Try again.",
      );
    }
  };
  return (
    <ViewportShell>
      <View style={[layout.content, styles.header]}>
        <Button
          size="icon"
          emphasis="bare"
          accessibilityLabel="Back to Home"
          onPress={() => navigation.home()}
        >
          <Icon name="caretCircleLeft" size={28} />
        </Button>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          ellipsizeMode="tail"
          style={layout.appBarTitle}
        >
          Profiles
        </Text>
      </View>
      <PageScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[layout.section]}
      >
        <Text style={layout.muted}>
          Set your default and room-specific identity.
        </Text>
        <InstallAppButton />
        <Button emphasis="link" onPress={() => navigation.destination("/app/agent-connections")}>Agent connections</Button>
        <Button
          emphasis="link"
          onPress={() =>
            navigation.destination("/app/notification-preferences")
          }
        >
          Notification preferences
        </Button>
        <Button
          emphasis="link"
          disabled={dirty.size > 0 || profiles.busy || logout.isMutating}
          onPress={() => {
            setError(undefined);
            void logout
              .trigger()
              .catch(() => setError("Could not sign out. Please try again."));
          }}
        >
          {logout.isMutating ? "Signing out…" : "Sign out"}
        </Button>
        {dirty.size > 0 && (
          <Text style={layout.muted}>
            Save or discard your profile edits before signing out.
          </Text>
        )}
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        {profiles.query.isLoading && (
          <ActivityIndicator accessibilityLabel="Loading profiles" />
        )}
        {profiles.query.error && (
          <View style={layout.section}>
            <Text accessibilityRole="alert" style={layout.text}>
              Could not load your profiles.
            </Text>
            <Button
              onPress={() => {
                void profiles.query.mutate().catch(() => {});
              }}
            >
              Try again
            </Button>
          </View>
        )}
        {data && (
          <>
            <Text accessibilityRole="header" style={styles.heading}>
              Default profile
            </Text>
            <IdentityForm
              identity={data.user}
              profiles={profiles}
              onDirty={markDirty}
            />
            <Text accessibilityRole="header" style={styles.heading}>
              Active memberships
            </Text>
            {data.memberships
              .filter((item) => !item.disabled)
              .map((membership) => (
                <IdentityForm
                  key={membership.id}
                  identity={data.user}
                  membership={membership}
                  profiles={profiles}
                  onDirty={markDirty}
                  onLeave={() => {
                    void changeStatus(membership);
                  }}
                />
              ))}
            {!data.memberships.some((item) => !item.disabled) && (
              <Text style={layout.muted}>No active memberships yet.</Text>
            )}
            <Text accessibilityRole="header" style={styles.heading}>
              Disabled memberships
            </Text>
            {data.memberships
              .filter((item) => item.disabled)
              .map((membership) => (
                <View key={membership.id} style={layout.row}>
                  <Text style={[layout.text, layout.grow]}>
                    {membership.room.name || "Room"}
                  </Text>
                  <Button
                    size="sm"
                    emphasis="outline"
                    disabled={profiles.busy || dirty.size > 0}
                    onPress={() => {
                      void changeStatus(membership);
                    }}
                  >
                    Re-enable
                  </Button>
                </View>
              ))}
            {!data.memberships.some((item) => item.disabled) && (
              <Text style={layout.muted}>
                You have not left any rooms.
              </Text>
            )}
          </>
        )}
      </PageScrollView>
    </ViewportShell>
  );
}

export function ProfileOnboardingScreen() {
  const { roomId, roomId: contextRoomId } = useLocalSearchParams<{
    roomId?: string;
  }>();
  const profiles = useProfiles();
  const router = useRouter();
  const navigation = useRoomNavigation();
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const markDirty = useCallback(
    (_id: string, value: boolean) => setDirty(value),
    [],
  );
  const guard = useDraftNavigation({
    dirty,
    busy: profiles.busy,
    save: async () => {
      if (dirty)
        throw new Error("Save or discard your profile edits before leaving.");
    },
    onError: setError,
  });
  const data = profiles.query.data;
  const membership = roomId
    ? data?.memberships.find(
        (item) => String(item.room.id) === roomId && !item.disabled,
      )
    : undefined;
  const done = () => {
    guard.release();
    router.replace(
      roomId
        ? `/app/rooms/${roomId}`
        : contextRoomId && /^[1-9]\d*$/.test(contextRoomId)
          ? `/app/rooms/${contextRoomId}/profile`
          : "/app/profile",
    );
  };
  return (
    <ViewportShell>
      <PageScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[layout.section]}
      >
        <Text accessibilityRole="header" style={layout.title}>
          {roomId
            ? membership?.room.name || "Room appearance"
            : "Set up your account"}
        </Text>
        <Text style={layout.muted}>
          {roomId
            ? "Use your current identity or customize it for this room."
            : "Pick a display name and stripe image. You can customize them per room later."}
        </Text>
        {profiles.query.isLoading && (
          <ActivityIndicator accessibilityLabel="Loading your profile" />
        )}
        {profiles.query.error && (
          <Button
            onPress={() => {
              void profiles.query.mutate().catch(() => {});
            }}
          >
            Try loading your profile again
          </Button>
        )}
        {data && (!roomId || membership) && (
          <>
            <IdentityForm
              key={roomId || "default"}
              identity={data.user}
              membership={membership}
              profiles={profiles}
              onDirty={markDirty}
              afterSave={done}
            />
            <Button
              shape="pill"
              disabled={dirty || profiles.busy || !data.user.username}
              onPress={done}
            >
              Continue with current profile
            </Button>
          </>
        )}
        {data && roomId && !membership && (
          <>
            <Text style={layout.text}>
              We could not find your membership for this room.
            </Text>
            <Button onPress={() => navigation.home()}>Go to Home</Button>
          </>
        )}
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </PageScrollView>
    </ViewportShell>
  );
}

function IdentityForm({
  identity,
  membership,
  profiles,
  onDirty,
  onLeave,
  afterSave,
}: {
  identity: Identity;
  membership?: Membership;
  profiles: ReturnType<typeof useProfiles>;
  onDirty: (id: string, value: boolean) => void;
  onLeave?: () => void;
  afterSave?: () => void;
}) {
  const key = membership ? String(membership.id) : "default";
  const storedName = membership
    ? (membership.username_override ?? membership.display_username)
    : identity.username;
  const storedLine = membership
    ? (membership.profile_line_override ?? "")
    : (identity.profile_line ?? "");
  const [baseline, setBaseline] = useState({
    name: storedName,
    line: storedLine,
  });
  const [name, setName] = useState(storedName);
  const [line, setLine] = useState(storedLine);
  const [file, setFile] = useState<ChatAttachment>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const dirty =
    name !== baseline.name || line !== baseline.line || Boolean(file);
  useEffect(() => {
    if (
      !dirty &&
      (baseline.name !== storedName || baseline.line !== storedLine)
    ) {
      setBaseline({ name: storedName, line: storedLine });
      setName(storedName);
      setLine(storedLine);
    }
  }, [dirty, baseline.name, baseline.line, storedName, storedLine]);
  const wide = useWindowDimensions().width >= 620;
  const selected = useRef(file);
  selected.current = file;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      releaseChatFile(selected.current);
    };
  }, []);
  useEffect(() => {
    onDirty(key, dirty);
    return () => onDirty(key, false);
  }, [onDirty, key, dirty]);
  const reset = () => {
    setBaseline({ name: storedName, line: storedLine });
    setName(storedName);
    setLine(storedLine);
    releaseChatFile(file);
    setFile(undefined);
    setError(undefined);
    setSaved(false);
  };
  const choose = async () => {
    let picked: ChatAttachment | undefined;
    setError(undefined);
    setSaved(false);
    try {
      picked = await pickChatFile("photo");
      if (!picked) return;
      assertImageFile(picked);
      if (!mounted.current) {
        releaseChatFile(picked);
        return;
      }
      releaseChatFile(selected.current);
      setFile(picked);
    } catch (reason) {
      releaseChatFile(picked);
      if (mounted.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not select your stripe image.",
        );
    }
  };
  const save = async () => {
    if (profiles.busy || !dirty) return;
    setError(undefined);
    setSaved(false);
    try {
      await profiles.submit(
        membership
          ? {
              kind: "membership",
              id: membership.id,
              fields: { username_override: name, profile_line_override: line },
              avatar: file,
            }
          : {
              kind: "identity",
              fields: { username: name.trim(), profile_line: line },
              avatar: file,
            },
      );
      if (mounted.current) {
        releaseChatFile(file);
        setFile(undefined);
        setName(membership ? name : name.trim());
        setBaseline({ name: membership ? name : name.trim(), line });
        setSaved(true);
        afterSave?.();
      }
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not save. Your edits are retained; try again.",
        );
    }
  };
  const displayName = name.trim() || identity.username;
  const avatarUrl = membership
    ? membership.display_avatar_url || identity.avatar_url
    : identity.avatar_url;
  return (
    <View style={styles.section}>
      {membership && (
        <View style={layout.row}>
          <View style={styles.roomName}>
            <RoomIcon
              name={membership.room.name || "Room"}
              avatarUrl={membership.room.avatar_url}
            />
            <Text style={styles.heading}>
              {membership.room.name || "Room"}
            </Text>
          </View>
          {onLeave && (
            <Button
              emphasis="link"
              disabled={profiles.busy || dirty}
              onPress={onLeave}
            >
              Leave
            </Button>
          )}
        </View>
      )}
      <View style={[styles.formRow, wide && styles.wide]}>
        <View style={styles.fields}>
          <Text style={layout.text}>Display name</Text>
          <Input
            accessibilityLabel={
              membership
                ? `${membership.room.name || "Room"} display name`
                : "Default display name"
            }
            value={name}
            onChangeText={(value) => {
              setName(value);
              setSaved(false);
            }}
            editable={!profiles.busy}
            onSubmitEditing={() => {
              void save();
            }}
          />
          <Text style={layout.text}>Profile line</Text>
          <Input
            accessibilityLabel={
              membership
                ? `${membership.room.name || "Room"} profile line`
                : "Default profile line"
            }
            value={line}
            maxLength={160}
            placeholder={
              identity.profile_line || "Music, composition, and sound"
            }
            onChangeText={(value) => {
              setLine(value);
              setSaved(false);
            }}
            editable={!profiles.busy}
            onSubmitEditing={() => {
              void save();
            }}
          />
          {membership && (
            <Text style={layout.muted}>
              Leave blank to use your default profile line.
            </Text>
          )}
          <Button
            emphasis="link"
            disabled={profiles.busy}
            onPress={() => {
              void choose();
            }}
          >
            Change stripe image
          </Button>
          {file && <Text style={layout.muted}>{file.name}</Text>}
          {dirty && (
            <View style={styles.actions}>
              <Button
                size="sm"
                emphasis="ghost"
                disabled={profiles.busy}
                onPress={reset}
              >
                Discard changes
              </Button>
              <Button
                size="sm"
                emphasis="outline"
                disabled={profiles.busy || (!membership && !name.trim())}
                onPress={() => {
                  void save();
                }}
              >
                {profiles.busy ? "Saving…" : "Save"}
              </Button>
            </View>
          )}
          {error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          {saved && (
            <Text accessibilityLiveRegion="polite" style={layout.muted}>
              Saved.
            </Text>
          )}
        </View>
        <View
          style={styles.preview}
          accessibilityLabel={`${displayName} profile preview`}
        >
          {file ? (
            <View style={styles.localStripe}>
              <AppImage
                src=""
                localPreview={file}
                alt="Selected stripe preview"
                tiled
              />
            </View>
          ) : (
            <AuthorStripe name={displayName} avatarUrl={avatarUrl} />
          )}
          <View style={styles.previewText}>
            <Text style={styles.previewName}>{displayName}</Text>
            <Text style={layout.muted}>
              {line || (membership ? identity.profile_line : "")}
            </Text>
            <Text style={layout.text}>
              Lorem ipsum dolor sit amet, consectetur.
            </Text>
            <Text style={layout.text}>
              Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
  },
  heading: {
    fontFamily: "PoppinsSemibold",
    fontSize: 16,
    color: tokens.ink,
    flexShrink: 1,
  },
  section: { gap: 12, marginBottom: 20 },
  formRow: { gap: 12 },
  wide: { flexDirection: "row", alignItems: "flex-start", maxWidth: 460 },
  fields: { flex: 1, gap: 8, minWidth: 0 },
  roomName: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    flexWrap: "wrap",
  },
  preview: {
    width: 136,
    height: 136,
    overflow: "hidden",
    flexDirection: "row",
    gap: 8,
    padding: 4,
    borderRadius: 16,
    backgroundColor: tokens.paper,
  },
  previewText: { flex: 1, padding: 2, gap: 4 },
  previewName: { fontFamily: "BarlowCondensedBold", color: tokens.ink, fontSize: 14 },
  localStripe: { width: 20, borderRadius: 10, overflow: "hidden" },
  error: { ...layout.text, color: tokens.danger },
});
