import type { RoundDetail } from "./api/rounds";

type ActivityAction = { label: string; description: string };

/** Present the same choices as the activity route; the route owns the action itself. */
export function currentActivityActions(detail?: RoundDetail): ActivityAction[] {
  if (!detail || detail.round.status !== "active" || detail.phase === "complete" || detail.phase === "upcoming") return [];
  const viewer = detail.viewerState;
  const activity = detail.roundState;

  if (detail.round.templateKey === "art_before_chorus") {
    if (!activity || activity.phase === "complete" || activity.phase === "upcoming") return [];
    if (viewer.role !== "participant" || viewer.status !== "active") {
      return viewer.canJoin ? [{ label: "Join Round", description: "Bring cover art, then make a response." }] : [];
    }
    if (activity.phase === "collecting_covers") {
      return !activity.viewer.cover ? [{ label: "Add cover art", description: "Choose an image for this Round." }] : [];
    }
    if (!activity.viewer.cover) return [];
    if (!activity.viewer.chosenCover) {
      return activity.viewer.offeredCovers ? [{ label: "Choose a cover", description: "Pick one of your two cover choices." }] : [];
    }
    if (activity.viewer.response) return [];
    const formats = activity.config.responseFormat === "audio"
      ? "Record or upload audio."
      : activity.config.responseFormat === "audio_text"
        ? "Respond with audio or text."
        : "Respond with audio, text, or video.";
    return [{ label: "Make a response", description: formats }];
  }

  const actions: ActivityAction[] = [];
  if (viewer.canSubmit && !viewer.submittedEntryId) {
    actions.push({ label: "Share", description: "" });
  } else if (viewer.canJoin && viewer.role !== "participant") {
    actions.push({ label: "Join Round", description: "Take part and share a submission." });
  }
  if (viewer.canReview && detail.submissions.length > 0) {
    actions.push({ label: "Review submissions", description: "Open the Round to read work and give feedback." });
  }
  return actions;
}

export function activityWaitingMessage(detail?: RoundDetail) {
  if (detail?.roundState?.phase === "collecting_covers" && detail.roundState.viewer.cover) return "Your cover is in. The round will open responses when the cover phase is ready.";
  if (detail?.roundState?.viewer.response) return "Your response is in. Open the Round to see its progress.";
  if (detail?.roundState?.phase === "collecting_responses" && !detail.roundState.viewer.cover) return "The cover phase has ended. Open the Round for your current status.";
  if (detail?.phase === "complete") return "This Round is complete. Open it to see the work and feedback.";
  return "Waiting for the next step. Open the round to follow its progress.";
}
