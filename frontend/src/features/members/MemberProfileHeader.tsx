import { StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { UserAvatar } from "../../components/UserAvatar";
import { tokens } from "../../styles/tokens";
import { layout } from "../../styles/layout";
export function MemberProfileHeader({
  username,
  profileLine,
  avatarUrl,
  isCurrentUser,
  onEdit,
}: {
  username: string;
  profileLine?: string | null;
  avatarUrl?: string | null;
  isCurrentUser?: boolean;
  onEdit: () => void;
}) {
  return (
    <View style={styles.header}>
      <UserAvatar username={username} avatarUrl={avatarUrl} size={32} />
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={styles.name}>
          {username}
        </Text>
        {!!profileLine && <Text style={layout.muted}>{profileLine}</Text>}
      </View>
      {isCurrentUser && (
        <Button
          emphasis="bare"
          shape="pill"
          size="sm"
          style={styles.edit}
          onPress={onEdit}
        >
          Edit profile
        </Button>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    minHeight: 44,
    gap: 8,
    alignItems: "center",
  },
  copy: { flex: 1, minWidth: 0, justifyContent: "center", gap: 2 },
  name: { fontFamily: "BarlowCondensedBold", fontSize: 24, color: tokens.ink },
  edit: {
    alignSelf: "flex-start",
    backgroundColor: tokens.surface,
    paddingHorizontal: 11,
  },
});
