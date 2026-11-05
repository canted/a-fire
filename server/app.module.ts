import { AgentConnectionsModule } from "./api/v1/agent-connections/agent-connections.module"
import { Module } from "@nestjs/common"
import { HealthModule } from "./api/v1/health/health.module"
import { AuthModule } from "./api/v1/auth/auth.module"
import { RoomsModule } from "./api/v1/rooms/rooms.module"
import { BoardsModule } from "./api/v1/boards/boards.module"
import { EntriesModule } from "./api/v1/entries/entries.module"
import { PagesModule } from "./api/v1/pages/pages.module"
import { RepliesModule } from "./api/v1/replies/replies.module"
import { ReflectionsModule } from "./api/v1/reflections/reflections.module"
import { InvitesModule } from "./api/v1/invites/invites.module"
import { NotificationsModule } from "./api/v1/notifications/notifications.module"
import { InboxModule } from "./api/v1/inbox/inbox.module"
import { UnseenModule } from "./api/v1/unseen/unseen.module"
import { IntroductionsModule } from "./api/v1/introductions/introductions.module"
import { RoomMemberProfilesModule } from "./api/v1/rooms/room-member-profiles.module"
import { MembershipsModule } from "./api/v1/memberships/memberships.module"
import { MentionsModule } from "./api/v1/mentions/mentions.module"
import { UploadsModule } from "./api/v1/uploads/uploads.module"
import { AudioAssetsModule } from "./api/v1/audio-assets/audio-assets.module"
import { VideoAssetsModule } from "./api/v1/video-assets/video-assets.module"
import { LinkPreviewsModule } from "./api/v1/link-previews/link-previews.module"
import { RoundsModule } from "./api/v1/rounds/rounds.module"
import { ProjectsModule } from "./api/v1/projects/projects.module"
import { ProfileModule } from "./api/profile/profile.module"
import { NotificationPreferencesModule } from "./api/notification-preferences/notification-preferences.module"
import { PushSubscriptionsModule } from "./api/push-subscriptions/push-subscriptions.module"
import { V2RoomsModule } from "./api/v2/rooms/rooms.module"
import { V2NotesModule } from "./api/v2/notes/notes.module"
import { V2ProfileModule } from "./api/v2/profile/profile.module"
import { V2NotificationPreferencesModule } from "./api/v2/notification-preferences/notification-preferences.module"
import { V2PushSubscriptionsModule } from "./api/v2/push-subscriptions/push-subscriptions.module"
import { BossModule } from "./queue/boss.module"
import { PrismaModule } from "./prisma/prisma.module"
import { RealtimeModule } from "./realtime/realtime.module"

@Module({
  imports: [
    PrismaModule,
    AgentConnectionsModule,
    BossModule,
    RealtimeModule,
    HealthModule,
    AuthModule,
    RoomsModule,
    BoardsModule,
    EntriesModule,
    PagesModule,
    RoomMemberProfilesModule,
    RepliesModule,
    ReflectionsModule,
    InvitesModule,
    MembershipsModule,
    MentionsModule,
    NotificationsModule,
    InboxModule,
    UnseenModule,
    IntroductionsModule,
    UploadsModule,
    AudioAssetsModule,
    VideoAssetsModule,
    LinkPreviewsModule,
    RoundsModule,
    ProjectsModule,
    ProfileModule,
    NotificationPreferencesModule,
    PushSubscriptionsModule,
    V2RoomsModule,
    V2NotesModule,
    V2ProfileModule,
    V2NotificationPreferencesModule,
    V2PushSubscriptionsModule,
  ],
})
export class AppModule {}
