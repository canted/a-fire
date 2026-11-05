import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/Button";
import { UserIdentity } from "../../components/UserIdentity";
import { RoomWall } from "../rooms/RoomWall";
import type { WallMemberModel } from "../rooms/wall/wallModel";
import type { WallProcessEntry } from "../rooms/wall/selectWallProcess";
import { tokens } from "../../styles/tokens";

export type RoundTreatment = "quiet" | "split" | "prompt";
export type RoundProgressPerson = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  status: "Joined" | "Shared" | "Giving feedback" | "Following";
};
/** Candidate Round presentation. Data and actions stay with the route's existing owners. */
export type RoundPresentationProps = {
  treatment: RoundTreatment;
  name: string;
  prompt: string;
  complete: boolean;
  newlyCreated?: boolean;
  participation: "participant" | "reviewer" | "follower" | null;
  canManage: boolean;
  people: RoundProgressPerson[];
  members: WallMemberModel[];
  timing: string;
  statusIcons?: "checks" | "share";
  density?: "comfortable" | "compact";
  onParticipate: (role: "participant" | "reviewer" | "follower" | null) => void;
  onReachOut: () => void;
  onManage: () => void;
  onBack: () => void;
  onShare: () => void;
  onOpenWork: (entry: WallProcessEntry) => void;
};
export function RoundPresentation({ treatment, name, prompt, complete, newlyCreated,
  participation, canManage, people, members, timing, density = "comfortable",
  onParticipate, onReachOut, onManage, onBack, onShare, onOpenWork, statusIcons = "checks",
}: RoundPresentationProps) {
  const [width, setWidth] = useState(0);
  const [changing, setChanging] = useState(false);
  const split = treatment === "split" && width >= 760;
  const largePrompt = treatment === "prompt";
  const choose = (role: "participant" | "reviewer" | "follower" | null) => {
    onParticipate(role); setChanging(false);
  };
  const choice = !complete && (!participation || changing);
  return <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={styles.root}>
    <View style={[styles.page, density === "compact" && styles.compactPage]}>
      <View style={styles.navigation}>
        <View style={styles.identity}><Button size="icon" emphasis="bare" accessibilityLabel="Back to Room home" onPress={onBack}><Icon name="caretLeft" size={24} /></Button><Text accessibilityRole="header" style={styles.room}>{name}</Text></View>
        {canManage && <Button emphasis="link" onPress={onManage}>Manage Round</Button>}
      </View>
      {newlyCreated && !complete && <View style={styles.created}>
        <View style={styles.flex}>
          <Text style={styles.noticeTitle}>Your Round is open.</Text>
          <Text style={styles.body}>Let people know what you’re making together.</Text>
        </View>
        <Button onPress={onReachOut}>Reach out to people</Button>
      </View>}
      <View style={[styles.composition, split && styles.split, density === "compact" && styles.compactGap]}>
        <View style={[styles.introduction, split && styles.sidebar, largePrompt && styles.promptIntroduction]}>
          <Text style={[styles.prompt, largePrompt && (prompt.length > 160 ? styles.longPrompt : styles.displayPrompt)]}>{prompt}</Text>
          {choice ? <View style={styles.participation}>
            <Text style={styles.body}>How would you like to take part?</Text>
            <View style={styles.actions}>
              <Button onPress={() => choose("participant")}>Participate</Button>
              <Button emphasis="outline" onPress={() => choose("reviewer")}>Give feedback only</Button>
              <Button emphasis="link" onPress={() => choose("follower")}>Follow along</Button>
              {changing && <Button emphasis="link" onPress={() => choose(null)}>Leave Round</Button>}
            </View>
          </View> : !complete && <View style={styles.actions}>
            <Text style={styles.meta}>{participation === "participant" ? "Participating" : participation === "reviewer" ? "Giving feedback" : "Following along"}</Text>
            <Button emphasis="link" onPress={() => setChanging(true)}>Change</Button>
          </View>}
        </View>
        <View style={[styles.wallArea, split && styles.splitWall]}>
          {complete ? <RoomWall members={members} emptyMessage="Nothing was shared in this Round." onOpenEntry={onOpenWork} /> : <>
            <View style={styles.wallHeading}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>Taking shape</Text>
              {participation === "participant" && <Button onPress={onShare}>Share something</Button>}
            </View>
            <View style={styles.progressGrid}>
              {people.map(person => <View key={person.id} style={styles.person}>
                <UserIdentity username={person.name} avatarUrl={person.avatarUrl} />
                <View style={styles.statusCard}>
                  <View style={styles.statusSymbols}>
                    <Icon name={person.status === "Giving feedback" ? "chatTeardrop" : person.status === "Following" ? "eyesFill" : person.status === "Shared" && statusIcons === "share" ? "shareFat" : "checkFatFill"} size={20} color={person.status === "Joined" || (person.status === "Shared" && statusIcons === "checks") ? tokens.blue : tokens.inkMuted} />
                    {person.status === "Shared" && statusIcons === "checks" && <Icon name="checkFatFill" size={20} color={tokens.green} />}
                  </View>
                  <Text style={styles.status}>{person.status}</Text>
                </View>
              </View>)}
              {people.length % 2 === 1 && <View style={styles.person} />}
            </View>
            {!people.length && <Text style={styles.body}>The Wall will take shape as people join.</Text>}
          </>}
          <View style={styles.details}>
            <Text style={styles.meta}>{timing}</Text>
            {(complete || people.length > 0) && <Text style={styles.meta}>{complete ? `${members.length} people shared work` : `${people.filter(person => person.status === "Shared").length} of ${people.filter(person => person.status !== "Following" && person.status !== "Giving feedback").length} participants have shared`}</Text>}
          </View>
        </View>
      </View>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  root: { width: "100%", backgroundColor: tokens.surface, minHeight: 780 },
  page: { width: "100%", maxWidth: 1060, alignSelf: "center", paddingHorizontal: 24, paddingBottom: 64 },
  compactPage: { paddingHorizontal: 16, paddingBottom: 32 },
  navigation: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 72, marginBottom: 24 },
  identity: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 },
  room: { flexShrink: 1, fontFamily: "BarlowCondensedBold", fontSize: 20, color: tokens.ink },
  composition: { gap: 40 },
  compactGap: { gap: 24 },
  split: { flexDirection: "row", alignItems: "flex-start", gap: 48 },
  introduction: { gap: 12, maxWidth: 680 },
  sidebar: { width: 260, flexShrink: 0 },
  promptIntroduction: { maxWidth: 820, gap: 16, paddingBottom: 16 },
  prompt: { fontFamily: "Lato", fontSize: 18, lineHeight: 28, color: tokens.ink },
  displayPrompt: { fontFamily: "PoppinsSemibold", fontSize: 28, lineHeight: 38 },
  longPrompt: { fontFamily: "PoppinsSemibold", fontSize: 20, lineHeight: 30 },
  body: { fontFamily: "Lato", fontSize: 16, lineHeight: 24, color: tokens.ink },
  meta: { fontFamily: "Lato", fontSize: 13, lineHeight: 20, color: tokens.muted },
  participation: { gap: 12, paddingTop: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  wallArea: { gap: 20, minWidth: 0 },
  splitWall: { flex: 1 },
  wallHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 },
  sectionTitle: { fontFamily: "PoppinsSemibold", fontSize: 20, color: tokens.ink },
  progressGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  person: { flexBasis: "45%", flexGrow: 1, minWidth: 120, gap: 10 },
  statusSymbols: { flexDirection: "row", alignItems: "center", gap: 2 },
  statusCard: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: tokens.paper, borderRadius: 16, padding: 16, minHeight: 76 },
  status: { flexShrink: 1, fontFamily: "Lato", fontSize: 16, lineHeight: 24, textAlign: "center", color: tokens.inkMuted },
  details: { borderTopWidth: 1, borderTopColor: tokens.border, paddingTop: 20, gap: 4, marginTop: 12 },
  created: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 20, paddingBottom: 24, marginBottom: 32, borderBottomWidth: 1, borderBottomColor: tokens.borderStrong },
  noticeTitle: { fontFamily: "LatoBold", fontSize: 16, lineHeight: 24, color: tokens.ink },
  flex: { flexGrow: 1, flexBasis: 240, gap: 4 },
});
