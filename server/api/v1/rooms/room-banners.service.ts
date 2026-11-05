import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { uploadVariantUrl } from "../uploads/upload-urls";

export const DEFAULT_FIRST_POST_PROMPT = "Share what's up";

const MAX_FIRST_POST_PROMPT_LENGTH = 140;
const FIRST_POST_BANNER_KIND = "first_post";
const BOARD_HEADER_PLACEMENT = "board_header";
const COMMUNITY_AUDIENCE = "community";
const UNTIL_FIRST_POST_VISIBILITY = "until_first_post";
const CREATE_POST_ACTION = "create_post";

export type RoomPromptMemberPayload = {
  id: number;
  user_id: number;
  display_username: string;
  display_avatar_url: string | null;
  avatar_url: string | null;
  first_entry_prompt_override: string | null;
  effective_first_entry_prompt: string;
};

export type RoomFirstEntryPromptsPayload = {
  default_prompt: string;
  room_prompt: string | null;
  effective_room_prompt: string;
  members: RoomPromptMemberPayload[];
};

export type UpdateRoomFirstEntryPromptsInput = {
  roomPrompt?: string | null;
  memberPrompts?: Array<{
    membershipId: number;
    prompt?: string | null;
  }>;
};

@Injectable()
export class RoomBannersService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService;

  async listFirstPostPrompts(communityId: number, userId: number): Promise<RoomFirstEntryPromptsPayload> {
    const community = await this.ensureOwnedCommunity(communityId, userId);
    const banner = await this.findFirstPostBanner(community.id);
    const members = await this.prisma.roomMembership.findMany({
      where: { room_id: community.id, disabled: false },
      include: { user: true },
      orderBy: { id: "asc" },
    });

    const userIds = members
      .map((member) => this.toId(member.user_id))
      .filter((value): value is number => Boolean(value));
    const avatarMap = await this.avatarMap(userIds);
    const targetByUserId = new Map((banner?.targets ?? []).map((target) => [this.toId(target.user_id), target]));
    const roomPrompt = this.storedPrompt(banner?.message);
    const effectiveRoomPrompt = roomPrompt ?? DEFAULT_FIRST_POST_PROMPT;

    return {
      default_prompt: DEFAULT_FIRST_POST_PROMPT,
      room_prompt: roomPrompt,
      effective_room_prompt: effectiveRoomPrompt,
      members: members
        .map((member) => {
          const override = this.storedPrompt(targetByUserId.get(this.toId(member.user_id))?.message_override);
          const avatarUrl = avatarMap.get(String(member.user_id)) ?? null;

          return {
            id: this.toId(member.id),
            user_id: this.toId(member.user_id),
            display_username: member.username_override || member.user?.username || "user",
            display_avatar_url: avatarUrl,
            avatar_url: avatarUrl,
            first_entry_prompt_override: override,
            effective_first_entry_prompt: override ?? effectiveRoomPrompt,
          };
        })
        .sort((a, b) => {
          const aOverridden = a.first_entry_prompt_override ? 0 : 1;
          const bOverridden = b.first_entry_prompt_override ? 0 : 1;
          return aOverridden - bOverridden || a.display_username.localeCompare(b.display_username);
        }),
    };
  }

  async updateFirstPostPrompts(
    communityId: number,
    userId: number,
    input: UpdateRoomFirstEntryPromptsInput,
  ): Promise<RoomFirstEntryPromptsPayload> {
    const community = await this.ensureOwnedCommunity(communityId, userId);
    const now = new Date();
    let banner = await this.findFirstPostBanner(community.id);

    const roomPrompt = this.normalizePrompt(input.roomPrompt);
    const memberPrompts = input.memberPrompts ?? [];

    if (roomPrompt !== undefined && (banner || roomPrompt !== null || memberPrompts.length > 0)) {
      banner = banner ?? (await this.createFirstPostBanner(community.id, userId, now));
      await this.prisma.roomBanner.update({
        where: { id: banner.id },
        data: { message: roomPrompt, updated_at: now },
      });
    }

    if (memberPrompts.length > 0) {
      const normalized = memberPrompts.map((item) => ({
        membershipId: this.toId(item.membershipId),
        prompt: this.normalizePrompt(item.prompt),
      }));
      const membershipIds = Array.from(new Set(normalized.map((item) => item.membershipId).filter(Boolean)));

      if (membershipIds.length !== normalized.length) {
        throw new BadRequestException("Invalid member prompt payload");
      }

      const memberships = await this.prisma.roomMembership.findMany({
        where: { id: { in: membershipIds }, room_id: community.id, disabled: false },
        select: { id: true, user_id: true },
      });
      if (memberships.length !== membershipIds.length) {
        throw new BadRequestException("Invalid member prompt payload");
      }
      const membershipById = new Map(memberships.map((membership) => [this.toId(membership.id), membership]));
      banner = banner ?? (await this.createFirstPostBanner(community.id, userId, now));
      const activeBanner = banner;

      await Promise.all(
        normalized.map((item) => {
          const membership = membershipById.get(item.membershipId);
          if (!membership) throw new BadRequestException("Invalid member prompt payload");
          const memberUserId = this.toId(membership.user_id);

          if (item.prompt) {
            return this.prisma.roomBannerTarget.upsert({
              where: { room_banner_id_user_id: { room_banner_id: activeBanner.id, user_id: memberUserId } },
              create: {
                room_banner_id: activeBanner.id,
                user_id: memberUserId,
                message_override: item.prompt,
                created_at: now,
                updated_at: now,
              },
              update: { message_override: item.prompt, updated_at: now },
            });
          }

          return this.prisma.roomBannerTarget.updateMany({
            where: { room_banner_id: activeBanner.id, user_id: memberUserId },
            data: { message_override: null, updated_at: now },
          });
        }),
      );
    }

    return this.listFirstPostPrompts(community.id, userId);
  }

  async resolveFirstPostPrompt(communityId: number, userId: number): Promise<string> {
    const banner = await this.prisma.roomBanner.findFirst({
      where: this.firstPostBannerWhere(communityId),
      include: { targets: { where: { user_id: this.toId(userId) }, take: 1 } },
      orderBy: { id: "asc" },
    });

    return (
      this.storedPrompt(banner?.targets?.[0]?.message_override) ??
      this.storedPrompt(banner?.message) ??
      DEFAULT_FIRST_POST_PROMPT
    );
  }

  private async ensureOwnedCommunity(communityId: number, userId: number) {
    const community = await this.prisma.room.findUnique({
      where: { id: this.toId(communityId), deleted_at: null },
      select: { id: true, owner_id: true },
    });
    if (!community) throw new NotFoundException("Not Found");
    if (community.owner_id !== this.toId(userId)) throw new ForbiddenException("Forbidden");
    return community;
  }

  private findFirstPostBanner(communityId: number) {
    return this.prisma.roomBanner.findFirst({
      where: this.firstPostBannerWhere(communityId),
      include: { targets: true },
      orderBy: { id: "asc" },
    });
  }

  private createFirstPostBanner(communityId: number, userId: number, now: Date) {
    return this.prisma.roomBanner.create({
      data: {
        room_id: communityId,
        created_by_id: this.toId(userId),
        kind: FIRST_POST_BANNER_KIND,
        placement: BOARD_HEADER_PLACEMENT,
        audience_type: COMMUNITY_AUDIENCE,
        visibility_rule: UNTIL_FIRST_POST_VISIBILITY,
        action_type: CREATE_POST_ACTION,
        message: null,
        metadata: {},
        created_at: now,
        updated_at: now,
      },
      include: { targets: true },
    });
  }

  private firstPostBannerWhere(communityId: number) {
    return {
      room_id: this.toId(communityId),
      kind: FIRST_POST_BANNER_KIND,
      placement: BOARD_HEADER_PLACEMENT,
      archived_at: null,
    };
  }

  private async avatarMap(userIds: number[]) {
    if (userIds.length === 0) return new Map<string, string>();
    const attachments = this.prisma.activeStorageAttachment?.findMany
      ? await this.prisma.activeStorageAttachment.findMany({
          where: { record_type: "User", record_id: { in: userIds }, name: "avatar" },
          orderBy: { created_at: "desc" },
        })
      : [];

    const map = new Map<string, string>();
    attachments.forEach((attachment) => {
      const key = String(attachment.record_id);
      if (!map.has(key)) {
        map.set(key, uploadVariantUrl(`/api/v1/uploads/${String(attachment.blob_id)}`, "avatarStripe40") ?? "");
      }
    });
    return map;
  }

  private normalizePrompt(value: string | null | undefined) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const prompt = value.trim();
    if (!prompt) return null;
    if (prompt.length > MAX_FIRST_POST_PROMPT_LENGTH) {
      throw new BadRequestException(`Prompt must be ${MAX_FIRST_POST_PROMPT_LENGTH} characters or fewer`);
    }
    return prompt;
  }

  private storedPrompt(value: string | null | undefined) {
    const prompt = value?.trim();
    return prompt || null;
  }

  private toId(value: number | string | null | undefined): number {
    if (value === null || value === undefined) return 0;
    return typeof value === "number" ? value : Number(value);
  }
}
