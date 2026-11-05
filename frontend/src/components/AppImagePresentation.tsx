import {
  Image,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from "react-native";
import { Button } from "./Button";
import { tokens } from "../styles/tokens";
import { layout } from "../styles/layout";

/** Presentation half of AppImage; source authorization stays with its caller. */
export function AppImagePresentation({
  source,
  alt,
  ratio = 1,
  tiled,
  failed,
  onError,
  retry,
}: {
  source?: ImageSourcePropType;
  alt: string;
  ratio?: number;
  tiled?: boolean;
  failed?: boolean;
  onError: () => void;
  retry?: () => void;
}) {
  return (
    <View
      style={[
        styles.frame,
        tiled ? { height: "100%", borderRadius: 4 } : { aspectRatio: ratio },
      ]}
    >
      {source && !failed ? (
        <Image
          source={source}
          accessibilityLabel={alt}
          resizeMode={tiled ? "cover" : "contain"}
          style={StyleSheet.absoluteFill}
          onError={onError}
        />
      ) : (
        <Text style={layout.text}>
          {failed ? "Image unavailable" : "Loading image…"}
        </Text>
      )}
      {failed && retry && (
        <Button emphasis="link" onPress={retry}>
          Retry image
        </Button>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  frame: {
    width: "100%",
    backgroundColor: tokens.surface,
    overflow: "hidden",
    borderRadius: 16,
  },
});
