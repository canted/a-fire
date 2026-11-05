import type { Preview } from "@storybook/react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../src/styles/tokens.css";
import "./preview.css";
import "../src/components/ViewportShell.module.css";
import { useKeyboardFocus } from "../src/hooks/useKeyboardFocus.web.ts";
function FixtureProvider({ children }: { children: React.ReactNode }) {
  useKeyboardFocus();
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      {children}
    </SafeAreaProvider>
  );
}
const preview: Preview = {
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <FixtureProvider>
        <Story />
      </FixtureProvider>
    ),
  ],
};
export default preview;
