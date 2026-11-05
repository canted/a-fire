import { factory } from "@factory-js/factory";
import type { Prisma, PrismaClient } from "@prisma/client";
import { rands } from "@factory-js/prisma-factory";
const PushDeviceAttemptState = [
  "started",
  "sent",
  "rejected",
  "invalid",
  "uncertain",
] as const;
const MediaProcessingKind = ["audio", "video"] as const;
const MediaProcessingState = [
  "processing",
  "published",
  "failed",
  "superseded",
] as const;

export function defineUserFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.UserUncheckedCreateInput,
      Prisma.Result<typeof db.user, unknown, "create">
    >(
      {
        props: {
          id: () => rands.Int(),
          email: () => rands.String(),
          encrypted_password: () => rands.String(),
          reset_password_token: () => rands.String(),
          reset_password_sent_at: () => rands.DateTime(),
          remember_created_at: () => rands.DateTime(),
          username: () => rands.String(),
          profile_line: () => rands.String(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
          last_seen_at: () => rands.DateTime(),
          notify_by_the: () => rands.Int(),
          notified_at: () => rands.DateTime(),
        },
        vars: {},
      },
      async (props) => await db.user.create({ data: props }),
    )
    .props({});
}

export function defineRoomFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.RoomUncheckedCreateInput,
      Prisma.Result<typeof db.room, unknown, "create">,
      {
        owner: Prisma.Result<typeof db.user, unknown, "create"> | null;
        parent: Prisma.Result<typeof db.room, unknown, "create"> | null;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          name: () => rands.String(),
          owner_id: () => rands.Int(),
          parent_id: () => rands.Int(),
          porosity: () => rands.String(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
          deleted_at: () => rands.DateTime(),
          reply_mode: () => rands.String(),
          default_feedback_types: () => rands.Json(),
          default_idea_guidance: () => rands.String(),
        },
        vars: {
          owner: async () => await defineUserFactory(db).create(),
          parent: () => null,
        },
      },
      async (props) => await db.room.create({ data: props }),
    )
    .props({
      owner_id: async ({ vars }) => (await vars.owner)?.id ?? null,
      parent_id: async ({ vars }) => (await vars.parent)?.id ?? null,
    });
}

export function defineChatMessageFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ChatMessageUncheckedCreateInput,
      Prisma.Result<typeof db.chatMessage, unknown, "create">,
      {
        room: Prisma.Result<typeof db.room, unknown, "create">;
        author: Prisma.Result<typeof db.user, unknown, "create">;
        saved_by: Prisma.Result<typeof db.user, unknown, "create"> | null;
        pinned_by: Prisma.Result<typeof db.user, unknown, "create"> | null;
        entry: Prisma.Result<typeof db.entry, unknown, "create"> | null;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          room_id: () => rands.Int(),
          author_id: () => rands.Int(),
          saved_by_id: () => rands.Int(),
          pinned_by_id: () => rands.Int(),
          entry_id: () => rands.Int(),
          status: () => rands.String(),
          timeline_kind: () => rands.String(),
          entry_origin: () => rands.String(),
          saved_at: () => rands.DateTime(),
          pinned_at: () => rands.DateTime(),
          body: () => rands.String(),
          content: () => rands.Json(),
          masked_alias: () => rands.String(),
          client_nonce: () => rands.String(),
          fire_at: () => rands.DateTime(),
          expires_at: () => rands.DateTime(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          room: async () => await defineRoomFactory(db).create(),
          author: async () => await defineUserFactory(db).create(),
          saved_by: async () => await defineUserFactory(db).create(),
          pinned_by: async () => await defineUserFactory(db).create(),
          entry: async () => await defineEntryFactory(db).create(),
        },
      },
      async (props) => await db.chatMessage.create({ data: props }),
    )
    .props({
      room_id: async ({ vars }) => (await vars.room).id,
      author_id: async ({ vars }) => (await vars.author).id,
      saved_by_id: async ({ vars }) => (await vars.saved_by)?.id ?? null,
      pinned_by_id: async ({ vars }) => (await vars.pinned_by)?.id ?? null,
      entry_id: async ({ vars }) => (await vars.entry)?.id ?? null,
    });
}

export function defineChatMessageReadFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ChatMessageReadUncheckedCreateInput,
      Prisma.Result<typeof db.chatMessageRead, unknown, "create">,
      {
        user: Prisma.Result<typeof db.user, unknown, "create">;
        message: Prisma.Result<typeof db.chatMessage, unknown, "create">;
      }
    >(
      {
        props: {
          user_id: () => rands.Int(),
          message_id: () => rands.Int(),
          seen_at: () => rands.DateTime(),
        },
        vars: {
          user: async () => await defineUserFactory(db).create(),
          message: async () => await defineChatMessageFactory(db).create(),
        },
      },
      async (props) => await db.chatMessageRead.create({ data: props }),
    )
    .props({
      user_id: async ({ vars }) => (await vars.user).id,
      message_id: async ({ vars }) => (await vars.message).id,
    });
}

export function defineChatMessageIdentityGrantFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ChatMessageIdentityGrantUncheckedCreateInput,
      Prisma.Result<typeof db.chatMessageIdentityGrant, unknown, "create">,
      {
        message: Prisma.Result<typeof db.chatMessage, unknown, "create">;
        user: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          message_id: () => rands.Int(),
          user_id: () => rands.Int(),
          created_at: () => rands.DateTime(),
        },
        vars: {
          message: async () => await defineChatMessageFactory(db).create(),
          user: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) =>
        await db.chatMessageIdentityGrant.create({ data: props }),
    )
    .props({
      message_id: async ({ vars }) => (await vars.message).id,
      user_id: async ({ vars }) => (await vars.user).id,
    });
}

export function defineChatPresenceSessionFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ChatPresenceSessionUncheckedCreateInput,
      Prisma.Result<typeof db.chatPresenceSession, unknown, "create">,
      {
        room: Prisma.Result<typeof db.room, unknown, "create">;
        user: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          room_id: () => rands.Int(),
          user_id: () => rands.Int(),
          connection_id: () => rands.String(),
          entered_at: () => rands.DateTime(),
          last_seen_at: () => rands.DateTime(),
          left_at: () => rands.DateTime(),
        },
        vars: {
          room: async () => await defineRoomFactory(db).create(),
          user: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.chatPresenceSession.create({ data: props }),
    )
    .props({
      room_id: async ({ vars }) => (await vars.room).id,
      user_id: async ({ vars }) => (await vars.user).id,
    });
}

export function defineChatSaveRequestFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ChatSaveRequestUncheckedCreateInput,
      Prisma.Result<typeof db.chatSaveRequest, unknown, "create">,
      {
        message: Prisma.Result<typeof db.chatMessage, unknown, "create">;
        requester: Prisma.Result<typeof db.user, unknown, "create">;
        owner: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          message_id: () => rands.Int(),
          requester_id: () => rands.Int(),
          owner_id: () => rands.Int(),
          status: () => rands.String(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          message: async () => await defineChatMessageFactory(db).create(),
          requester: async () => await defineUserFactory(db).create(),
          owner: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.chatSaveRequest.create({ data: props }),
    )
    .props({
      message_id: async ({ vars }) => (await vars.message).id,
      requester_id: async ({ vars }) => (await vars.requester).id,
      owner_id: async ({ vars }) => (await vars.owner).id,
    });
}

export function defineRoomMembershipFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.RoomMembershipUncheckedCreateInput,
      Prisma.Result<typeof db.roomMembership, unknown, "create">,
      {
        room: Prisma.Result<typeof db.room, unknown, "create">;
        user: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          room_id: () => rands.Int(),
          user_id: () => rands.Int(),
          notify: () => rands.Boolean(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
          unseen_started_at: () => rands.DateTime(),
          username_override: () => rands.String(),
          profile_line_override: () => rands.String(),
          disabled: () => rands.Boolean(),
          revoked_at: () => rands.DateTime(),
        },
        vars: {
          room: async () => await defineRoomFactory(db).create(),
          user: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.roomMembership.create({ data: props }),
    )
    .props({
      room_id: async ({ vars }) => (await vars.room).id,
      user_id: async ({ vars }) => (await vars.user).id,
    });
}

export function defineRoomMembershipReconciliationFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.RoomMembershipReconciliationUncheckedCreateInput,
      Prisma.Result<typeof db.roomMembershipReconciliation, unknown, "create">
    >(
      {
        props: {
          id: () => rands.Int(),
          room_id: () => rands.Int(),
          user_id: () => rands.Int(),
          canonical_membership_id: () => rands.Int(),
          source_records: () => rands.Json(),
          conflicting_fields: () => rands.Array(rands.String()),
          review_status: () => rands.String(),
          created_at: () => rands.DateTime(),
        },
        vars: {},
      },
      async (props) =>
        await db.roomMembershipReconciliation.create({ data: props }),
    )
    .props({});
}

export function defineRoomJoinRequestFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.RoomJoinRequestUncheckedCreateInput,
      Prisma.Result<typeof db.roomJoinRequest, unknown, "create">,
      {
        room: Prisma.Result<typeof db.room, unknown, "create">;
        user: Prisma.Result<typeof db.user, unknown, "create">;
        reviewed_by: Prisma.Result<typeof db.user, unknown, "create"> | null;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          room_id: () => rands.Int(),
          user_id: () => rands.Int(),
          status: () => rands.String(),
          reviewed_by_id: () => rands.Int(),
          reviewed_at: () => rands.DateTime(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          room: async () => await defineRoomFactory(db).create(),
          user: async () => await defineUserFactory(db).create(),
          reviewed_by: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.roomJoinRequest.create({ data: props }),
    )
    .props({
      room_id: async ({ vars }) => (await vars.room).id,
      user_id: async ({ vars }) => (await vars.user).id,
      reviewed_by_id: async ({ vars }) => (await vars.reviewed_by)?.id ?? null,
    });
}

export function defineRoomMemberInvitationFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.RoomMemberInvitationUncheckedCreateInput,
      Prisma.Result<typeof db.roomMemberInvitation, unknown, "create">,
      {
        room: Prisma.Result<typeof db.room, unknown, "create">;
        user: Prisma.Result<typeof db.user, unknown, "create">;
        invited_by: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          room_id: () => rands.Int(),
          user_id: () => rands.Int(),
          invited_by_id: () => rands.Int(),
          status: () => rands.String(),
          responded_at: () => rands.DateTime(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          room: async () => await defineRoomFactory(db).create(),
          user: async () => await defineUserFactory(db).create(),
          invited_by: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.roomMemberInvitation.create({ data: props }),
    )
    .props({
      room_id: async ({ vars }) => (await vars.room).id,
      user_id: async ({ vars }) => (await vars.user).id,
      invited_by_id: async ({ vars }) => (await vars.invited_by).id,
    });
}

export function defineRoomKnockFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.RoomKnockUncheckedCreateInput,
      Prisma.Result<typeof db.roomKnock, unknown, "create">,
      {
        room: Prisma.Result<typeof db.room, unknown, "create">;
        user: Prisma.Result<typeof db.user, unknown, "create">;
        reviewed_by: Prisma.Result<typeof db.user, unknown, "create"> | null;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          room_id: () => rands.Int(),
          user_id: () => rands.Int(),
          status: () => rands.String(),
          reviewed_by_id: () => rands.Int(),
          reviewed_at: () => rands.DateTime(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          room: async () => await defineRoomFactory(db).create(),
          user: async () => await defineUserFactory(db).create(),
          reviewed_by: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.roomKnock.create({ data: props }),
    )
    .props({
      room_id: async ({ vars }) => (await vars.room).id,
      user_id: async ({ vars }) => (await vars.user).id,
      reviewed_by_id: async ({ vars }) => (await vars.reviewed_by)?.id ?? null,
    });
}

export function defineChatNoteCopyFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ChatNoteCopyUncheckedCreateInput,
      Prisma.Result<typeof db.chatNoteCopy, unknown, "create">,
      {
        message: Prisma.Result<typeof db.chatMessage, unknown, "create">;
        note: Prisma.Result<typeof db.page, unknown, "create">;
        copied_by: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          message_id: () => rands.Int(),
          note_id: () => rands.Int(),
          copied_by_id: () => rands.Int(),
          idempotency_key: () => rands.String(),
          created_at: () => rands.DateTime(),
        },
        vars: {
          message: async () => await defineChatMessageFactory(db).create(),
          note: async () => await definePageFactory(db).create(),
          copied_by: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.chatNoteCopy.create({ data: props }),
    )
    .props({
      message_id: async ({ vars }) => (await vars.message).id,
      note_id: async ({ vars }) => (await vars.note).id,
      copied_by_id: async ({ vars }) => (await vars.copied_by).id,
    });
}

export function defineRoomBannerFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.RoomBannerUncheckedCreateInput,
      Prisma.Result<typeof db.roomBanner, unknown, "create">,
      {
        room: Prisma.Result<typeof db.room, unknown, "create">;
        created_by: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          room_id: () => rands.Int(),
          created_by_id: () => rands.Int(),
          kind: () => rands.String(),
          placement: () => rands.String(),
          audience_type: () => rands.String(),
          visibility_rule: () => rands.String(),
          action_type: () => rands.String(),
          message: () => rands.String(),
          metadata: () => rands.Json(),
          starts_at: () => rands.DateTime(),
          ends_at: () => rands.DateTime(),
          archived_at: () => rands.DateTime(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          room: async () => await defineRoomFactory(db).create(),
          created_by: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.roomBanner.create({ data: props }),
    )
    .props({
      room_id: async ({ vars }) => (await vars.room).id,
      created_by_id: async ({ vars }) => (await vars.created_by).id,
    });
}

export function defineRoomBannerTargetFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.RoomBannerTargetUncheckedCreateInput,
      Prisma.Result<typeof db.roomBannerTarget, unknown, "create">,
      {
        banner: Prisma.Result<typeof db.roomBanner, unknown, "create">;
        user: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          room_banner_id: () => rands.Int(),
          user_id: () => rands.Int(),
          message_override: () => rands.String(),
          dismissed_at: () => rands.DateTime(),
          resolved_at: () => rands.DateTime(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          banner: async () => await defineRoomBannerFactory(db).create(),
          user: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.roomBannerTarget.create({ data: props }),
    )
    .props({
      room_banner_id: async ({ vars }) => (await vars.banner).id,
      user_id: async ({ vars }) => (await vars.user).id,
    });
}

export function defineEntryFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.EntryUncheckedCreateInput,
      Prisma.Result<typeof db.entry, unknown, "create">,
      {
        user: Prisma.Result<typeof db.user, unknown, "create">;
        round: Prisma.Result<typeof db.round, unknown, "create"> | null;
        project: Prisma.Result<typeof db.project, unknown, "create"> | null;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          user_id: () => rands.Int(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
          status: () => rands.String(),
          format: () => rands.String(),
          format_data: () => rands.Json(),
          room_id: () => rands.Int(),
          published_at: () => rands.DateTime(),
          reply_mode: () => rands.String(),
          requested_feedback_types: () => rands.Json(),
          idea_guidance: () => rands.String(),
          feedback_request_customized: () => rands.Boolean(),
          round_id: () => rands.Int(),
          project_id: () => rands.Int(),
          creation_origin: () => rands.String(),
          project_intent: () => rands.String(),
          project_question: () => rands.String(),
          project_lyrics: () => rands.String(),
          source_entry_id: () => rands.Int(),
          source_shared_entry_id: () => rands.Int(),
          source_reply_id: () => rands.Int(),
          source_chat_message_id: () => rands.Int(),
          source_author_name: () => rands.String(),
          source_room_ids: () => rands.Json(),
          source_room_id: () => rands.Int(),
          source_author_id: () => rands.Int(),
          room_statement: () => rands.String(),
          shared_feedback: () => rands.Json(),
          share_request_key: () => rands.String(),
          creation_request_key: () => rands.String(),
          share_request_fingerprint: () => rands.String(),
          locked: () => rands.Boolean(),
        },
        vars: {
          user: async () => await defineUserFactory(db).create(),
          round: async () => await defineRoundFactory(db).create(),
          project: async () => await defineProjectFactory(db).create(),
        },
      },
      async (props) => await db.entry.create({ data: props }),
    )
    .props({
      user_id: async ({ vars }) => (await vars.user).id,
      round_id: async ({ vars }) => (await vars.round)?.id ?? null,
      project_id: async ({ vars }) => (await vars.project)?.id ?? null,
    });
}

export function defineProjectFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ProjectUncheckedCreateInput,
      Prisma.Result<typeof db.project, unknown, "create">,
      { owner: Prisma.Result<typeof db.user, unknown, "create"> }
    >(
      {
        props: {
          creation_request_key: () => rands.String(),
          icon_symbol: () => rands.String(),
          icon_color: () => rands.String(),
          id: () => rands.Int(),
          owner_id: () => rands.Int(),
          name: () => rands.String(),
          description: () => rands.String(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          owner: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.project.create({ data: props }),
    )
    .props({ owner_id: async ({ vars }) => (await vars.owner).id });
}

export function defineProjectRoomFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ProjectRoomUncheckedCreateInput,
      Prisma.Result<typeof db.projectRoom, unknown, "create">,
      {
        project: Prisma.Result<typeof db.project, unknown, "create">;
        room: Prisma.Result<typeof db.room, unknown, "create">;
      }
    >(
      {
        props: {
          project_id: () => rands.Int(),
          room_id: () => rands.Int(),
          created_at: () => rands.DateTime(),
        },
        vars: {
          project: async () => await defineProjectFactory(db).create(),
          room: async () => await defineRoomFactory(db).create(),
        },
      },
      async (props) => await db.projectRoom.create({ data: props }),
    )
    .props({
      project_id: async ({ vars }) => (await vars.project).id,
      room_id: async ({ vars }) => (await vars.room).id,
    });
}

export function defineProjectParticipationFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ProjectParticipationUncheckedCreateInput,
      Prisma.Result<typeof db.projectParticipation, unknown, "create">,
      {
        project: Prisma.Result<typeof db.project, unknown, "create">;
        user: Prisma.Result<typeof db.user, unknown, "create">;
        invited_by: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          project_id: () => rands.Int(),
          user_id: () => rands.Int(),
          invited_by_id: () => rands.Int(),
          status: () => rands.String(),
          invited_at: () => rands.DateTime(),
          responded_at: () => rands.DateTime(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          project: async () => await defineProjectFactory(db).create(),
          user: async () => await defineUserFactory(db).create(),
          invited_by: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.projectParticipation.create({ data: props }),
    )
    .props({
      project_id: async ({ vars }) => (await vars.project).id,
      user_id: async ({ vars }) => (await vars.user).id,
      invited_by_id: async ({ vars }) => (await vars.invited_by).id,
    });
}

export function defineRoundFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.RoundUncheckedCreateInput,
      Prisma.Result<typeof db.round, unknown, "create">,
      {
        room: Prisma.Result<typeof db.room, unknown, "create"> | null;
        host: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          room_id: () => rands.Int(),
          host_id: () => rands.Int(),
          name: () => rands.String(),
          prompt: () => rands.String(),
          status: () => rands.String(),
          reply_mode: () => rands.String(),
          requested_feedback_types: () => rands.Json(),
          idea_guidance: () => rands.String(),
          template_key: () => rands.String(),
          template_version: () => rands.Int(),
          template_config: () => rands.Json(),
          started_at: () => rands.DateTime(),
          submit_by: () => rands.DateTime(),
          feedback_due_at: () => rands.DateTime(),
          closed_at: () => rands.DateTime(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          room: async () => await defineRoomFactory(db).create(),
          host: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.round.create({ data: props }),
    )
    .props({
      room_id: async ({ vars }) => (await vars.room)?.id ?? null,
      host_id: async ({ vars }) => (await vars.host).id,
    });
}

export function defineRoundResultFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.RoundResultUncheckedCreateInput,
      Prisma.Result<typeof db.roundResult, unknown, "create">,
      {
        round: Prisma.Result<typeof db.round, unknown, "create">;
        room: Prisma.Result<typeof db.room, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          round_id: () => rands.Int(),
          room_id: () => rands.Int(),
          title: () => rands.String(),
          description: () => rands.String(),
          published_at: () => rands.DateTime(),
        },
        vars: {
          round: async () => await defineRoundFactory(db).create(),
          room: async () => await defineRoomFactory(db).create(),
        },
      },
      async (props) => await db.roundResult.create({ data: props }),
    )
    .props({
      round_id: async ({ vars }) => (await vars.round).id,
      room_id: async ({ vars }) => (await vars.room).id,
    });
}

export function defineRoundResultEntryFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.RoundResultEntryUncheckedCreateInput,
      Prisma.Result<typeof db.roundResultEntry, unknown, "create">,
      {
        result: Prisma.Result<typeof db.roundResult, unknown, "create">;
        entry: Prisma.Result<typeof db.entry, unknown, "create"> | null;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          round_result_id: () => rands.Int(),
          entry_id: () => rands.Int(),
          position: () => rands.Int(),
          author_name: () => rands.String(),
        },
        vars: {
          result: async () => await defineRoundResultFactory(db).create(),
          entry: async () => await defineEntryFactory(db).create(),
        },
      },
      async (props) => await db.roundResultEntry.create({ data: props }),
    )
    .props({
      round_result_id: async ({ vars }) => (await vars.result).id,
      entry_id: async ({ vars }) => (await vars.entry)?.id ?? null,
    });
}

export function defineRoundResultPresentationFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.RoundResultPresentationUncheckedCreateInput,
      Prisma.Result<typeof db.roundResultPresentation, unknown, "create">,
      {
        result: Prisma.Result<typeof db.roundResult, unknown, "create">;
        user: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          round_result_id: () => rands.Int(),
          user_id: () => rands.Int(),
          presented_at: () => rands.DateTime(),
        },
        vars: {
          result: async () => await defineRoundResultFactory(db).create(),
          user: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.roundResultPresentation.create({ data: props }),
    )
    .props({
      round_result_id: async ({ vars }) => (await vars.result).id,
      user_id: async ({ vars }) => (await vars.user).id,
    });
}

export function defineActivityParticipationFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ActivityParticipationUncheckedCreateInput,
      Prisma.Result<typeof db.activityParticipation, unknown, "create">,
      {
        round: Prisma.Result<typeof db.round, unknown, "create">;
        user: Prisma.Result<typeof db.user, unknown, "create">;
        submitted_entry: Prisma.Result<
          typeof db.entry,
          unknown,
          "create"
        > | null;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          round_id: () => rands.Int(),
          user_id: () => rands.Int(),
          role: () => rands.String(),
          status: () => rands.String(),
          submitted_entry_id: () => rands.Int(),
          joined_at: () => rands.DateTime(),
          withdrawn_at: () => rands.DateTime(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          round: async () => await defineRoundFactory(db).create(),
          user: async () => await defineUserFactory(db).create(),
          submitted_entry: async () => await defineEntryFactory(db).create(),
        },
      },
      async (props) => await db.activityParticipation.create({ data: props }),
    )
    .props({
      round_id: async ({ vars }) => (await vars.round).id,
      user_id: async ({ vars }) => (await vars.user).id,
      submitted_entry_id: async ({ vars }) =>
        (await vars.submitted_entry)?.id ?? null,
    });
}

export function defineActivitySubmissionFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ActivitySubmissionUncheckedCreateInput,
      Prisma.Result<typeof db.activitySubmission, unknown, "create">,
      {
        round: Prisma.Result<typeof db.round, unknown, "create">;
        participation: Prisma.Result<
          typeof db.activityParticipation,
          unknown,
          "create"
        > | null;
        entry: Prisma.Result<typeof db.entry, unknown, "create">;
        user: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          round_id: () => rands.Int(),
          activity_participation_id: () => rands.Int(),
          entry_id: () => rands.Int(),
          user_id: () => rands.Int(),
          submitted_at: () => rands.DateTime(),
          superseded_at: () => rands.DateTime(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          round: async () => await defineRoundFactory(db).create(),
          participation: async () =>
            await defineActivityParticipationFactory(db).create(),
          entry: async () => await defineEntryFactory(db).create(),
          user: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.activitySubmission.create({ data: props }),
    )
    .props({
      round_id: async ({ vars }) => (await vars.round).id,
      activity_participation_id: async ({ vars }) =>
        (await vars.participation)?.id ?? null,
      entry_id: async ({ vars }) => (await vars.entry).id,
      user_id: async ({ vars }) => (await vars.user).id,
    });
}

export function defineActivityArtifactFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ActivityArtifactUncheckedCreateInput,
      Prisma.Result<typeof db.activityArtifact, unknown, "create">,
      {
        round: Prisma.Result<typeof db.round, unknown, "create">;
        user: Prisma.Result<typeof db.user, unknown, "create">;
        entry: Prisma.Result<typeof db.entry, unknown, "create">;
        source_artifact: Prisma.Result<
          typeof db.activityArtifact,
          unknown,
          "create"
        > | null;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          round_id: () => rands.Int(),
          user_id: () => rands.Int(),
          entry_id: () => rands.Int(),
          kind: () => rands.String(),
          status: () => rands.String(),
          source_artifact_id: () => rands.Int(),
          submitted_at: () => rands.DateTime(),
          removed_at: () => rands.DateTime(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          round: async () => await defineRoundFactory(db).create(),
          user: async () => await defineUserFactory(db).create(),
          entry: async () => await defineEntryFactory(db).create(),
          source_artifact: () => null,
        },
      },
      async (props) => await db.activityArtifact.create({ data: props }),
    )
    .props({
      round_id: async ({ vars }) => (await vars.round).id,
      user_id: async ({ vars }) => (await vars.user).id,
      entry_id: async ({ vars }) => (await vars.entry).id,
      source_artifact_id: async ({ vars }) =>
        (await vars.source_artifact)?.id ?? null,
    });
}

export function defineActivityOfferFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ActivityOfferUncheckedCreateInput,
      Prisma.Result<typeof db.activityOffer, unknown, "create">,
      {
        round: Prisma.Result<typeof db.round, unknown, "create">;
        user: Prisma.Result<typeof db.user, unknown, "create">;
        first_artifact: Prisma.Result<
          typeof db.activityArtifact,
          unknown,
          "create"
        >;
        second_artifact: Prisma.Result<
          typeof db.activityArtifact,
          unknown,
          "create"
        >;
        chosen_artifact: Prisma.Result<
          typeof db.activityArtifact,
          unknown,
          "create"
        > | null;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          round_id: () => rands.Int(),
          user_id: () => rands.Int(),
          first_artifact_id: () => rands.Int(),
          second_artifact_id: () => rands.Int(),
          chosen_artifact_id: () => rands.Int(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          round: async () => await defineRoundFactory(db).create(),
          user: async () => await defineUserFactory(db).create(),
          first_artifact: async () =>
            await defineActivityArtifactFactory(db).create(),
          second_artifact: async () =>
            await defineActivityArtifactFactory(db).create(),
          chosen_artifact: async () =>
            await defineActivityArtifactFactory(db).create(),
        },
      },
      async (props) => await db.activityOffer.create({ data: props }),
    )
    .props({
      round_id: async ({ vars }) => (await vars.round).id,
      user_id: async ({ vars }) => (await vars.user).id,
      first_artifact_id: async ({ vars }) => (await vars.first_artifact).id,
      second_artifact_id: async ({ vars }) => (await vars.second_artifact).id,
      chosen_artifact_id: async ({ vars }) =>
        (await vars.chosen_artifact)?.id ?? null,
    });
}

export function defineActivityModerationEventFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ActivityModerationEventUncheckedCreateInput,
      Prisma.Result<typeof db.activityModerationEvent, unknown, "create">,
      {
        round: Prisma.Result<typeof db.round, unknown, "create">;
        artifact: Prisma.Result<typeof db.activityArtifact, unknown, "create">;
        actor: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          round_id: () => rands.Int(),
          artifact_id: () => rands.Int(),
          actor_id: () => rands.Int(),
          action: () => rands.String(),
          note: () => rands.String(),
          notification_requested: () => rands.Boolean(),
          notification_status: () => rands.String(),
          created_at: () => rands.DateTime(),
        },
        vars: {
          round: async () => await defineRoundFactory(db).create(),
          artifact: async () =>
            await defineActivityArtifactFactory(db).create(),
          actor: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.activityModerationEvent.create({ data: props }),
    )
    .props({
      round_id: async ({ vars }) => (await vars.round).id,
      artifact_id: async ({ vars }) => (await vars.artifact).id,
      actor_id: async ({ vars }) => (await vars.actor).id,
    });
}

export function defineEntrySubjectFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.EntrySubjectUncheckedCreateInput,
      Prisma.Result<typeof db.entrySubject, unknown, "create">,
      { entry: Prisma.Result<typeof db.entry, unknown, "create"> }
    >(
      {
        props: {
          id: () => rands.Int(),
          entry_id: () => rands.Int(),
          subject_type: () => rands.String(),
          subject_id: () => rands.Int(),
          subject_key: () => rands.String(),
          source_node_id: () => rands.String(),
          metadata: () => rands.Json(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          entry: async () => await defineEntryFactory(db).create(),
        },
      },
      async (props) => await db.entrySubject.create({ data: props }),
    )
    .props({ entry_id: async ({ vars }) => (await vars.entry).id });
}

export function defineIntroductionFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.IntroductionUncheckedCreateInput,
      Prisma.Result<typeof db.introduction, unknown, "create">,
      {
        room: Prisma.Result<typeof db.room, unknown, "create">;
        created_by: Prisma.Result<typeof db.user, unknown, "create">;
        retracted_by: Prisma.Result<typeof db.user, unknown, "create"> | null;
        entry: Prisma.Result<typeof db.entry, unknown, "create"> | null;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          room_id: () => rands.Int(),
          created_by_id: () => rands.Int(),
          entry_id: () => rands.Int(),
          note: () => rands.String(),
          retracted_at: () => rands.DateTime(),
          retracted_by_id: () => rands.Int(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          room: async () => await defineRoomFactory(db).create(),
          created_by: async () => await defineUserFactory(db).create(),
          retracted_by: async () => await defineUserFactory(db).create(),
          entry: async () => await defineEntryFactory(db).create(),
        },
      },
      async (props) => await db.introduction.create({ data: props }),
    )
    .props({
      room_id: async ({ vars }) => (await vars.room).id,
      created_by_id: async ({ vars }) => (await vars.created_by).id,
      retracted_by_id: async ({ vars }) =>
        (await vars.retracted_by)?.id ?? null,
      entry_id: async ({ vars }) => (await vars.entry)?.id ?? null,
    });
}

export function defineIntroductionRecipientFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.IntroductionRecipientUncheckedCreateInput,
      Prisma.Result<typeof db.introductionRecipient, unknown, "create">,
      {
        introduction: Prisma.Result<typeof db.introduction, unknown, "create">;
        user: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          introduction_id: () => rands.Int(),
          user_id: () => rands.Int(),
          hidden_at: () => rands.DateTime(),
          seen_at: () => rands.DateTime(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          introduction: async () =>
            await defineIntroductionFactory(db).create(),
          user: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.introductionRecipient.create({ data: props }),
    )
    .props({
      introduction_id: async ({ vars }) => (await vars.introduction).id,
      user_id: async ({ vars }) => (await vars.user).id,
    });
}

export function defineLinkPreviewFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.LinkPreviewUncheckedCreateInput,
      Prisma.Result<typeof db.linkPreview, unknown, "create">
    >(
      {
        props: {
          id: () => rands.Int(),
          url: () => rands.String(),
          canonical_url: () => rands.String(),
          title: () => rands.String(),
          description: () => rands.String(),
          site_name: () => rands.String(),
          image_url: () => rands.String(),
          favicon_url: () => rands.String(),
          accent_color: () => rands.String(),
          status: () => rands.String(),
          error_code: () => rands.String(),
          fetched_at: () => rands.DateTime(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {},
      },
      async (props) => await db.linkPreview.create({ data: props }),
    )
    .props({});
}

export function defineLinkPreviewAttachmentFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.LinkPreviewAttachmentUncheckedCreateInput,
      Prisma.Result<typeof db.linkPreviewAttachment, unknown, "create">,
      {
        preview: Prisma.Result<typeof db.linkPreview, unknown, "create"> | null;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          owner_type: () => rands.String(),
          owner_id: () => rands.Int(),
          source_url: () => rands.String(),
          preview_id: () => rands.Int(),
          hidden: () => rands.Boolean(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          preview: async () => await defineLinkPreviewFactory(db).create(),
        },
      },
      async (props) => await db.linkPreviewAttachment.create({ data: props }),
    )
    .props({
      preview_id: async ({ vars }) => (await vars.preview)?.id ?? null,
    });
}

export function defineReplyFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ReplyUncheckedCreateInput,
      Prisma.Result<typeof db.reply, unknown, "create">,
      {
        user: Prisma.Result<typeof db.user, unknown, "create"> | null;
        entry: Prisma.Result<typeof db.entry, unknown, "create"> | null;
        chat_message: Prisma.Result<
          typeof db.chatMessage,
          unknown,
          "create"
        > | null;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          user_id: () => rands.Int(),
          entry_id: () => rands.Int(),
          chat_message_id: () => rands.Int(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
          status: () => rands.String(),
          published_at: () => rands.DateTime(),
          feedback_type: () => rands.String(),
        },
        vars: {
          user: async () => await defineUserFactory(db).create(),
          entry: async () => await defineEntryFactory(db).create(),
          chat_message: async () => await defineChatMessageFactory(db).create(),
        },
      },
      async (props) => await db.reply.create({ data: props }),
    )
    .props({
      user_id: async ({ vars }) => (await vars.user)?.id ?? null,
      entry_id: async ({ vars }) => (await vars.entry)?.id ?? null,
      chat_message_id: async ({ vars }) =>
        (await vars.chat_message)?.id ?? null,
    });
}

export function definePageFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.PageUncheckedCreateInput,
      Prisma.Result<typeof db.page, unknown, "create">,
      {
        pages: Prisma.Result<typeof db.page, unknown, "create"> | null;
        parent: Prisma.Result<typeof db.page, unknown, "create"> | null;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          title: () => rands.String(),
          icon: () => rands.String(),
          parent_note_id: () => rands.Int(),
          parent_id: () => rands.Int(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
          deleted_at: () => rands.DateTime(),
          room_id: () => rands.Int(),
        },
        vars: {
          pages: () => null,
          parent: () => null,
        },
      },
      async (props) => await db.page.create({ data: props }),
    )
    .props({
      parent_note_id: async ({ vars }) => (await vars.pages)?.id ?? null,
      parent_id: async ({ vars }) => (await vars.parent)?.id ?? null,
    });
}

export function defineDocumentFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.DocumentUncheckedCreateInput,
      Prisma.Result<typeof db.document, unknown, "create">
    >(
      {
        props: {
          id: () => rands.Int(),
          docable_type: () => rands.String(),
          docable_id: () => rands.Int(),
          content: () => rands.Json(),
          ydoc_state: () => rands.Bytes(),
          version: () => rands.Int(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {},
      },
      async (props) => await db.document.create({ data: props }),
    )
    .props({});
}

export function defineReflectionFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ReflectionUncheckedCreateInput,
      Prisma.Result<typeof db.reflection, unknown, "create">,
      {
        page: Prisma.Result<typeof db.page, unknown, "create">;
        users: Prisma.Result<typeof db.user, unknown, "create"> | null;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          page_id: () => rands.Int(),
          reflectable_type: () => rands.String(),
          reflectable_id: () => rands.Int(),
          user_id: () => rands.Int(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          page: async () => await definePageFactory(db).create(),
          users: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.reflection.create({ data: props }),
    )
    .props({
      page_id: async ({ vars }) => (await vars.page).id,
      user_id: async ({ vars }) => (await vars.users)?.id ?? null,
    });
}

export function defineInviteFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.InviteUncheckedCreateInput,
      Prisma.Result<typeof db.invite, unknown, "create">,
      {
        invited_by: Prisma.Result<typeof db.user, unknown, "create">;
        room: Prisma.Result<typeof db.room, unknown, "create"> | null;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          email: () => rands.String(),
          invite_type: () => rands.Int(),
          token: () => rands.String(),
          expires_at: () => rands.DateTime(),
          used_at: () => rands.DateTime(),
          invited_by_id: () => rands.Int(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
          room_id: () => rands.Int(),
        },
        vars: {
          invited_by: async () => await defineUserFactory(db).create(),
          room: async () => await defineRoomFactory(db).create(),
        },
      },
      async (props) => await db.invite.create({ data: props }),
    )
    .props({
      invited_by_id: async ({ vars }) => (await vars.invited_by).id,
      room_id: async ({ vars }) => (await vars.room)?.id ?? null,
    });
}

export function defineOneTimeTokenFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.OneTimeTokenUncheckedCreateInput,
      Prisma.Result<typeof db.oneTimeToken, unknown, "create">,
      {
        invite: Prisma.Result<typeof db.invite, unknown, "create"> | null;
        user: Prisma.Result<typeof db.user, unknown, "create"> | null;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          email: () => rands.String(),
          token: () => rands.String(),
          user_id: () => rands.Int(),
          invite_id: () => rands.Int(),
          purpose: () => rands.String(),
          expires_at: () => rands.DateTime(),
          consumed_at: () => rands.DateTime(),
          sent_at: () => rands.DateTime(),
          attempt_count: () => rands.Int(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          invite: async () => await defineInviteFactory(db).create(),
          user: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.oneTimeToken.create({ data: props }),
    )
    .props({
      invite_id: async ({ vars }) => (await vars.invite)?.id ?? null,
      user_id: async ({ vars }) => (await vars.user)?.id ?? null,
    });
}

export function defineNotificationEventFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.NotificationEventUncheckedCreateInput,
      Prisma.Result<typeof db.notificationEvent, unknown, "create">,
      {
        actor: Prisma.Result<typeof db.user, unknown, "create">;
        target_user: Prisma.Result<typeof db.user, unknown, "create"> | null;
        room: Prisma.Result<typeof db.room, unknown, "create">;
        entry: Prisma.Result<typeof db.entry, unknown, "create"> | null;
        reply: Prisma.Result<typeof db.reply, unknown, "create"> | null;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          event_type: () => rands.String(),
          actor_id: () => rands.Int(),
          room_id: () => rands.Int(),
          entry_id: () => rands.Int(),
          reply_id: () => rands.Int(),
          target_user_id: () => rands.Int(),
          payload: () => rands.Json(),
          target_path: () => rands.String(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          actor: async () => await defineUserFactory(db).create(),
          target_user: async () => await defineUserFactory(db).create(),
          room: async () => await defineRoomFactory(db).create(),
          entry: async () => await defineEntryFactory(db).create(),
          reply: async () => await defineReplyFactory(db).create(),
        },
      },
      async (props) => await db.notificationEvent.create({ data: props }),
    )
    .props({
      actor_id: async ({ vars }) => (await vars.actor).id,
      target_user_id: async ({ vars }) => (await vars.target_user)?.id ?? null,
      room_id: async ({ vars }) => (await vars.room).id,
      entry_id: async ({ vars }) => (await vars.entry)?.id ?? null,
      reply_id: async ({ vars }) => (await vars.reply)?.id ?? null,
    });
}

export function defineNotificationInboxItemFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.NotificationInboxItemUncheckedCreateInput,
      Prisma.Result<typeof db.notificationInboxItem, unknown, "create">,
      {
        user: Prisma.Result<typeof db.user, unknown, "create">;
        notification_event: Prisma.Result<
          typeof db.notificationEvent,
          unknown,
          "create"
        >;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          user_id: () => rands.Int(),
          notification_event_id: () => rands.Int(),
          delivery_state: () => rands.String(),
          delivered_at: () => rands.DateTime(),
          seen_at: () => rands.DateTime(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          user: async () => await defineUserFactory(db).create(),
          notification_event: async () =>
            await defineNotificationEventFactory(db).create(),
        },
      },
      async (props) => await db.notificationInboxItem.create({ data: props }),
    )
    .props({
      user_id: async ({ vars }) => (await vars.user).id,
      notification_event_id: async ({ vars }) =>
        (await vars.notification_event).id,
    });
}

export function defineNotificationPushDeliveryFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.NotificationPushDeliveryUncheckedCreateInput,
      Prisma.Result<typeof db.notificationPushDelivery, unknown, "create">,
      {
        notification_inbox_item: Prisma.Result<
          typeof db.notificationInboxItem,
          unknown,
          "create"
        >;
        notification_event: Prisma.Result<
          typeof db.notificationEvent,
          unknown,
          "create"
        >;
        user: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          notification_inbox_item_id: () => rands.Int(),
          notification_event_id: () => rands.Int(),
          user_id: () => rands.Int(),
          state: () => rands.String(),
          scheduled_job_id: () => rands.String(),
          due_at: () => rands.DateTime(),
          sent_at: () => rands.DateTime(),
          cancelled_at: () => rands.DateTime(),
          skip_reason: () => rands.String(),
          last_error: () => rands.String(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          notification_inbox_item: async () =>
            await defineNotificationInboxItemFactory(db).create(),
          notification_event: async () =>
            await defineNotificationEventFactory(db).create(),
          user: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) =>
        await db.notificationPushDelivery.create({ data: props }),
    )
    .props({
      notification_inbox_item_id: async ({ vars }) =>
        (await vars.notification_inbox_item).id,
      notification_event_id: async ({ vars }) =>
        (await vars.notification_event).id,
      user_id: async ({ vars }) => (await vars.user).id,
    });
}

export function defineNotificationPushDeviceAttemptFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.NotificationPushDeviceAttemptUncheckedCreateInput,
      Prisma.Result<typeof db.notificationPushDeviceAttempt, unknown, "create">,
      {
        delivery: Prisma.Result<
          typeof db.notificationPushDelivery,
          unknown,
          "create"
        >;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          delivery_id: () => rands.Int(),
          endpoint_hash: () => rands.String(),
          subscription_id: () => rands.Int(),
          state: () => rands.Enum(PushDeviceAttemptState),
          attempt_count: () => rands.Int(),
          started_at: () => rands.DateTime(),
          completed_at: () => rands.DateTime(),
          last_error: () => rands.String(),
        },
        vars: {
          delivery: async () =>
            await defineNotificationPushDeliveryFactory(db).create(),
        },
      },
      async (props) =>
        await db.notificationPushDeviceAttempt.create({ data: props }),
    )
    .props({ delivery_id: async ({ vars }) => (await vars.delivery).id });
}

export function defineNotificationPreferenceFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.NotificationPreferenceUncheckedCreateInput,
      Prisma.Result<typeof db.notificationPreference, unknown, "create">,
      { user: Prisma.Result<typeof db.user, unknown, "create"> }
    >(
      {
        props: {
          id: () => rands.Int(),
          user_id: () => rands.Int(),
          scope_type: () => rands.String(),
          scope_id: () => rands.Int(),
          notification_type: () => rands.String(),
          delivery_mode: () => rands.String(),
          push_enabled: () => rands.Boolean(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          user: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.notificationPreference.create({ data: props }),
    )
    .props({ user_id: async ({ vars }) => (await vars.user).id });
}

export function defineEntryViewStateFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.EntryViewStateUncheckedCreateInput,
      Prisma.Result<typeof db.entryViewState, unknown, "create">,
      {
        user: Prisma.Result<typeof db.user, unknown, "create">;
        entry: Prisma.Result<typeof db.entry, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          user_id: () => rands.Int(),
          entry_id: () => rands.Int(),
          entry_seen_at: () => rands.DateTime(),
          reply_seen_through_at: () => rands.DateTime(),
          reply_seen_through_id: () => rands.Int(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          user: async () => await defineUserFactory(db).create(),
          entry: async () => await defineEntryFactory(db).create(),
        },
      },
      async (props) => await db.entryViewState.create({ data: props }),
    )
    .props({
      user_id: async ({ vars }) => (await vars.user).id,
      entry_id: async ({ vars }) => (await vars.entry).id,
    });
}

export function defineUserNoticeCursorFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.UserNoticeCursorUncheckedCreateInput,
      Prisma.Result<typeof db.userNoticeCursor, unknown, "create">,
      { user: Prisma.Result<typeof db.user, unknown, "create"> }
    >(
      {
        props: {
          id: () => rands.Int(),
          user_id: () => rands.Int(),
          seen_through_at: () => rands.DateTime(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          user: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.userNoticeCursor.create({ data: props }),
    )
    .props({ user_id: async ({ vars }) => (await vars.user).id });
}

export function definePushSubscriptionFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.PushSubscriptionUncheckedCreateInput,
      Prisma.Result<typeof db.pushSubscription, unknown, "create">
    >(
      {
        props: {
          id: () => rands.Int(),
          endpoint: () => rands.String(),
          p256dh: () => rands.String(),
          auth: () => rands.String(),
          subscribed: () => rands.Boolean(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
          user_id: () => rands.Int(),
        },
        vars: {},
      },
      async (props) => await db.pushSubscription.create({ data: props }),
    )
    .props({});
}

export function defineRoleFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.RoleUncheckedCreateInput,
      Prisma.Result<typeof db.role, unknown, "create">,
      { user: Prisma.Result<typeof db.user, unknown, "create"> }
    >(
      {
        props: {
          id: () => rands.Int(),
          user_id: () => rands.Int(),
          name: () => rands.String(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          user: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.role.create({ data: props }),
    )
    .props({ user_id: async ({ vars }) => (await vars.user).id });
}

export function defineMediaProcessingAttemptFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.MediaProcessingAttemptUncheckedCreateInput,
      Prisma.Result<typeof db.mediaProcessingAttempt, unknown, "create">,
      { blob: Prisma.Result<typeof db.activeStorageBlob, unknown, "create"> }
    >(
      {
        props: {
          id: () => rands.String(),
          blob_id: () => rands.Int(),
          generation: () => rands.Int(),
          kind: () => rands.Enum(MediaProcessingKind),
          state: () => rands.Enum(MediaProcessingState),
          output_key: () => rands.String(),
          error: () => rands.String(),
          created_at: () => rands.DateTime(),
          finished_at: () => rands.DateTime(),
        },
        vars: {
          blob: async () => await defineActiveStorageBlobFactory(db).create(),
        },
      },
      async (props) => await db.mediaProcessingAttempt.create({ data: props }),
    )
    .props({ blob_id: async ({ vars }) => (await vars.blob).id });
}

export function defineActiveStorageBlobFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ActiveStorageBlobUncheckedCreateInput,
      Prisma.Result<typeof db.activeStorageBlob, unknown, "create">
    >(
      {
        props: {
          media_source_key: () => rands.String(),
          media_generation: () => rands.Int(),
          id: () => rands.Int(),
          key: () => rands.String(),
          filename: () => rands.String(),
          content_type: () => rands.String(),
          metadata: () => rands.String(),
          service_name: () => rands.String(),
          byte_size: () => rands.Int(),
          checksum: () => rands.String(),
          created_at: () => rands.DateTime(),
        },
        vars: {},
      },
      async (props) => await db.activeStorageBlob.create({ data: props }),
    )
    .props({});
}

export function defineActiveStorageAttachmentFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ActiveStorageAttachmentUncheckedCreateInput,
      Prisma.Result<typeof db.activeStorageAttachment, unknown, "create">,
      {
        active_storage_blobs: Prisma.Result<
          typeof db.activeStorageBlob,
          unknown,
          "create"
        >;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          name: () => rands.String(),
          record_type: () => rands.String(),
          record_id: () => rands.Int(),
          blob_id: () => rands.Int(),
          created_at: () => rands.DateTime(),
        },
        vars: {
          active_storage_blobs: async () =>
            await defineActiveStorageBlobFactory(db).create(),
        },
      },
      async (props) => await db.activeStorageAttachment.create({ data: props }),
    )
    .props({
      blob_id: async ({ vars }) => (await vars.active_storage_blobs).id,
    });
}

export function defineActiveStorageVariantRecordFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.ActiveStorageVariantRecordUncheckedCreateInput,
      Prisma.Result<typeof db.activeStorageVariantRecord, unknown, "create">,
      {
        active_storage_blobs: Prisma.Result<
          typeof db.activeStorageBlob,
          unknown,
          "create"
        >;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          blob_id: () => rands.Int(),
          variation_digest: () => rands.String(),
        },
        vars: {
          active_storage_blobs: async () =>
            await defineActiveStorageBlobFactory(db).create(),
        },
      },
      async (props) =>
        await db.activeStorageVariantRecord.create({ data: props }),
    )
    .props({
      blob_id: async ({ vars }) => (await vars.active_storage_blobs).id,
    });
}

export function defineAudioAssetFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.AudioAssetUncheckedCreateInput,
      Prisma.Result<typeof db.audioAsset, unknown, "create">,
      {
        blob: Prisma.Result<typeof db.activeStorageBlob, unknown, "create">;
        owner: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          blob_id: () => rands.Int(),
          owner_id: () => rands.Int(),
          source_type: () => rands.String(),
          source_id: () => rands.Int(),
          title: () => rands.String(),
          original_filename: () => rands.String(),
          original_mime_type: () => rands.String(),
          processing_status: () => rands.String(),
          duration_ms: () => rands.Int(),
          waveform_peaks: () => rands.Json(),
          error_message: () => rands.String(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          blob: async () => await defineActiveStorageBlobFactory(db).create(),
          owner: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.audioAsset.create({ data: props }),
    )
    .props({
      blob_id: async ({ vars }) => (await vars.blob).id,
      owner_id: async ({ vars }) => (await vars.owner).id,
    });
}

export function defineVideoAssetFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.VideoAssetUncheckedCreateInput,
      Prisma.Result<typeof db.videoAsset, unknown, "create">,
      {
        blob: Prisma.Result<typeof db.activeStorageBlob, unknown, "create">;
        owner: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          blob_id: () => rands.Int(),
          owner_id: () => rands.Int(),
          source_type: () => rands.String(),
          source_id: () => rands.Int(),
          title: () => rands.String(),
          original_filename: () => rands.String(),
          original_mime_type: () => rands.String(),
          processing_status: () => rands.String(),
          duration_ms: () => rands.Int(),
          width: () => rands.Int(),
          height: () => rands.Int(),
          error_message: () => rands.String(),
          created_at: () => rands.DateTime(),
          updated_at: () => rands.DateTime(),
        },
        vars: {
          blob: async () => await defineActiveStorageBlobFactory(db).create(),
          owner: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.videoAsset.create({ data: props }),
    )
    .props({
      blob_id: async ({ vars }) => (await vars.blob).id,
      owner_id: async ({ vars }) => (await vars.owner).id,
    });
}

export function defineAudioAnnotationFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.AudioAnnotationUncheckedCreateInput,
      Prisma.Result<typeof db.audioAnnotation, unknown, "create">,
      {
        audio_asset: Prisma.Result<typeof db.audioAsset, unknown, "create">;
        reply: Prisma.Result<typeof db.reply, unknown, "create">;
        created_by: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          id: () => rands.Int(),
          audio_asset_id: () => rands.Int(),
          reply_id: () => rands.Int(),
          anchor_ms: () => rands.Int(),
          tolerance_ms: () => rands.Int(),
          created_by_id: () => rands.Int(),
          created_at: () => rands.DateTime(),
        },
        vars: {
          audio_asset: async () => await defineAudioAssetFactory(db).create(),
          reply: async () => await defineReplyFactory(db).create(),
          created_by: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.audioAnnotation.create({ data: props }),
    )
    .props({
      audio_asset_id: async ({ vars }) => (await vars.audio_asset).id,
      reply_id: async ({ vars }) => (await vars.reply).id,
      created_by_id: async ({ vars }) => (await vars.created_by).id,
    });
}

export function defineRoomVisitFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.RoomVisitUncheckedCreateInput,
      Prisma.Result<typeof db.roomVisit, unknown, "create">,
      {
        room: Prisma.Result<typeof db.room, unknown, "create">;
        user: Prisma.Result<typeof db.user, unknown, "create">;
      }
    >(
      {
        props: {
          room_id: () => rands.Int(),
          user_id: () => rands.Int(),
          source: () => rands.String(),
          last_activity_at: () => rands.DateTime(),
          expires_at: () => rands.DateTime(),
          created_at: () => rands.DateTime(),
        },
        vars: {
          room: async () => await defineRoomFactory(db).create(),
          user: async () => await defineUserFactory(db).create(),
        },
      },
      async (props) => await db.roomVisit.create({ data: props }),
    )
    .props({
      room_id: async ({ vars }) => (await vars.room).id,
      user_id: async ({ vars }) => (await vars.user).id,
    });
}

export function defineQueueWorkerHeartbeatFactory(db: PrismaClient) {
  return factory
    .define<
      Prisma.QueueWorkerHeartbeatUncheckedCreateInput,
      Prisma.Result<typeof db.queueWorkerHeartbeat, unknown, "create">
    >(
      {
        props: {
          instance_id: () => rands.String(),
          seen_at: () => rands.DateTime(),
        },
        vars: {},
      },
      async (props) => await db.queueWorkerHeartbeat.create({ data: props }),
    )
    .props({});
}
