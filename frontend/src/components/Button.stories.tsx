import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { tokens } from "../styles/tokens";
import { layout } from "../styles/layout";

export default { title: "Expo/Button" };

export function PillTouchArea() {
  const [guides, setGuides] = useState(true);
  const [last, setLast] = useState("Tap a pill or its transparent margin.");
  const [count, setCount] = useState(0);
  const press = (label: string) => { setLast(label); setCount(value => value + 1); };
  const pill = (label: string, outline = false, disabled = false) => (
    <View style={styles.sample}>
      <Button shape="pill" emphasis={outline ? "outline" : "solid"}
        disabled={disabled} onPress={() => press(label)}>{label}</Button>
      {guides && <View pointerEvents="none" aria-hidden style={styles.guide} />}
    </View>
  );
  return <View style={styles.page}>
    <Text accessibilityRole="header" style={styles.title}>A smaller pill. The same room to tap.</Text>
    <Text style={styles.copy}>32px visible height · 44px touch height · unchanged 16px text</Text>
    <Button size="sm" emphasis="outline" selected={guides} onPress={() => setGuides(value => !value)}>
      {guides ? "Hide touch boundaries" : "Show touch boundaries"}
    </Button>
    <View style={styles.columns}>
      <View style={styles.section}>
        <Text style={styles.heading}>Default pill</Text>
        <Text style={styles.copy}>6px of transparent touch area on each side vertically.</Text>
        <View style={styles.crowded}>
          <Text style={styles.neighbor}>Content immediately above</Text>
          {pill("Share in Room")}
          <Text style={styles.neighbor}>Content immediately below</Text>
        </View>
      </View>
    </View>
    <View style={styles.columns}>
      <View style={styles.section}>
        <Text style={styles.heading}>Stacked with no added gap</Text>
        <Text style={styles.copy}>Touch areas meet. Visible pills stay 12px apart.</Text>
        <View style={styles.crowded}>
          {pill("Save changes")}
          {pill("Keep editing", true)}
          {pill("Unavailable", false, true)}
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.heading}>Stacked with 4px added gap</Text>
        <Text style={styles.copy}>Visible pills stay 16px apart.</Text>
        <View style={[styles.crowded, { gap: 4 }]}>
          {pill("Publish entry")}
          {pill("Back to draft", true)}
        </View>
      </View>
    </View>
    <Text accessibilityLiveRegion="polite" style={styles.status}>{last}{count > 0 ? ` · ${count} presses` : ""}</Text>
    <Text style={styles.copy}>Purple outlines mark the clickable boundary. Try the empty strip just above or below a pill, or use Tab and Enter. No overlapping targets or negative spacing are used.</Text>
  </View>;
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 20, backgroundColor: tokens.paper, minHeight: "100%", alignItems: "flex-start" },
  title: { ...layout.title, maxWidth: 650 },
  heading: { ...layout.text, fontFamily: "LatoBold", fontSize: 20 },
  copy: { ...layout.text, maxWidth: 650, lineHeight: 24 },
  columns: { flexDirection: "row", flexWrap: "wrap", gap: 32, width: "100%" },
  section: { flexBasis: 300, flexGrow: 1, maxWidth: 480, gap: 12 },
  crowded: { alignItems: "flex-start" },
  neighbor: { ...layout.text, lineHeight: 24, backgroundColor: tokens.surfaceMuted },
  sample: { alignSelf: "flex-start" },
  guide: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderWidth: 1, borderStyle: "dashed", borderColor: tokens.purple },
  status: { ...layout.text, minHeight: 24, fontFamily: "LatoBold" },
});

export function SizingContracts() {
  return <View style={styles.page}>
    <Text style={styles.heading}>Shared sizing contracts</Text>
    <Button onPress={() => {}}>Default action</Button>
    <Button size="md" emphasis="outline" style={{ minHeight: 48 }} onPress={() => {}}>48px touch target</Button>
    <Button style={layout.entryFab} accessibilityLabel="Fixed-size entry action" onPress={() => {}}>+</Button>
    <Button size="icon" accessibilityLabel="Icon action" onPress={() => {}}>+</Button>
    <Button size="sm" onPress={() => {}}>Small action</Button>
    <Button shape="default" emphasis="outline" onPress={() => {}}>Default-shape control</Button>
    <Button style={{ borderTopRightRadius: 12, borderBottomLeftRadius: 12, borderTopLeftRadius: 0, borderBottomRightRadius: 0 }} onPress={() => {}}>Sign-in treatment</Button>
  </View>;
}
