import type { Notice } from "./api/noticeTypes";
type NoticeTitleActor = {
  name: string;
  avatarUrl?: string | null;
};

export type NoticeActionParts = {
  actors: NoticeTitleActor[];
  remainingActorCount: number;
  actionText: string;
};

export function noticeActionParts(notice: Notice): NoticeActionParts {
  const isReplyNotice = notice.type === "reply" || Boolean(notice.replyId);
  const isIntroductionNotice = notice.type === "introduction";
  const isChatNotice = notice.type === "chat";
  const isRoomNotice = notice.type === "circle";
  const isActivityNotice = notice.type === "activity" && Boolean(notice.eventType?.startsWith("round_") || notice.eventType?.startsWith("activity_"));
  const isMentionNotice = notice.type === "mention";
  return isIntroductionNotice
    ? introductionActionParts(notice)
    : isChatNotice
      ? chatActionParts(notice)
      : isRoomNotice
        ? roomActionParts(notice)
        : isActivityNotice
          ? activityActionParts(notice)
          : isMentionNotice
            ? mentionActionParts(notice)
            : isReplyNotice
              ? replyActionParts(notice)
              : notice.type === "post"
                ? postActionParts(notice)
                : roomUpdateActionParts(notice);
}
function chatActionParts(notice: Notice): NoticeActionParts {
  const targetRoomName = notice.roomName || "a Room";
  return {
    actors: [{ name: notice.source, avatarUrl: notice.sourceAvatarUrl ?? null }],
    remainingActorCount: 0,
    actionText: notice.eventType === "chat_reply_created"
      ? `replied to your post in ${targetRoomName}`
      : notice.eventType === "chat_message_created"
      ? `messaged in ${targetRoomName}`
      : notice.eventType === "chat_message_saved_as_post"
        ? `saved a chat message as a post in ${targetRoomName}`
        : `asked you to save a chat message as a post in ${targetRoomName}`,
  };
}

function activityActionParts(notice: Notice): NoticeActionParts {
  const activityName = notice.activityName?.trim() || "The round";
  let actionText: string;

  if (notice.eventType === "round_reminder") {
    actionText = `Reminder for ${activityName}`;
  } else if (notice.eventType === "round_deadline_approaching") {
    actionText = `${activityName} is due soon`;
  } else if (notice.eventType === "round_contribution_removed") {
    actionText = `Your contribution was removed from ${activityName}`;
  } else if (notice.activityMilestone === "round_completed") {
    actionText = `${activityName} is complete`;
  } else if (notice.activityMilestone === "submission_started") {
    actionText = `${activityName} is open`;
  } else if (notice.activityMilestone === "feedback_started") {
    actionText = `${activityName} is ready for responses`;
  } else {
    actionText = `${activityName} has an update`;
  }

  return { actors: [], remainingActorCount: 0, actionText };
}

function mentionActionParts(notice: Notice): NoticeActionParts {
  return {
    actors: [{ name: notice.source, avatarUrl: notice.sourceAvatarUrl ?? null }],
    remainingActorCount: 0,
    actionText: `mentioned you in ${notice.roomName || "a Room"}`,
  };
}

function roomUpdateActionParts(notice: Notice): NoticeActionParts {
  return {
    actors: [{ name: notice.source, avatarUrl: notice.sourceAvatarUrl ?? null }],
    remainingActorCount: 0,
    actionText: `shared activity in ${notice.roomName || "a Room"}`,
  };
}

function roomActionParts(notice: Notice): NoticeActionParts {
  const targetRoomName = notice.roomName || "a Room";
  const actionText = notice.eventType === "circle_member_invited"
    ? `invited you to ${targetRoomName}`
    : notice.eventType === "circle_knock_suggested"
      ? `suggested that you knock on ${targetRoomName}`
      : notice.eventType === "circle_join_requested"
        ? `asked to join ${targetRoomName}`
        : notice.eventType === "circle_join_approved"
          ? `approved your request to join ${targetRoomName}`
          : `shared activity from ${targetRoomName}`;
  return {
    actors: [{ name: notice.source, avatarUrl: notice.sourceAvatarUrl ?? null }],
    remainingActorCount: 0,
    actionText,
  };
}

function postActionParts(notice: Notice): NoticeActionParts {
  return {
    actors: [{ name: notice.source, avatarUrl: notice.sourceAvatarUrl ?? null }],
    remainingActorCount: 0,
    actionText: `posted to ${notice.roomName || "a room"}`,
  };
}

function introductionActionParts(notice: Notice): NoticeActionParts {
  const otherRecipientText = notice.otherRecipientName ? ` and ${notice.otherRecipientName}` : "";
  const contextText = notice.introductionThroughPost ? " through a post" : "";
  return {
    actors: [{ name: notice.source, avatarUrl: notice.sourceAvatarUrl ?? null }],
    remainingActorCount: 0,
    actionText: `made an introduction for you${otherRecipientText}${contextText}`,
  };
}

function replyActionParts(notice: Notice): NoticeActionParts {
  const postOwner = notice.postAuthorName;
  const replyCount = notice.replyCount ?? 1;
  const { actors, remainingActorCount } = replyActorParts(notice);
  if (replyCount > 1 && notice.replyActors?.length === 1) {
    const singleActorParts = { actors, remainingActorCount: 0 };
    if (!postOwner) return { ...singleActorParts, actionText: `replied ${replyCount} times to a post` };
    return { ...singleActorParts, actionText: `replied ${replyCount} times to ${postOwner}'s post` };
  }

  if (!postOwner) return { actors, remainingActorCount, actionText: "replied to a post" };
  return { actors, remainingActorCount, actionText: `replied to ${postOwner}'s post` };
}

function replyActorParts(notice: Notice) {
  const bundledActors = notice.replyActors?.filter((actor) => actor.name) ?? [];
  const actors = bundledActors.length > 0 ? bundledActors : [{ name: notice.source, avatarUrl: notice.sourceAvatarUrl ?? null }];
  const replyCount = notice.replyCount ?? actors.length;
  const shown = actors.slice(0, 2);
  const remainingActorCount = Math.max(replyCount - shown.length, 0);

  return {
    actors: shown.length > 0 ? shown : [{ name: notice.source, avatarUrl: notice.sourceAvatarUrl ?? null }],
    remainingActorCount,
  };
}
