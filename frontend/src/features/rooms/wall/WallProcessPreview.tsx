import type { ComponentProps } from "react";
import { WallMember } from "./WallMember";
import { selectWallProcess, type WallProcessEntry } from "./selectWallProcess";
export type { WallTreatment } from "./WallMember";
/** Storybook treatment adapter; production uses RoomWall and prepared slots. */
export function WallProcessPreview({ entries, ...props }: Omit<ComponentProps<typeof WallMember>, "slots"> & { entries: WallProcessEntry[] }) {
  return <WallMember {...props} slots={selectWallProcess(entries)} />;
}
