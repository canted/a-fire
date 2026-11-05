import { Text, View } from "react-native";
import { Button } from "../../components/Button";
import { useNotePreview } from "../../hooks/useNotePreview";
import { useContentLink } from "../../hooks/useContentLink";
import { appRoutes } from "../../lib/appRoutes";
import { layout } from "../../styles/layout";

export function NoteLink({
  id,
  interactive = true,
}: {
  id: unknown;
  interactive?: boolean;
}) {
  const query = useNotePreview(id);
  const links = useContentLink();
  if (query.error)
    return <Text style={layout.muted}>This note is unavailable.</Text>;
  if (!interactive)
    return (
      <Text style={layout.text}>
        {query.data?.title ||
          (query.isLoading ? "Loading note…" : "Untitled note")}
      </Text>
    );
  return (
    <View>
      <Button
        emphasis="link"
        disabled={!query.data}
        onPress={() => {
          void links.open(appRoutes.page(String(id)));
        }}
      >
        {query.data?.title ||
          (query.isLoading ? "Loading note…" : "Untitled note")}
      </Button>
      {links.error && (
        <Text accessibilityRole="alert" style={layout.text}>
          {links.error}
        </Text>
      )}
    </View>
  );
}
