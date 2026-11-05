import type { RoundRole, RoundDetail } from "./api/rounds";

export function completedActivitySummary({
  role,
  submitted,
  feedbackGivenCount,
  totalSubmissions,
  feedbackReceivedCount,
  reviewedCount,
}: {
  role: RoundRole | null;
  submitted: boolean;
  feedbackGivenCount: number;
  totalSubmissions: number;
  feedbackReceivedCount: number;
  reviewedCount: number;
}) {
  const feedbackProgress = `gave feedback to ${feedbackGivenCount} of ${totalSubmissions} submissions`;
  if (role === "participant" || submitted) {
    if (!submitted) {
      return `You participated without a submission and ${feedbackProgress}.`;
    }
    const responseLabel =
      feedbackReceivedCount === 1 ? "response" : "responses";
    return `You posted to this Round and ${feedbackProgress}. Your submission received ${feedbackReceivedCount} ${responseLabel}.`;
  }
  if (role === "reviewer")
    return `You reviewed this Round and ${feedbackProgress}.`;
  if (role === "follower") {
    return `You followed this Round. ${totalSubmissions} submissions were shared and ${reviewedCount} received feedback.`;
  }
  return `${totalSubmissions} submissions were shared and ${reviewedCount} received feedback.`;
}

export function activityParticipationStatus(role: RoundRole | null) {
  if (role === "participant") return "participating";
  if (role === "reviewer") return "reviewing";
  if (role === "follower") return "following";
  return "join round";
}

const DAY_IN_MILLISECONDS = 86_400_000;

export function activityTimeRemaining(
  phase: "upcoming" | "submission" | "feedback" | "complete",
  activity: { submitBy?: string | null; feedbackDueAt?: string | null },
  now = Date.now(),
) {
  if (phase === "complete")
    return { compact: "Complete", description: "Round complete" };
  if (phase === "upcoming")
    return { compact: "Upcoming", description: "Round has not started" };
  const deadline =
    phase === "submission" ? activity.submitBy : activity.feedbackDueAt;
  if (!deadline)
    return phase === "submission"
      ? { compact: "Open", description: "Submissions are open" }
      : { compact: "Open", description: "Feedback is open" };
  const timestamp = Date.parse(deadline);
  if (!Number.isFinite(timestamp))
    return phase === "submission"
      ? { compact: "Open", description: "Submissions are open" }
      : { compact: "Open", description: "Feedback is open" };
  const days = Math.max(0, Math.ceil((timestamp - now) / DAY_IN_MILLISECONDS));
  const unit = days === 1 ? "day" : "days";
  return {
    compact: `${days}d`,
    description:
      phase === "submission"
        ? `Submission closes in ${days} ${unit}`
        : `Reviewing ends in ${days} ${unit}`,
  };
}

export function feedbackRoundPeople(detail: RoundDetail) {
  const active = detail.participants.filter(person => person.status === 'active');
  const submitted = new Set(detail.submissions.map(entry => entry.userId));
  const entries = [
    ...detail.submissions.map(submission => ({ kind: 'submission' as const, submission })),
    ...active.filter(person => !submitted.has(person.userId)).map(participant => ({ kind: 'placeholder' as const, participant })),
  ];
  return { participantCount: new Set([...active.map(person => person.userId), ...submitted]).size, entries,
    submissionGroups: Array.from({ length: Math.ceil(entries.length / 2) }, (_, index) => entries.slice(index * 2, index * 2 + 2)) };
}

/** Identity comes from the authorized Round response, never a legacy position. */
export function canSubmitRoundEntry(detail: Pick<RoundDetail, "viewerUserId" | "viewerState">, participantUserId: string): boolean {
  return Boolean(detail.viewerUserId && detail.viewerState.canSubmit && detail.viewerUserId === participantUserId);
}
