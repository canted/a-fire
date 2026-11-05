"use dom";
import type { DOMProps } from "expo/dom";
import { useFonts } from "expo-font";
import { fonts } from "../../styles/fonts";
import styles from "./RoundDateFields.module.css";

/** Browser date controls also expose the platform picker inside the native DOM adapter. */
export default function RoundDateFields({
  submitBy,
  feedbackDueAt,
  disabled,
  onChange,
}: {
  submitBy: string;
  feedbackDueAt: string;
  disabled?: boolean;
  onChange: (
    field: "submitBy" | "feedbackDueAt",
    value: string,
  ) => Promise<void>;
  dom?: DOMProps;
}) {
  useFonts({ Lato: fonts.Lato });
  return (
    <div className={styles.fields}>
      <label className={styles.field}>
        Submit by
        <input
          aria-label="Submit by"
          type="datetime-local"
          value={submitBy}
          disabled={disabled}
          onChange={(event) => {
            void onChange("submitBy", event.target.value);
          }}
        />
      </label>
      <label className={styles.field}>
        Feedback due
        <input
          aria-label="Feedback due"
          type="datetime-local"
          value={feedbackDueAt}
          disabled={disabled}
          onChange={(event) => {
            void onChange("feedbackDueAt", event.target.value);
          }}
        />
      </label>
    </div>
  );
}
