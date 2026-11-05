import { tokens } from "../styles/tokens";
import { AudioPlayerWidget } from "../features/content/AudioPlayerWidget";
import {
  ViewportToolbarProvider,
  ViewportToolbarHost,
} from "./ViewportToolbar";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { layout } from "../styles/layout";
export function ViewportShell({
  children,
  suppressAudioPlayer = false,
  suppressToolbar = false,
  surface = tokens.surface,
  entryPage: _entryPage = false,
}: {
  children: ReactNode;
  suppressAudioPlayer?: boolean;
  suppressToolbar?: boolean;
  surface?: string;
  toolbarSurface?: string;
  entryPage?: boolean;
  floatingAudioPlayer?: boolean;
}) {
  return (
    <ViewportToolbarProvider>
      <SafeAreaView style={[layout.page, { backgroundColor: surface }]}>
        <KeyboardAvoidingView
          style={layout.grow}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          {children}
          {!suppressAudioPlayer && <AudioPlayerWidget />}
          {!suppressToolbar && <ViewportToolbarHost />}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ViewportToolbarProvider>
  );
}
