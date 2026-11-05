import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { PopupMenu } from "../../components/PopupMenu";
import { RoundPresentation, type RoundTreatment, type RoundProgressPerson } from "./RoundPresentation";
import { roundResultMembers } from "../rooms/wall/wallModel";
import type { WallDetail } from "../../lib/api/walls";
import { tokens } from "../../styles/tokens";

export default {
  title: "Expo/Rounds/Experiments/Three treatments",
  parameters: { layout: "fullscreen" },
  argTypes: {
    phase: { control: "inline-radio", options: ["in-progress", "newly-created", "complete"] },
    density: { control: "inline-radio", options: ["comfortable", "compact"] },
    narrow: { control: "boolean" },
  },
  args: { phase: "in-progress", density: "comfortable", narrow: false },
};
const names = ["Maya", "Alex", "Sam", "Jules"];
const titles = ["Before the city wakes", "A room still warm", "Window, 6:14 am", "Last light"];
const lines = ["The kettle clicks.\nA bus turns the corner.\nThe day hasn’t asked anything of us yet.", "A little melody for the quiet after everyone has gone.", "I kept the blue, and let the rest disappear.", "A study in leaving enough space for the light."];
const result: WallDetail = {
  id: "experiment-wall", roomId: "1", roundId: "1", title: "Small hours", description: null,
  publishedAt: "2026-11-04", templateKey: "feedback",
  entries: names.map((name, i) => ({ id: String(i + 1), entryId: String(i + 10), authorName: name,
    authorAvatarUrl: null, available: true, responseCount: 0, responseParticipants: [], format: "mixed_media",
    formatData: { title: titles[i] }, content: { type: "doc", content: [
      ...(i === 1 || i === 2 ? [{ type: "image", attrs: { src: i === 1 ? "/wall-study.jpg" : "/wall-cool.jpg", alt: titles[i] } }] : []),
      { type: "paragraph", content: [{ type: "text", text: lines[i] }] },
    ] },
  })),
};
const members = roundResultMembers(result);
type Args = { phase: "in-progress" | "newly-created" | "complete"; density: "comfortable" | "compact"; narrow: boolean; longPrompt?: boolean; statusIcons?: "checks" | "share" };
function Experiment({ treatment, phase, density, narrow, longPrompt, statusIcons }: Args & { treatment: RoundTreatment }) {
  const [state, setState] = useState<"participant" | "reviewer" | "follower" | null>(null);
  const [screen, setScreen] = useState<"manage" | "reach" | "share" | "work" | "home" | null>(null);
  const [notice, setNotice] = useState("");
  const people: RoundProgressPerson[] = phase === "newly-created" ? [] : names.map((name, i) => ({ id: String(i), name, status: i === 0 ? "Shared" : i === 1 ? "Joined" : i === 2 ? "Giving feedback" : "Following" }));
  if (state) people.unshift({ id: "viewer", name: "You", status: state === "participant" ? "Joined" : state === "reviewer" ? "Giving feedback" : "Following" });
  return <ScrollView style={styles.canvas}>
    <View style={[styles.frame, narrow && styles.narrow]}>
      <RoundPresentation treatment={treatment} name="Small hours"
        prompt={longPrompt ? "Make something about a moment the rest of the world slept through. It could be a sound from your street, the light in an empty kitchen, or a thought that only arrives when everything is quiet. Bring a small unfinished piece, and tell us what you are listening for as you work on it." : "Make something about a moment the rest of the world slept through."}
        complete={phase === "complete"} newlyCreated={phase === "newly-created"}
        statusIcons={statusIcons} participation={state} onParticipate={setState} canManage density={density}
        people={people}
        members={members} timing={phase === "complete" ? "Completed November 4" : "Share by Sunday · Feedback next week"}
        onBack={() => setScreen("home")} onReachOut={() => setScreen("reach")} onManage={() => setScreen("manage")}
        onShare={() => setScreen("share")} onOpenWork={work => { setNotice(work.entry.format_data?.title ?? "Shared work"); setScreen("work"); }} />
      <PopupMenu mode="dialog" open={Boolean(screen)} title={screen === "home" ? "Room home" : screen === "manage" ? "Manage Round" : screen === "reach" ? "Reach out to people" : screen === "share" ? "Share something" : notice}
        onClose={() => setScreen(null)} actions={[{ id: "close", label: "Back to Round", onSelect: () => setScreen(null) }]}>
        <Text style={styles.note}>{screen === "home" ? "Back navigation returns to this Round’s Room home in the application." : screen === "manage" ? "Editing, invitations, reminders and participation management belong on a separate page. This experiment previews that destination without changing a real Round." : screen === "reach" ? "This is where the host reaches out to Room members. No invitations are sent from this experiment." : screen === "share" ? "The existing sharing flow opens here in the application." : "The existing shared-work view opens here in the application."}</Text>
      </PopupMenu>
    </View>
  </ScrollView>;
}
export const Quiet = (args: Args) => <Experiment {...args} treatment="quiet" />;
export const Split = (args: Args) => <Experiment {...args} treatment="split" />;
export const PromptLed = (args: Args) => <Experiment {...args} treatment="prompt" />;
export const Compare = (args: Args) => {
  const [treatment, setTreatment] = useState<RoundTreatment>("prompt");
  const [phase, setPhase] = useState<Args["phase"]>(args.phase);
  const [statusIcons, setStatusIcons] = useState<"checks" | "share">("checks");
  const [longPrompt, setLongPrompt] = useState(false);
  const [narrow, setNarrow] = useState(args.narrow);
  useEffect(() => setPhase(args.phase), [args.phase]);
  useEffect(() => setNarrow(args.narrow), [args.narrow]);
  return <View style={styles.compare}>
    <View style={styles.controls}>
      <View style={styles.controlRow}>{([ ["quiet", "1 · Quiet"], ["split", "2 · Split"], ["prompt", "3 · Prompt-led"] ] as const).map(([value, label]) => <Button key={value} emphasis={treatment === value ? "solid" : "outline"} selected={treatment === value} onPress={() => setTreatment(value)}>{label}</Button>)}</View>
      <View style={styles.controlRow}>{([ ["newly-created", "Just created"], ["in-progress", "In progress"], ["complete", "Completed"] ] as const).map(([value, label]) => <Button key={value} emphasis="link" selected={phase === value} onPress={() => setPhase(value)}>{phase === value ? `• ${label}` : label}</Button>)}</View>
      <Button emphasis="link" selected={narrow} onPress={() => setNarrow(!narrow)}>{narrow ? "Show desktop width" : "Show phone width"}</Button>
      <Button emphasis="link" selected={longPrompt} onPress={() => setLongPrompt(!longPrompt)}>{longPrompt ? "Use short prompt" : "Try a long prompt"}</Button>
      <View style={styles.controlRow}><Button emphasis="link" selected={statusIcons === "checks"} onPress={() => setStatusIcons("checks")}>Single / double check</Button><Button emphasis="link" selected={statusIcons === "share"} onPress={() => setStatusIcons("share")}>Check / share arrow</Button></View>
      {treatment === "split" && <Text style={styles.note}>Split uses columns above 760px; in a narrower pane it stacks like Quiet.</Text>}
    </View>
    <Experiment {...args} statusIcons={statusIcons} longPrompt={longPrompt} narrow={narrow} phase={phase} treatment={treatment} />
  </View>;
};
const styles = StyleSheet.create({
  canvas: { backgroundColor: tokens.surface }, frame: { width: "100%", alignSelf: "center" }, narrow: { maxWidth: 390 },
  compare: { height: "100%", minHeight: 800 },
  controls: { padding: 16, gap: 8, backgroundColor: tokens.paper, borderBottomWidth: 1, borderBottomColor: tokens.border },
  controlRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  note: { fontFamily: "Lato", fontSize: 16, lineHeight: 24, color: tokens.ink },
});
