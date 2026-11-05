import { useId, type InputHTMLAttributes } from "react";
import { cn } from "../lib/cn";
import styles from "./Input.module.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  font?: "hero" | "display" | "heading" | "body";
  variant?: "default" | "bare";
  sizeClassName?: string;
}

export function Input({
  label,
  hint,
  error,
  font,
  className,
  id,
  variant = "default",
  sizeClassName,
  ...rest
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const describedBy = [rest["aria-describedby"], (error || hint) ? messageId : undefined].filter(Boolean).join(" ") || undefined;
  const fontOptions = {
    hero: styles.fontHero,
    display: styles.fontDisplay,
    heading: styles.fontHeading,
    body: styles.fontBody,
  };
  const fontClassName = font ? fontOptions[font] : fontOptions.body;
  const variantClassName = variant === "bare" ? styles.bare : styles.default;
  return (
    <div className={styles.field}>
      {label && <label htmlFor={inputId} className={styles.label}>{label}</label>}
      <input
        id={inputId}
        className={cn(
          styles.input,
          sizeClassName ?? styles.sizeDefault,
          variantClassName,
          fontClassName,
          error && styles.error,
          className,
        )}
        {...rest}
        aria-invalid={error ? true : rest["aria-invalid"]}
        aria-describedby={describedBy}
      />
      {error ? (
        <span id={messageId} className={cn(styles.message, styles.errorMessage)}>{error}</span>
      ) : (
        hint && <span id={messageId} className={styles.message}>{hint}</span>
      )}
    </div>
  );
}
