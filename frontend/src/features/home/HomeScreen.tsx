import { homeProjectStyles } from "./homeProjectStyles";
import { PageScrollView } from "../../components/PageScrollView";
import { ProjectIcon } from "../projects/ProjectIcon";
import {
  homeActivityPriorities,
  homeFeaturedTask,
} from "../../lib/homeModel";
import { AppImage } from "../../components/AppImage";
import { HomeProjectTiles } from "./HomeProjectTiles";
import { useContentLink } from "../../hooks/useContentLink";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import {
  ActivityIndicator,
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { ViewportShell } from "../../components/ViewportShell";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { RoomIcon } from "../../components/RoomIcon";
import { useHome } from "../../hooks/useHome";
import { layout } from "../../styles/layout";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { tokens } from "../../styles/tokens";
export function HomeScreen() {
  const home = useHome();
  const { width } = useWindowDimensions();
  const frameWidth = Math.min(width, 760) - 32;
  const tileSize = (frameWidth - 4) / 2;
  const countSize = frameWidth <= 310 ? 16 : frameWidth <= 340 ? 18 : 20.2;
  const metricGap = frameWidth <= 310 ? 2 : frameWidth <= 340 ? 3 : 4;
  const labelSize = frameWidth <= 310 ? 12 : frameWidth <= 340 ? 12.5 : 13.5;
  const iconSize = frameWidth <= 310 ? 14 : frameWidth <= 340 ? 16 : 17;
  const navigation = useRoomNavigation();
  const links = useContentLink();
  const data = home.data;
  const first = data?.recentRooms[0];
  const prioritized = homeActivityPriorities(data?.rounds || []);
  const nextSteps = prioritized
    .filter((item) => item.joined)
    .reduce((sum, item) => sum + item.actions.length, 0);
  const featured = data ? homeFeaturedTask(data) : undefined;
  const entries = (
    data?.recentEntries ||
    data?.recentProjects
      .filter((item) => item.entry)
      .map((item) => ({ ...item, entry: item.entry! })) ||
    []
  ).slice(0, 4);
  const enter = navigation.enter;
  return (
    <ViewportShell>
      <View {...(Platform.OS === "web" ? { dataSet: { roomNavigationReady: "/app" } } : {})} style={[layout.content, styles.appBar]}>
        <Button
          accessibilityLabel="Your profile"
          emphasis="ghost"
          style={styles.profile}
          onPress={() => navigation.destination("/app/profile")}
        >
          <Icon name="userFill" size={28} />
        </Button>
      </View>
      <PageScrollView contentContainerStyle={[styles.content]}>
        {links.error && (
          <Text accessibilityRole="alert" style={layout.text}>
            {links.error}
          </Text>
        )}
        {home.isLoading && (
          <ActivityIndicator accessibilityLabel="Loading your rooms and projects" />
        )}
        {home.error ? (
          <View style={layout.section}>
            <Text accessibilityRole="alert" style={layout.text}>
              Couldn’t load your home screen.
            </Text>
            <Button
              onPress={() => {
                void home.mutate().catch(() => {});
              }}
            >
              Try again
            </Button>
          </View>
        ) : (
          data && (
            <>
              <View style={styles.headingRow}>
                <Text accessibilityRole="header" style={styles.heading}>
                  Rooms
                </Text>
                {first && (
                  <Button
                    accessibilityLabel="New room"
                    emphasis="ghost"
                    style={styles.add}
                    onPress={() => navigation.destination("/app/rooms/new")}
                  >
                    <Icon name="plusBold" size={14} />
                  </Button>
                )}
              </View>
              <View style={styles.frame}>
                <View style={styles.dashboard}>
                  <View
                    style={[
                      styles.stats,
                      {
                        padding:
                          frameWidth <= 310
                            ? 4
                            : frameWidth <= 380
                              ? 8
                              : width < 600
                                ? 12
                                : 16,
                        width: tileSize,
                        height: tileSize,
                      },
                    ]}
                  >
                    <View
                      style={[
                        StyleSheet.absoluteFill,
                        Platform.OS !== "ios" && { filter: "saturate(1.6)" },
                      ]}
                    >
                      <Image
                        source={require("./assets/stats-ripples-dark.webp")}
                        style={[
                          StyleSheet.absoluteFill,
                          { width: "100%", height: "100%" },
                        ]}
                        resizeMode="cover"
                      />
                    </View>
                    {nextSteps > 0 && (
                      <Text style={styles.metricText}>
                        {nextSteps} Next steps
                      </Text>
                    )}
                    {!!data.roomDashboard?.newResponses && (
                      <Text style={styles.metricText}>
                        {data.roomDashboard.newResponses} New responses
                      </Text>
                    )}
                    <View style={[styles.year, { gap: metricGap }]}>
                      <Text style={styles.yearLabel}>THIS YEAR</Text>
                      {(
                        [
                          [
                            "flagBannerFill",
                            data.roomDashboard?.activitiesJoined,
                            "Rounds joined",
                          ],
                          [
                            "chatTeardropFill",
                            data.roomDashboard?.feedbackGiven,
                            "Feedback given",
                          ],
                          [
                            "paperPlaneRightFill",
                            data.roomDashboard?.entriesShared,
                            "Entries shared",
                          ],
                        ] as const
                      ).map(([icon, value, label]) => (
                        <View
                          key={label}
                          style={[
                            styles.metric,
                            {
                              gap: metricGap,
                              minHeight: frameWidth <= 380 ? countSize : 22.4,
                            },
                          ]}
                        >
                          <Icon
                            name={icon}
                            size={iconSize}
                            color={tokens.paper}
                          />
                          <Text
                            style={[
                              styles.count,
                              {
                                fontSize: countSize,
                                lineHeight: countSize,
                                paddingHorizontal: frameWidth <= 380 ? 0 : 3.2,
                              },
                            ]}
                          >
                            {value ?? "—"}
                          </Text>
                          <Text
                            style={[
                              styles.metricText,
                              {
                                fontSize: labelSize,
                                lineHeight: labelSize * 1.15,
                              },
                            ]}
                          >
                            {label}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  {featured ? (
                    <Button
                      emphasis="bare"
                      accessibilityLabel={`${featured.canJoin ? "Join round in " : ""}${featured.name}: ${featured.text}`}
                      style={[
                        styles.taskTile,
                        { width: tileSize, height: tileSize },
                      ]}
                      onPress={() => navigation.destination(featured.href)}
                    >
                      {featured.image && (
                        <View style={StyleSheet.absoluteFill}>
                          <AppImage
                            {...featured.image}
                            tiled
                            interactive={false}
                          />
                        </View>
                      )}
                      <View
                        style={[
                          styles.taskCopy,
                          featured.image && styles.taskImageCopy,
                        ]}
                      >
                        {featured.canJoin && (
                          <Text style={styles.heading}>{featured.title}</Text>
                        )}
                        <View style={styles.taskLine}>
                          {!featured.canJoin && (
                            <Icon name="flagBannerFill" size={14} />
                          )}
                          <Text style={[styles.taskText, { flex: 1 }]}>
                            {featured.text}
                          </Text>
                        </View>
                        {featured.canJoin && (
                          <Text style={styles.taskJoin}>Join round</Text>
                        )}
                      </View>
                      {!featured.canJoin && (
                        <RoomIcon
                          name={featured.name}
                          avatarUrl={featured.avatar}
                          style={styles.taskIdentity}
                        />
                      )}
                    </Button>
                  ) : data.recentFeedback ? (
                    <Button
                      emphasis="bare"
                      style={[
                        styles.taskTile,
                        { width: tileSize, height: tileSize },
                      ]}
                      onPress={() =>
                        navigation.destination(
                          `/app/entries/${data.recentFeedback!.entryId}#reply-${data.recentFeedback!.replyId}`,
                        )
                      }
                    >
                      <Text style={styles.heading}>Feedback on your entry</Text>
                      <Text style={styles.taskText}>
                        {data.recentFeedback.preview}
                      </Text>
                      <Text style={layout.muted}>
                        {data.recentFeedback.roomName}
                      </Text>
                    </Button>
                  ) : (
                    <Button
                      emphasis="ghost"
                      accessibilityLabel={first?.name || "Create a room"}
                      style={[
                        styles.roomTile,
                        { width: tileSize, height: tileSize },
                      ]}
                      onPress={() =>
                        first
                          ? enter(first.id)
                          : navigation.destination("/app/rooms/new")
                      }
                    >
                      {first ? (
                        <>
                          <RoomIcon
                            name={first.name}
                            avatarUrl={first.avatarUrl}
                            style={[
                              StyleSheet.absoluteFill,
                              { width: "100%", height: "100%" },
                            ]}
                          />
                          <Svg
                            style={StyleSheet.absoluteFill}
                            width="100%"
                            height="100%"
                          >
                            <Defs>
                              <LinearGradient
                                id="shade"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                              >
                                <Stop
                                  offset="0"
                                  stopColor="black"
                                  stopOpacity={0.65}
                                />
                                <Stop
                                  offset="1"
                                  stopColor="black"
                                  stopOpacity={0.15}
                                />
                              </LinearGradient>
                            </Defs>
                            <Rect
                              width="100%"
                              height="100%"
                              fill="url(#shade)"
                            />
                          </Svg>
                          <Text style={styles.tileTitle}>{first.name}</Text>
                        </>
                      ) : (
                        <>
                          <Image
                            source={require("./assets/circle-invitation.webp")}
                            style={StyleSheet.absoluteFill}
                          />
                          <Text style={styles.tileTitle}>Create a room</Text>
                        </>
                      )}
                    </Button>
                  )}
                </View>
              </View>
              {first ? (
                <View style={styles.list}>
                  <Button
                    emphasis="ghost"
                    style={styles.listRow}
                    onPress={() => navigation.destination("/app/rooms/all")}
                  >
                    <Icon name="listBullets" />
                    <Text style={[layout.text, layout.grow]}>All rooms</Text>
                    {data.totalRoomUnseenCount > 0 && (
                      <Text
                        accessibilityLabel={`${data.totalRoomUnseenCount} unseen items across your rooms`}
                        style={styles.badge}
                      >
                        {data.totalRoomUnseenCount}
                      </Text>
                    )}
                    <Icon name="caretRight" size={16} />
                  </Button>
                  {data.recentRooms.slice(0, 3).map((room) => (
                    <Button
                      key={room.id}
                      emphasis="ghost"
                      style={styles.listRow}
                      onPress={() => enter(room.id)}
                    >
                      <RoomIcon name={room.name} avatarUrl={room.avatarUrl} />
                      <Text style={[layout.text, layout.grow]}>
                        {room.name}
                      </Text>
                      {room.unseenCount > 0 && (
                        <Text style={styles.badge}>{room.unseenCount}</Text>
                      )}
                      <Icon name="caretRight" size={16} />
                    </Button>
                  ))}
                </View>
              ) : (
                <Text style={styles.hint}>
                  A room is a group of peers to share work in progress and
                  exchange feedback. Invited to one? Open the invitation link to
                  join.
                </Text>
              )}
              <View style={styles.headingRow}>
                <Text accessibilityRole="header" style={styles.heading}>
                  Projects
                </Text>
                <Button
                  emphasis="ghost"
                  accessibilityLabel="New project"
                  style={styles.add}
                  onPress={() => navigation.destination("/app/projects/new")}
                >
                  <Icon name="plusBold" size={14} />
                </Button>
              </View>
              {!!entries.length && (
                <HomeProjectTiles data={data} entries={entries} />
              )}
              {data.recentProjects.length ? (
                <View style={styles.list}>
                  <Button
                    emphasis="ghost"
                    style={styles.listRow}
                    onPress={() => navigation.destination("/app/projects")}
                  >
                    <Icon name="listBullets" />
                    <Text style={[layout.text, layout.grow]}>All projects</Text>
                    <Icon name="caretRight" size={16} />
                  </Button>
                  {data.recentProjects.map(({ project }) => (
                    <Button
                      key={project.id}
                      emphasis="ghost"
                      style={styles.listRow}
                      onPress={() =>
                        navigation.destination(`/app/projects/${project.id}`)
                      }
                    >
                      <ProjectIcon
                        name={project.name}
                        imageUrl={project.icon_url}
                        symbol={project.icon_symbol}
                        themeColor={project.icon_color}
                      />
                      <Text style={[layout.text, layout.grow]}>
                        {project.name}
                      </Text>
                      <Icon name="caretRight" size={16} />
                    </Button>
                  ))}
                </View>
              ) : (
                <>
                  <View style={styles.frame}>
                    <Button
                      emphasis="ghost"
                      style={styles.invitation}
                      onPress={() => void links.open("/app/projects/new")}
                    >
                      <Image
                        source={require("./assets/project-invitation.webp")}
                        style={[
                          styles.invitationImage,
                          { width: tileSize, height: tileSize },
                        ]}
                      />
                      <View style={styles.invitationCopy}>
                        <Text style={styles.invitationTitle}>
                          Create a project
                        </Text>
                      </View>
                      <View style={styles.invitationPlus}>
                        <Icon name="plusBold" size={20} />
                      </View>
                    </Button>
                  </View>
                </>
              )}
            </>
          )
        )}
      </PageScrollView>
    </ViewportShell>
  );
}
const styles = StyleSheet.create({
  taskLine: { flexDirection: "row", alignItems: "flex-start", gap: 3 },
  taskTile: {
    padding: 8,
    backgroundColor: tokens.surface,
    alignItems: "stretch",
    justifyContent: "flex-start",
    overflow: "hidden",
    borderRadius: 4,
  },
  taskCopy: { gap: 6 },
  taskImageCopy: { backgroundColor: tokens.paper, padding: 4 },
  taskText: {
    fontFamily: "Lato",
    fontSize: 14,
    lineHeight: 20,
    color: tokens.ink,
  },
  taskJoin: { fontFamily: "LatoBold", fontSize: 14 },
  taskIdentity: {
    position: "absolute",
    right: 8,
    bottom: 8,
    width: 16,
    height: 16,
  },
  appBar: {
    height: 44,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  profile: { width: 44, marginRight: -10.625, padding: 0 },
  profileMenu: { paddingVertical: 12 },
  content: { paddingTop: 14, paddingBottom: 24 },
  headingRow: homeProjectStyles.headingRow,
  heading: homeProjectStyles.heading,
  add: {
    minHeight: 24,
    width: 24,
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: `${tokens.ink}22`,
    borderRadius: 12,
  },
  frame: {
    padding: 4,
    borderRadius: 20,
    backgroundColor: tokens.paper,
    overflow: "hidden",
  },
  dashboard: {
    flexDirection: "row",
    gap: 4,
    borderRadius: 16,
    overflow: "hidden",
  },
  stats: {
    flexShrink: 0,
    aspectRatio: 1,
    padding: 16,
    overflow: "hidden",
    borderRadius: 4,
  },
  year: { gap: 4, marginTop: "auto" },
  yearLabel: {
    color: tokens.paper,
    fontSize: 12,
    fontFamily: "LatoBold",
    lineHeight: 12,
  },
  metric: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 22.4,
  },
  count: {
    color: tokens.paper,
    fontFamily: "LatoBold",
    fontSize: 20.2,
    lineHeight: 20.2,
    paddingHorizontal: 3.2,
  },
  metricText: {
    color: tokens.paper,
    fontFamily: "Lato",
    fontSize: 13.5,
    lineHeight: 15.5,
    flexShrink: 1,
  },
  roomTile: {
    flexShrink: 0,
    aspectRatio: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: "flex-end",
    alignItems: "flex-start",
    overflow: "hidden",
  },
  tileTitle: {
    color: tokens.paper,
    fontFamily: "BarlowCondensedSemibold",
    fontSize: 20,
    lineHeight: 22,
  },
  list: homeProjectStyles.list,
  listRow: homeProjectStyles.listRow,
  badge: {
    color: tokens.paper,
    backgroundColor: tokens.ink,
    borderRadius: 10,
    paddingHorizontal: 6,
    fontFamily: "Lato",
    fontSize: 12,
  },
  invitationPlus: { position: "absolute", bottom: 12, right: 12 },
  invitation: {
    borderRadius: 16,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 0,
    paddingVertical: 0,
    gap: 4,
  },
  invitationImage: { flexShrink: 0, aspectRatio: 1, borderRadius: 4 },
  invitationCopy: { flex: 1, gap: 6.4, padding: 6.4 },
  invitationTitle: { fontFamily: "BarlowCondensedSemibold", fontSize: 21, lineHeight: 25.2 },
  invitationBody: { fontFamily: "Lato", fontSize: 14, lineHeight: 20.3 },
  hint: {
    fontFamily: "Lato",
    fontSize: 14,
    lineHeight: 21,
    color: tokens.muted,
    marginHorizontal: 8,
    marginTop: 12,
    marginBottom: 20,
  },
});
