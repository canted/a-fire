import type { ComponentPropsWithRef } from "react";
import { ScrollView } from "react-native";
import { layout } from "../styles/layout";

/** Standard page width and stable player clearance; the viewport shell owns docking. */
export function PageScrollView({
  contentContainerStyle,
  ...props
}: ComponentPropsWithRef<typeof ScrollView>) {
  return (
    <ScrollView
      {...props}
      contentContainerStyle={[
        layout.content,
        contentContainerStyle,
        layout.audioClearance,
      ]}
    />
  );
}
