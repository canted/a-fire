import { View } from "react-native";
import { AppImage } from "../../components/AppImage";
import { Icon } from "../../components/Icon";
import {
  projectColors,
  projectIdentity,
  projectSymbols,
} from "../../../../types/project-identity";
import { tokens } from "../../styles/tokens";

/** Expo projection of the shared project identity contract. */
export function ProjectIcon({
  name,
  imageUrl,
  symbol,
  themeColor,
  color,
  size = 24,
}: {
  name: string;
  imageUrl?: string | null;
  symbol?: string | null;
  themeColor?: string | null;
  size?: number;
  color?: string;
}) {
  const identity = projectIdentity(name);
  if (projectSymbols.includes(symbol as (typeof projectSymbols)[number]))
    identity.icon = symbol as (typeof projectSymbols)[number];
  if (projectColors.includes(themeColor as (typeof projectColors)[number]))
    identity.color = themeColor as (typeof projectColors)[number];
  return imageUrl && !symbol ? (
    <View style={{ width: size, height: size }}>
      <AppImage src={imageUrl} alt="" />
    </View>
  ) : (
    <Icon
      name={identity.icon}
      color={color ?? tokens[identity.color]}
      size={size}
    />
  );
}
