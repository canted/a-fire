import { StyleSheet, View } from "react-native";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";

/** Same paired-member geometry as the Room surface, without fabricated content. */
export function RoomLoading() {
  return <View accessibilityLabel="Loading Room" accessibilityRole="progressbar" style={[layout.content, styles.root]}>
    <View style={styles.round} />
    <View style={styles.row}>
      {[0, 1].map(index => <View key={index} style={styles.member}>
        <View style={styles.identity}><View style={styles.avatar} /><View style={styles.name} /></View>
        <View style={styles.media} />
        <View style={styles.line} />
      </View>)}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  root: { paddingTop: 12, gap: 24 },
  round: { height: 48, borderRadius: 8, backgroundColor: tokens.paper },
  row: { flexDirection: "row", gap: 12 },
  member: { flex: 1, gap: 12 },
  identity: { flexDirection: "row", alignItems: "center", gap: 8 },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: tokens.paper },
  name: { width: "55%", height: 12, borderRadius: 4, backgroundColor: tokens.paper },
  media: { aspectRatio: 1, borderRadius: 16, backgroundColor: tokens.paper },
  line: { width: "70%", height: 12, borderRadius: 4, backgroundColor: tokens.paper },
});
