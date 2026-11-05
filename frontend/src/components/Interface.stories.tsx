import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { Input } from "./Input";
import { Icon } from "./Icon";
import { PopupMenu } from "./PopupMenu";
import { PageScrollView } from "./PageScrollView";
import { AppImagePresentation } from "./AppImagePresentation";
import {
  ViewportToolbar,
  ViewportToolbarHost,
  ViewportToolbarProvider,
} from "./ViewportToolbar";
import { layout } from "../styles/layout";
import { RoomHeader } from "../features/rooms/RoomHeader";

export default { title: "Expo/Interface" };
export function Controls() {
  return (
    <View style={[layout.content, layout.section]}>
      <Button onPress={() => {}}>Primary action</Button>
      <Button emphasis="outline" onPress={() => {}}>
        Secondary action
      </Button>
      <Button disabled onPress={() => {}}>
        Unavailable action
      </Button>
      <Button
        shape="circle"
        size="icon"
        accessibilityLabel="Done"
        onPress={() => {}}
      >
        <Icon name="checkBold" />
      </Button>
      <Input
        accessibilityLabel="Long title"
        defaultValue="A deliberately long project title that should remain inside a narrow viewport"
      />
      <Input
        multiline
        accessibilityLabel="Body"
        defaultValue="Text can wrap while keyboard focus remains visible."
      />
    </View>
  );
}
function Overlay({ mode }: { mode: "menu" | "dialog" | "page" }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<View>(null);
  const close = () => setOpen(false);
  const actions = [
    { id: "done", label: "Done", onSelect: close },
    {
      id: "disabled",
      label: "Unavailable action",
      disabled: true,
      onSelect: close,
    },
  ];
  return (
    <View style={[layout.content, layout.section]}>
      <Button ref={anchor} onPress={() => setOpen(true)}>
        Open {mode}
      </Button>
      {mode === "menu" ? (
        <PopupMenu
          mode="menu"
          open={open}
          title="Options"
          anchor={anchor}
          actions={actions}
          onClose={close}
        />
      ) : (
        <PopupMenu
          mode={mode}
          open={open}
          title="A longer dialog title that wraps on small screens"
          anchor={anchor}
          actions={[]}
          onClose={close}
          footer={<Button onPress={close}>Done</Button>}
        >
          <View style={layout.section}>
            <Text style={layout.text}>
              Check short viewport heights, keyboard focus, scrolling, and the
              footer.
            </Text>
            <Input
              multiline
              accessibilityLabel="Fixture note"
              placeholder="Add a note"
            />
            <Text accessibilityRole="alert" style={layout.text}>
              Could not save. Your changes are retained.
            </Text>
            <Button emphasis="link" onPress={() => {}}>
              Try again
            </Button>
          </View>
        </PopupMenu>
      )}
    </View>
  );
}
export const AnchoredMenu = () => <Overlay mode="menu" />;
export const Dialog = () => <Overlay mode="dialog" />;
export const FullPage = () => <Overlay mode="page" />;
export function LongRoomName() {
  const [open, setOpen] = useState(false);
  return (
    <RoomHeader
      title="A very long Room name with enough words to test narrow-screen truncation"
      detailsOpen={open}
      shelfOpen={false}
      hasSides
      detailsRef={useRef<View>(null)}
      shelfRef={useRef<View>(null)}
      onBack={() => {}}
      backLabel="Back"
      onDetails={() => setOpen(!open)}
      onShelf={() => {}}
    />
  );
}
export function MediaStates() {
  return (
    <View style={[layout.content, layout.section]}>
      <AppImagePresentation
        alt="Loading fixture"
        ratio={3}
        onError={() => {}}
      />
      <AppImagePresentation
        alt="Failed fixture"
        ratio={3}
        failed
        onError={() => {}}
        retry={() => {}}
      />
    </View>
  );
}
export function ScrollingAndToolbar() {
  const [selected, setSelected] = useState(false);
  return (
    <ViewportToolbarProvider>
      <View style={styles.viewport}>
        <PageScrollView>
          {Array.from({ length: 12 }, (_, i) => (
            <Text key={i} style={layout.text}>
              Paragraph {i + 1}: review the bottom clearance and independently
              scrolling content.
            </Text>
          ))}
          <ViewportToolbar>
            <Button onPress={() => setSelected(!selected)}>
              {selected ? "Selected" : "Select"}
            </Button>
          </ViewportToolbar>
        </PageScrollView>
        <ViewportToolbarHost />
      </View>
    </ViewportToolbarProvider>
  );
}
const styles = StyleSheet.create({ viewport: { height: 420 } });
