import { WorkerHealthModule } from "./worker-health.module"
import { InviteEmailProcessor } from "../mailer/invite-email.processor"
import { MailerModule } from "../mailer/mailer.module"
import { AudioSpectrumProcessor } from "../uploads/audio/audio-spectrum.processor"
import { Module } from "@nestjs/common"
import { NotificationsDomainModule } from "../notifications/notifications.module"
import { PrismaModule } from "../prisma/prisma.module"
import { RealtimeModule } from "../realtime/realtime.module"
import { RoundsModule } from "../api/v1/rounds/rounds.module"
import { StorageModule } from "../storage/storage.module"
import { AudioProcessor } from "../uploads/audio/audio.processor"
import { ImageVariantProcessor } from "../uploads/images/image-variant.processor"
import { ImagesModule } from "../uploads/images/images.module"
import { VideoProcessor } from "../uploads/video/video.processor"
import { BossModule } from "./boss.module"
import { BossWorkers } from "./boss.workers"

@Module({
  imports: [WorkerHealthModule, MailerModule, BossModule, PrismaModule, RealtimeModule, StorageModule, NotificationsDomainModule, RoundsModule, ImagesModule],
  providers: [InviteEmailProcessor, AudioSpectrumProcessor, BossWorkers, ImageVariantProcessor, AudioProcessor, VideoProcessor],
})
export class BossWorkerModule {}
