import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";
import styles from "./Button.module.css";
import focus from "../styles/focus.module.css";

export type ButtonEmphasis = "solid" | "outline" | "ghost" | "link" | "bare";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "none";
export type ButtonShape = "default" | "pill" | "speech" | "reply";
export type ButtonColor = "cool" | "accent" | "primary" | "success" | "danger" | "warning" | "ink" | "bright";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  emphasis?: ButtonEmphasis;
  size?: ButtonSize;
  shape?: ButtonShape;
  color?: ButtonColor;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

const sizeClasses: Record<ButtonSize, string | undefined> = {
  xs: styles.sizeXs,
  sm: styles.sizeSm,
  md: styles.sizeMd,
  lg: styles.sizeLg,
  none: "",
};

const shapeClasses: Record<ButtonShape, string> = {
  default: styles.shapeDefault,
  pill: styles.shapePill,
  speech: styles.shapeSpeech,
  reply: styles.shapeReply,
};

const emphasisColorClasses: Record<ButtonEmphasis, Record<ButtonColor, string>> = {
  solid: {
    cool: styles.solidCool,
    accent: styles.solidAccent,
    primary: styles.solidPrimary,
    success: styles.solidSuccess,
    danger: styles.solidDanger,
    warning: styles.solidWarning,
    bright: styles.solidBright,
    ink: styles.solidInk,
  },
  outline: {
    cool: styles.outlineCool,
    accent: styles.outlineAccent,
    primary: styles.outlinePrimary,
    success: styles.outlineSuccess,
    danger: styles.outlineDanger,
    warning: styles.outlineWarning,
    bright: styles.outlineBright,
    ink: styles.outlineInk,
  },
  ghost: {
    cool: styles.ghostCool,
    accent: styles.ghostAccent,
    primary: styles.ghostPrimary,
    success: styles.ghostSuccess,
    danger: styles.ghostDanger,
    warning: styles.ghostWarning,
    bright: styles.ghostBright,
    ink: styles.ghostInk,
  },
  link: {
    cool: styles.linkCool,
    accent: styles.linkAccent,
    primary: styles.linkPrimary,
    success: styles.linkSuccess,
    danger: styles.linkDanger,
    warning: styles.linkWarning,
    bright: styles.linkBright,
    ink: styles.linkInk,
  },
  bare: {
    cool: "",
    accent: "",
    primary: "",
    success: "",
    danger: "",
    warning: "",
    bright: "",
    ink: "",
  },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    emphasis = "solid",
    size = "md",
    shape = "default",
    color = "cool",
    iconLeft,
    iconRight,
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        focus.control,
        emphasis === "bare" ? "" : styles.base,
        sizeClasses[size],
        shapeClasses[shape],
        emphasis === "solid" && styles.solid,
        emphasis === "outline" && styles.outline,
        emphasis === "ghost" && styles.ghost,
        emphasis === "link" && styles.link,
        emphasisColorClasses[emphasis][color],
        className,
      )}
      {...rest}
    >
      {iconLeft && <span className={styles.icon}>{iconLeft}</span>}
      {children}
      {iconRight && <span className={styles.icon}>{iconRight}</span>}
    </button>
  );
});
