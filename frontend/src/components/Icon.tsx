import { SvgXml } from "react-native-svg";
import { icons } from "../styles/artwork";
import { tokens } from "../styles/tokens";
export function Icon({
  name,
  size = 24,
  color = tokens.ink,
}: {
  name: keyof typeof icons;
  size?: number;
  color?: string;
}) {
  return (
    <SvgXml
      xml={icons[name]}
      width={size}
      height={size}
      color={color}
      aria-hidden={true}
    />
  );
}
