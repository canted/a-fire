import { useMemo, useState } from "react";
import {
  Image,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SvgXml } from "react-native-svg";
import pattern from "../lib/patternGenerator";
import { tokens } from "../styles/tokens";
import { useIdentityImage } from "../hooks/useIdentityImage";
export function RoomIcon({
  name,
  size = 24,
  avatarUrl,
  style,
}: {
  name: string;
  size?: number;
  avatarUrl?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const xml = useMemo(
    () =>
      pattern(name.trim() || "Room", { width: 20, height: 180 }).replaceAll(
        'width="100%" height="100%"',
        'width="100" height="100"',
      ),
    [name],
  );
  const uploaded = useIdentityImage(avatarUrl);
  const [failed, setFailed] = useState<string>();
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: tokens.radius,
          overflow: "hidden",
        },
        style,
      ]}
      accessibilityLabel={`${name} room`}
    >
      {uploaded && failed !== uploaded.uri ? (
        <Image
          source={uploaded}
          style={[StyleSheet.absoluteFill, { width: "100%", height: "100%" }]}
          onError={() => setFailed(uploaded.uri)}
        />
      ) : (
        <SvgXml
          xml={xml}
          width="100%"
          height="100%"
          viewBox="44.4444 0 11.1111 11.1111"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden={true}
        />
      )}
    </View>
  );
}
