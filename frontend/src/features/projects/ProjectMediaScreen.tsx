import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { AppImage } from "../../components/AppImage";
import { ViewportShell } from "../../components/ViewportShell";
import { DocumentMedia } from "../content/DocumentMedia";
import { useProjectEntryRead } from "../../hooks/useProjects";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { useRoomOverlayDismiss } from "../../hooks/useRoomOverlayDismiss";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { materialDocument } from "../../lib/materialDocument";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";

export function ProjectMediaScreen() {
  const { projectId, entryId, mediaIndex } = useLocalSearchParams<{
    projectId: string;
    entryId: string;
    mediaIndex: string;
  }>();
  const query = useProjectEntryRead(projectId, entryId);
  const navigation = useRoomNavigation();
  const close = () =>
    navigation.returnTo(`/app/projects/${projectId}/entries/${entryId}`);
  useRoomOverlayDismiss(true, close);
  const reduced = useReducedMotion();
  const viewport = useWindowDimensions();
  const [width, setWidth] = useState(viewport.width);
  const [active, setActive] = useState(0);
  const track = useRef<ScrollView>(null);
  const entry = !query.error
    ? query.data
    : undefined;
  const media = entry
    ? materialDocument(entry).content?.filter((node) =>
        ["image", "audio", "video"].includes(node.type),
      ) || []
    : [];
  const initial = Math.max(
    0,
    Math.min(Number(mediaIndex) || 0, media.length - 1),
  );
  useEffect(() => {
    setActive(initial);
    track.current?.scrollTo({ x: initial * width, animated: false });
  }, [initial, width, entry?.id]);
  const show = (index: number) => {
    const next = Math.max(0, Math.min(index, media.length - 1));
    setActive(next);
    track.current?.scrollTo({ x: next * width, animated: !reduced });
  };
  const content = (
    <ViewportShell suppressAudioPlayer surface={tokens.paper}>
      <View style={[layout.content, layout.appBar]}>
        <Button
          size="icon"
          emphasis="bare"
          accessibilityLabel="Close media viewer"
          onPress={close}
        >
          <Icon name="x" size={24} />
        </Button>

      </View>
      {query.isLoading ? (
        <ActivityIndicator accessibilityLabel="Loading media" />
      ) : !entry ? (
        <View style={[layout.content, layout.section]}>
          <Text accessibilityRole="alert" style={layout.text}>
            This entry is unavailable.
          </Text>
          <Button
            onPress={() => {
              void query.mutate().catch(() => {});
            }}
          >
            Try again
          </Button>
        </View>
      ) : !media.length ? (
        <Text style={[layout.content, layout.muted]}>
          This entry has no media.
        </Text>
      ) : (
        <>
          <ScrollView
            ref={track}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={layout.grow}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            onScroll={(event) => {
              if (width)
                setActive(
                  Math.max(
                    0,
                    Math.min(
                      media.length - 1,
                      Math.round(event.nativeEvent.contentOffset.x / width),
                    ),
                  ),
                );
            }}
            scrollEventThrottle={32}
            accessibilityLabel="Media viewer"
          >
            {media.map((node, index) => {
              const ratio =
                Number(node.attrs?.width) > 0 && Number(node.attrs?.height) > 0
                  ? Number(node.attrs?.width) / Number(node.attrs?.height)
                  : 1;
              const imageWidth = Math.min(
                width - 32,
                720,
                viewport.height * 0.65 * ratio,
              );
              return (
                <View key={index} style={[styles.slide, { width }]}>
                  <View
                    style={[
                      styles.media,
                      node.type === "image"
                        ? { width: imageWidth }
                        : { width: Math.min(width - 32, 720) },
                    ]}
                  >
                    {node.type === "image" ? (
                      <AppImage
                        src={String(node.attrs?.src || "")}
                        alt={String(node.attrs?.alt || "Entry image")}
                        width={Number(node.attrs?.width) || undefined}
                        height={Number(node.attrs?.height) || undefined}
                      />
                    ) : (
                      <DocumentMedia node={node} expanded />
                    )}
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <Text style={styles.date}>
            {new Date(entry.created_at).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </Text>
          <View style={styles.controls}>
            <Button
              emphasis="bare"
              accessibilityLabel="Previous media"
              disabled={active === 0}
              onPress={() => show(active - 1)}
            >
              <Icon name="caretLeft" size={20} />
            </Button>
            {media.map((node, index) => (
              <Button
                key={index}
                emphasis="bare"
                accessibilityLabel={`Show ${node.type} ${index + 1}`}
                selected={active === index}
                style={styles.dotTarget}
                onPress={() => show(index)}
              >
                <View
                  style={[styles.dot, active === index && styles.selected]}
                />
              </Button>
            ))}
            <Button
              emphasis="bare"
              accessibilityLabel="Next media"
              disabled={active >= media.length - 1}
              onPress={() => show(active + 1)}
            >
              <Icon name="caretRight" size={20} />
            </Button>
          </View>
        </>
      )}
    </ViewportShell>
  );
  return Platform.OS === "web" ? (
    <Modal visible transparent onRequestClose={close}>{content}</Modal>
  ) : content;
}
const styles = StyleSheet.create({
  slide: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  media: { maxWidth: 720 },
  date: {
    fontFamily: "Lato",
    fontSize: 14,
    color: tokens.muted,
    textAlign: "center",
    padding: 12,
  },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    paddingBottom: 12,
  },
  dotTarget: { width: 44, padding: 0 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: tokens.muted,
    opacity: 0.35,
  },
  selected: { backgroundColor: tokens.ink, opacity: 1 },
});
