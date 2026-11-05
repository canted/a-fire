import { UserAvatar } from "../../components/UserAvatar";
import { UserIdentityName } from "../../components/UserIdentity";
import { plainTextFromTiptap } from "../../lib/tiptap";
import { View } from "react-native";
import { materialDocument } from "../../lib/materialDocument";
import {
  contributionCalendar,
  activityDarknessScale,
} from "../../lib/homeModel";
import {
  projectIdentity,
  projectColors,
} from "../../../../types/project-identity";
import { Button } from "../../components/Button";
import { useRoomNavigation } from "../../hooks/useRoomNavigation";
import { DocumentMedia } from "../content/DocumentMedia";
import { ProjectIcon } from "../projects/ProjectIcon";
import { tokens } from "../../styles/tokens";
import type { HomeProjectTilesProps } from "./HomeProjectTiles";
import mosaic from "../../styles/mediaMosaic.module.css";
import styles from "./HomeProjectTiles.module.css";

/** Browser-only grid reuses the legacy mosaic placements, not another layout algorithm. */
export function HomeProjectTiles({ data, entries, onOpenEntry, replyTreatment = "ribbon" }: HomeProjectTilesProps) {
  const navigation = useRoomNavigation();
  const darkness = activityDarknessScale(data?.today ?? "", data?.contributions ?? []);
  return (
    <div className={styles.frame}>
      <div className={`${mosaic.grid} ${styles.tiles}`}>
        {entries.map(({ project, entry }) => {
          const reply = entry.kind === "feedback" && replyTreatment;
          const author = entry.source_author_name || entry.author.username;
          const node = materialDocument(entry).content?.find((item) =>
            ["image", "audio", "video"].includes(item.type),
          );
          const color = projectColors.includes(
            project.icon_color as (typeof projectColors)[number],
          )
            ? (project.icon_color as (typeof projectColors)[number])
            : projectIdentity(project.name).color;
          return (
            <div
              key={entry.id}
              className={`${styles.tile} ${reply ? `${styles.reply} ${styles[reply]} ${node ? styles.mediaReply : styles.textReply}` : ""}`}
              style={{ backgroundColor: node || reply ? tokens.paper : tokens[color] }}
            >
              <Button
                emphasis="bare"
                accessibilityLabel={reply ? `Read ${author}’s reply in ${project.name}` : `Open ${project.name}`}
                style={fill}
                onPress={() =>
                  onOpenEntry ? onOpenEntry({ project, entry }) : navigation.destination(
                    `/app/projects/${project.id}/entries/${entry.id}`,
                  )
                }
              >
                <View />
              </Button>
              {reply && <div className={styles.replyAuthor}>
                <UserAvatar username={author} size={12} />
                <UserIdentityName username={author} compact style={replyTreatment === "ribbon" ? replyStripName : replyName} />
              </div>}
              {node ? (
                <div className={styles.media}>
                  <DocumentMedia node={node} tiled previewOnly={Boolean(onOpenEntry)} />
                </div>
              ) : (
                <div className={styles.writing}>
                  <span>{reply ? plainTextFromTiptap(entry.content) || "Shared media" : entry.question || entry.intent || project.name}</span>
                </div>
              )}
              <div className={styles.identity}>
                <ProjectIcon
                  name={project.name}
                  imageUrl={project.icon_url}
                  symbol={project.icon_symbol}
                  themeColor={project.icon_color}
                  color={node ? undefined : tokens.ink}
                  size={20}
                />
              </div>
            </div>
          );
        })}
        {data && <div className={styles.tile}>
          <Button
            emphasis="bare"
            accessibilityLabel="View your project activity"
            style={fill}
            onPress={() => navigation.destination("/app/activity")}
          >
            <View />
          </Button>
          <div className={styles.calendar} aria-hidden="true">
            {contributionCalendar(data.today, data.contributions, 7).map(
              (day) => (
                <span
                  key={day.date}
                  style={{
                    visibility: day.future ? "hidden" : undefined,
                    backgroundColor: day.count
                      ? `color-mix(in srgb, ${tokens.ink} ${darkness(day.count)}, transparent)`
                      : tokens.surfaceMuted,
                  }}
                />
              ),
            )}
          </div>
        </div>}
      </div>
    </div>
  );
}
const fill = {
  position: "absolute" as const,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  width: "100%" as const,
  height: "100%" as const,
  minHeight: 0,
  paddingHorizontal: 0,
  paddingVertical: 0,
  borderRadius: 0,
};

const replyName = { fontSize: 12, lineHeight: 15, fontFamily: "BarlowCondensedSemibold" };

const replyStripName = { ...replyName, fontSize: 14, lineHeight: 17 };
