import { StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { AppImage } from "../../components/AppImage";
import { useLinkPreview } from "../../hooks/useLinkPreview";
import { useContentLink } from "../../hooks/useContentLink";
import { externalPreviewUrl } from "../../lib/linkPreviewDetection";
import { tokens } from "../../styles/tokens";
import { layout } from "../../styles/layout";

/** A reference card; resolving metadata never creates an entry or uploads media. */
export function LinkPreviewCard({ url, compact = false }: { url: string | null; compact?: boolean }) {
  const query = useLinkPreview(url);
  const links = useContentLink();
  const external = externalPreviewUrl(url);
  if (!external) return null;
  const preview = !query.error && query.data?.status === "ready" ? query.data : undefined;
  return <Button emphasis="bare" style={styles.card} onPress={() => void links.open(external)} accessibilityLabel={preview?.title || external}>
    {!compact && preview?.image_url && <View style={styles.image}><AppImage src={preview.image_url} alt="" tiled /></View>}
    <View style={styles.copy}>
      <Text style={layout.muted} numberOfLines={1}>{preview?.site_name || new URL(external).hostname}</Text>
      <Text style={layout.text} numberOfLines={2}>{preview?.title || external}</Text>
      {!compact && preview?.description && <Text style={layout.muted} numberOfLines={2}>{preview.description}</Text>}
      {query.isLoading && <Text style={layout.muted}>Loading preview…</Text>}
    </View>
  </Button>;
}
const styles = StyleSheet.create({
  card: { alignItems: "stretch", backgroundColor: tokens.paper, borderRadius: 12, overflow: "hidden", padding: 0 },
  image: { height: 120 },
  copy: { padding: 10, gap: 4 },
});
