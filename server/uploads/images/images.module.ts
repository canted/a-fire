import { Module } from "@nestjs/common"
import { PrismaModule } from "../../prisma/prisma.module"
import { StorageModule } from "../../storage/storage.module"
import { ImageVariantsService } from "./image-variants.service"

@Module({ imports: [PrismaModule, StorageModule], providers: [ImageVariantsService], exports: [ImageVariantsService] })
export class ImagesModule {}
