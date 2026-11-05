import { Redirect, useLocalSearchParams, usePathname } from "expo-router";
import { Text, View } from "react-native";
import { Button } from "../../components/Button";
import { ViewportShell } from "../../components/ViewportShell";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { expoRouteAlias } from "../../lib/expoRouteAlias";
import { layout } from "../../styles/layout";
export function LegacyRouteScreen() {
  const path = usePathname();
  const params = useLocalSearchParams();
  const navigation = useRoomNavigation();
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (key !== "legacy" && key !== "#" && typeof value === "string")
      search.set(key, value);
  const destination = expoRouteAlias(
    path +
      (search.size ? `?${search}` : "") +
      (typeof params["#"] === "string" ? `#${params["#"]}` : ""),
  );
  if (destination) return <Redirect href={destination} />;
  return (
    <ViewportShell>
      <View style={[layout.content, layout.section]}>
        <Text accessibilityRole="header" style={layout.title}>
          Page not found
        </Text>
        <Text style={layout.text}>
          This link does not have an available destination.
        </Text>
        <Button onPress={() => navigation.home()}>Back to Home</Button>
      </View>
    </ViewportShell>
  );
}
