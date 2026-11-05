import { PageScrollView } from "../../components/PageScrollView";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { PopupMenu } from "../../components/PopupMenu";
import { ViewportShell } from "../../components/ViewportShell";
import { useHome } from "../../hooks/useHome";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import {
  activityDarknessScale,
  contributionCalendar,
  type HomeSnapshot,
} from "../../lib/homeModel";
import { layout } from "../../styles/layout";
import { tokens } from "../../styles/tokens";
const label = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
const cellColor = (count: number, darkness: (count: number) => string) =>
  count
    ? `${tokens.ink}${Math.round(parseFloat(darkness(count)) * 2.55)
        .toString(16)
        .padStart(2, "0")}`
    : tokens.surfaceMuted;
export function ActivityPreview({ data }: { data: HomeSnapshot }) {
  const darkness = activityDarknessScale(data.today, data.contributions);
  return (
    <View
      style={styles.preview}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {contributionCalendar(data.today, data.contributions, 7).map((day) => (
        <View
          key={day.date}
          style={[
            styles.previewCell,
            {
              backgroundColor: cellColor(day.count, darkness),
              opacity: day.future ? 0 : 1,
            },
          ]}
        />
      ))}
    </View>
  );
}
export function ActivityScreen() {
  const query = useHome();
  const navigation = useRoomNavigation();
  const [selected, setSelected] = useState<{ date: string; count: number }>();
  const data = !query.error ? query.data : undefined;
  const days = data?.today
    ? contributionCalendar(data.today, data.contributions, 53)
    : [];
  const darkness = activityDarknessScale(
    data?.today || "",
    data?.contributions || [],
  );
  return (
    <ViewportShell>
      <View style={[layout.content, layout.row]}>
        <Button
          size="icon"
          emphasis="bare"
          accessibilityLabel="Back to Home"
          onPress={() => navigation.home()}
        >
          <Icon name="caretCircleLeft" size={28} />
        </Button>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          ellipsizeMode="tail"
          style={layout.appBarTitle}
        >
          Project activity
        </Text>
      </View>
      <PageScrollView contentContainerStyle={[layout.section]}>
        {query.isLoading && (
          <ActivityIndicator accessibilityLabel="Loading your project activity" />
        )}
        {query.error && (
          <>
            <Text accessibilityRole="alert" style={layout.text}>
              Couldn’t load your project activity.
            </Text>
            <Button
              onPress={() => {
                void query.mutate().catch(() => {});
              }}
            >
              Try again
            </Button>
          </>
        )}
        {data && (
          <View style={styles.report}>
            <View style={styles.week}>
              <View style={styles.date} />
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                <Text key={day} style={[styles.weekday, styles.cell]}>
                  {day}
                </Text>
              ))}
            </View>
            {Array.from({ length: 53 }, (_, index) =>
              days.slice((52 - index) * 7, (53 - index) * 7),
            ).map((week) => (
              <View style={styles.week} key={week[0]?.date}>
                <Text style={styles.date}>
                  {week.some((day) => day.date.endsWith("-01"))
                    ? new Date(
                        `${week.find((day) => day.date.endsWith("-01"))!.date}T12:00:00Z`,
                      ).toLocaleDateString(undefined, {
                        month: "short",
                        timeZone: "UTC",
                      })
                    : ""}
                </Text>
                {week.map((day) =>
                  day.future ? (
                    <View key={day.date} style={styles.cell} />
                  ) : (
                    <Button
                      key={day.date}
                      emphasis="bare"
                      style={[
                        styles.cell,
                        styles.day,
                        { backgroundColor: cellColor(day.count, darkness) },
                      ]}
                      accessibilityLabel={`${label(day.date)}: ${day.count} ${day.count === 1 ? "entry" : "entries"}`}
                      onPress={() => setSelected(day)}
                    >
                      <View />
                    </Button>
                  ),
                )}
              </View>
            ))}
            {!days.some((day) => !day.future && day.count) && (
              <Text style={layout.muted}>
                No entries yet. Your first entry will light up a square here.
              </Text>
            )}
          </View>
        )}
      </PageScrollView>
      <PopupMenu
        mode="dialog"
        open={Boolean(selected)}
        title="Daily project activity"
        actions={[]}
        onClose={() => setSelected(undefined)}
      >
        {selected && (
          <View style={styles.popup}>
            <Text style={layout.text}>{label(selected.date)}</Text>
            <Text style={layout.text}>
              {selected.count} {selected.count === 1 ? "entry" : "entries"}
            </Text>
          </View>
        )}
      </PopupMenu>
    </ViewportShell>
  );
}
const styles = StyleSheet.create({
  report: {
    padding: 12,
    gap: 4,
    backgroundColor: tokens.paper,
    borderRadius: tokens.radius,
  },
  week: { flexDirection: "row", gap: 4, alignItems: "center" },
  date: { width: 32, fontFamily: "Lato", fontSize: 10, color: tokens.muted },
  weekday: {
    fontFamily: "Lato",
    fontSize: 10,
    color: tokens.muted,
    textAlign: "center",
  },
  cell: { flex: 1, minWidth: 0 },
  day: {
    aspectRatio: 1,
    minHeight: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  popup: { padding: 16, gap: 8 },
  preview: {
    flexDirection: "column",
    flexWrap: "wrap",
    height: 112,
    width: 112,
    gap: 2,
  },
  previewCell: { height: 14, width: 14, borderRadius: 2 },
});
