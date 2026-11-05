import type { IntroductionSummary } from "./api/introductions";

export function introductionContext(
  introduction: IntroductionSummary,
  viewerUserId: string | number,
): string {
  const viewerId = String(viewerUserId);
  const creatorName = introduction.createdBy.displayUsername;
  const [firstParticipant, secondParticipant] = introduction.participants;
  const viewerIsCreator = String(introduction.createdBy.id) === viewerId;
  const viewerIsParticipant = introduction.participants.some(
    (participant) => String(participant.id) === viewerId,
  );
  const otherParticipant = introduction.participants.find(
    (participant) => String(participant.id) !== viewerId,
  );

  if (viewerIsCreator && firstParticipant && secondParticipant) {
    return `You introduced ${firstParticipant.displayUsername} to ${secondParticipant.displayUsername}`;
  }

  if (viewerIsParticipant && otherParticipant) {
    return `${creatorName} introduced you to ${otherParticipant.displayUsername}`;
  }

  if (firstParticipant && secondParticipant) {
    return `${creatorName} introduced ${firstParticipant.displayUsername} to ${secondParticipant.displayUsername}`;
  }

  return `${creatorName} made this introduction`;
}
