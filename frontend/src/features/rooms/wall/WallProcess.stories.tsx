import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { WallProcessPreview, type WallTreatment } from "./WallProcessPreview";
import type { WallProcessEntry, WallFeedback } from "./selectWallProcess";
import { tokens } from "../../../styles/tokens";

export default { title: "Expo/Wall/Process experiments" };
const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
// Synthetic work/people. The image is an existing presentation fixture, copied into
// Storybook's own assets; production code does not import Storybook or legacy assets.
function entry(
  id: string,
  project: string,
  title: string,
  date: string,
  image: string | false = "/wall-study.jpg",
  body = "Trying a cooler palette, leaving more of the paper visible.",
): WallProcessEntry {
  return {
    id,
    project,
    date,
    replies: [],
    dateLabel: `Oct ${Number(date.slice(8, 10))}`,
    entry: {
      format: "mixed_media",
      format_data: { title },
      content: {
        type: "doc",
        content: [
          ...(image
            ? [
                {
                  type: "image",
                  attrs: {
                    src: image,
                    alt: title,
                    width: 843,
                    height: 1116,
                  },
                },
              ]
            : []),
          paragraph(body),
        ],
      },
    },
  };
}
const latest = entry(
  "latest",
  "River studies",
  "Leaving the sky unfinished",
  "2026-10-28T12:00:00Z",
);
const saved: WallFeedback = {
  id: "saved",
  entryId: "latest",
  author: "Jon",
  text: "The pale sky gives the trees room to breathe. I keep coming back to the little unpainted patch near the water.",
  savedAt: "2026-10-28T14:00:00Z",
  sourceTitle: "Leaving the sky unfinished",
};
const earlier: WallFeedback = {
  id: "earlier",
  entryId: "older",
  author: "Maya",
  text: "What happens if you leave the sky alone and let the darker marks do less?",
  savedAt: "2026-10-26T14:00:00Z",
  sourceTitle: "The first wash",
};
const cases: {
  artist: string;
  caption: string;
  entries: WallProcessEntry[];
}[] = [
  {
    artist: "Alex",
    caption: "Statement + entry + saved response",
    entries: [
      {
        ...latest,
        statement:
          "Does the open sky feel unfinished, or does it give this enough room?",
        replies: [
          { id: 1, username: "Jon", text: saved.text },
          {
            id: 2,
            username: "Maya",
            text: "The unpainted areas keep this feeling open.",
          },
          {
            id: 3,
            username: "Priya",
            text: "The cool greens are working well.",
          },
          {
            id: 4,
            username: "Sammy",
            text: "The reflection is the part I return to.",
          },
        ],
        savedResponses: [saved],
      },
    ],
  },
  {
    artist: "Rowan",
    caption: "Two projects + saved response",
    entries: [
      {
        ...entry(
          "rowan-new",
          "Street light",
          "After the rain",
          "2026-10-28T12:00:00Z",
          false,
          "The last light catches the edge of the street.",
        ),
        replies: [
          {
            id: 5,
            username: "Priya",
            text: "That sliver of light is where my eye stops. The rest can stay quiet.",
          },
        ],
        savedResponses: [
          {
            ...saved,
            id: "rowan-response",
            entryId: "rowan-new",
            author: "Priya",
            text: "That sliver of light is where my eye stops. The rest can stay quiet.",
            sourceTitle: "After the rain",
          },
        ],
      },
      entry(
        "rowan-old",
        "Pocket poems",
        "On the way home",
        "2026-10-27T12:00:00Z",
        false,
        "A window left open / carries the evening upstairs.",
      ),
    ],
  },
  {
    artist: "Sammy",
    caption: "Two projects + an earlier touchstone",
    entries: [
      {
        ...entry(
          "sam-new",
          "Character sketches",
          "Spunky",
          "2026-10-28T12:00:00Z",
          "/wall-spunky.jpg",
          "A stronger silhouette for this little character.",
        ),
        touchstones: [
          {
            ...earlier,
            text: "Could the pose carry the personality before we see any details?",
            sourceTitle: "First character sketch",
          },
        ],
      },
      entry(
        "sam-old",
        "Small sounds",
        "Kitchen rhythm",
        "2026-10-27T12:00:00Z",
        false,
        "Three taps on a cup, then leave a beat of silence.",
      ),
    ],
  },
  {
    artist: "Ellis",
    caption: "Three entries, no selected context",
    entries: [
      entry(
        "ellis-new",
        "Faces",
        "Cool",
        "2026-10-28T12:00:00Z",
        "/wall-cool.jpg",
        "Trying fewer marks and a more direct expression.",
      ),
      entry(
        "ellis-middle",
        "Notebook",
        "A small promise",
        "2026-10-27T12:00:00Z",
        false,
        "Tomorrow I will take the long way, past the garden gate.",
      ),
      entry(
        "ellis-old",
        "Notebook",
        "The blue hour",
        "2026-10-26T12:00:00Z",
        false,
        "The room turns blue before anyone thinks to turn on a light.",
      ),
    ],
  },
];
const descriptions: Record<
  WallTreatment,
  { title: string; description: string }
> = {
  outlinedCompact: {
    title: "Statement · 4 px padding",
    description:
      "Transparent, outlined, with a 22 px right inset and 10 px corners.",
  },
  outlinedSelected: {
    title: "Selected · 8 px padding",
    description:
      "Transparent, outlined, with a 22 px right inset and 10 px corners.",
  },
  mirrored: {
    title: "White statements and replies",
    description:
      "Artist context sits to the left; selected feedback sits to the right.",
  },
  white: {
    title: "White feedback",
    description:
      "Narrower white replies, bold project labels, and smaller artist avatars.",
  },
  joined: {
    title: "Warm-gray feedback",
    description:
      "Outlined statements with a slightly deeper warm-gray feedback surface.",
  },
  grid: {
    title: "Equal slots",
    description:
      "Three square slots per artist. Related pieces connect across the gaps.",
  },
  signals: {
    title: "Blue feedback",
    description:
      "Outlined statements, standard reply stripes, and compact reply summaries.",
  },
  thread: {
    title: "Outlined statements",
    description: "An outlined statement and compact feedback frame the entry.",
  },
};
function Gallery({ treatment }: { treatment: WallTreatment }) {
  const { width } = useWindowDimensions();
  return (
    <View style={styles.page}>
      <View style={styles.heading}>
        <Text style={styles.title}>{descriptions[treatment].title}</Text>
        <Text style={styles.description}>
          {descriptions[treatment].description}
        </Text>
        <Text style={styles.note}>
          Experimental Wall · tap any excerpt for detail
        </Text>
      </View>
      <View style={styles.grid}>
        {cases.map((item) => (
          <View
            key={item.artist}
            style={[
              styles.case,
              {
                width: (Math.min(width, 760) - 36) / 2,
              },
            ]}
          >
            <WallProcessPreview
              artist={item.artist}
              entries={item.entries}
              treatment={treatment}
            />
          </View>
        ))}
      </View>
    </View>
  );
}
export const OutlinedCompact = () => <Gallery treatment="outlinedCompact" />;
export const SelectedTreatment = () => <Gallery treatment="outlinedSelected" />;
export const MirroredContext = () => <Gallery treatment="mirrored" />;
export const WhiteFeedback = () => <Gallery treatment="white" />;
export const JoinedCards = () => <Gallery treatment="joined" />;
export const EqualSlots = () => <Gallery treatment="grid" />;
export const SmallSignals = () => <Gallery treatment="signals" />;
export const ConnectedNotes = () => <Gallery treatment="thread" />;
export const Empty = () => (
  <View style={styles.page}>
    <WallProcessPreview artist="Alex" entries={[]} treatment="joined" />
  </View>
);
export const LongContext = () => (
  <View style={[styles.page, { maxWidth: 440 }]}>
    <WallProcessPreview
      artist="Alex with a longer display name"
      treatment="signals"
      entries={[
        {
          ...latest,
          statement:
            "I am trying to leave more space in this study, but I keep wondering whether the empty sky reads as a deliberate choice or a section I forgot to paint. Where does your eye settle first, and where does it go next?",
          savedResponses: [
            { ...saved, author: "A peer with a longer display name" },
          ],
        },
      ]}
    />
  </View>
);
const styles = StyleSheet.create({
  page: {
    padding: 12,
    gap: 20,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    backgroundColor: tokens.surface,
    minHeight: "100%",
  },
  heading: { gap: 8, maxWidth: 780 },
  title: { fontFamily: "BarlowCondensedBold", fontSize: 32, color: tokens.ink },
  description: {
    fontFamily: "Lato",
    fontSize: 14,
    lineHeight: 20,
    color: tokens.ink,
  },
  note: {
    fontFamily: "Lato",
    fontSize: 12,
    lineHeight: 18,
    color: tokens.muted,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 12,
    rowGap: 28,
    alignItems: "flex-start",
  },
  case: { gap: 8 },
  caption: {
    fontFamily: "LatoBold",
    fontSize: 14,
    lineHeight: 20,
    color: tokens.muted,
  },
});
