import { useMemo, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { SvgXml } from "react-native-svg";
import pattern from "../lib/patternGenerator";
import { useIdentityImage } from "../hooks/useIdentityImage";
import { tokens } from "../styles/tokens";

/** Circular identities use the incumbent uploaded-image / generated-stripe contract. */
export function UserAvatar({
  username,
  avatarUrl,
  size = 24,
}: {
  username: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  const uploaded = useIdentityImage(avatarUrl);
  const [failed, setFailed] = useState<string>();
  const [loaded, setLoaded] = useState<{
    uri: string;
    width: number;
    height: number;
  }>();
  const xml = useMemo(
    () => pattern(username.trim(), { width: 20, height: 180 }),
    [username],
  );
  const source = uploaded && failed !== uploaded.uri ? uploaded : undefined;
  const dimensions = loaded?.uri === source?.uri ? loaded : undefined;
  const scale = dimensions
    ? Math.max(size / dimensions.width, size / dimensions.height)
    : 1;
  const imageWidth = dimensions ? dimensions.width * scale : size;
  const imageHeight = dimensions ? dimensions.height * scale : size;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={username}
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      {source ? (
        <Image
          source={{ ...source, cache: "reload" }}
          style={{
            position: "absolute",
            top: 0,
            left: (size - imageWidth) / 2,
            width: imageWidth,
            height: imageHeight,
            opacity: dimensions ? 1 : 0,
          }}
          resizeMode="stretch"
          onLoad={(event) => {
            const image = event.nativeEvent.source;
            if (image.width > 0 && image.height > 0)
              setLoaded({
                uri: source.uri,
                width: image.width,
                height: image.height,
              });
          }}
          onError={() => setFailed(source.uri)}
        />
      ) : (
        <SvgXml
          style={{ position: "absolute", top: 0, left: 0, flexShrink: 0 }}
          xml={xml}
          width={size}
          height={size * 9}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  avatar: {
    overflow: "hidden",
    backgroundColor: tokens.surface,
    flexShrink: 0,
  },
});
