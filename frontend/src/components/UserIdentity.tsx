import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { UserAvatar } from "./UserAvatar";
import { tokens } from "../styles/tokens";

/** Shared Wall identity; compact names also accompany feedback stripes. */
export function UserIdentityName({
  username,
  compact = false,
  inline = false,
  style,
}: {
  username: string;
  compact?: boolean;
  inline?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      numberOfLines={inline ? undefined : 1}
      style={[
        styles.name,
        compact && styles.compact,
        !inline && styles.truncated,
        style,
      ]}
    >
      {username}
    </Text>
  );
}
export function UserIdentity({
  username,
  avatarUrl,
  avatarSize = 20.4,
}: {
  username: string;
  avatarUrl?: string | null;
  avatarSize?: number;
}) {
  return (
    <View style={styles.identity}>
      <UserAvatar username={username} avatarUrl={avatarUrl} size={avatarSize} />
      <UserIdentityName username={username} />
    </View>
  );
}
const styles = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  name: { fontFamily: "BarlowCondensedBold", fontSize: 18, color: tokens.ink },
  compact: { fontSize: 16 },
  truncated: { flex: 1, minWidth: 0 },
});
