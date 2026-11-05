import { BadRequestException, Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common"
import type { Request } from "express"
import { AuthGuard, RequestWithUser } from "../../v1/auth/auth.guard"
import { PushSubscriptionsService } from "../../push-subscriptions/push-subscriptions.service"

type CreatePayload = {
  endpoint?: string
  p256dh?: string
  auth?: string
}

type UnsubscribePayload = {
  endpoint?: string
}

@Controller("api/v2/push-subscriptions")
@UseGuards(AuthGuard)
export class V2PushSubscriptionsController {
  @Inject(PushSubscriptionsService)
  private readonly pushSubscriptions!: PushSubscriptionsService

  @Post()
  async create(@Req() request: Request, @Body() payload: CreatePayload): Promise<void> {
    const userId = (request as RequestWithUser).user?.id ?? 0
    if (!payload.endpoint || !payload.p256dh || !payload.auth) {
      throw new BadRequestException("Invalid subscription payload")
    }

    await this.pushSubscriptions.upsertSubscription(userId, payload.endpoint, payload.p256dh, payload.auth)
  }

  @Post("unsubscribe")
  async unsubscribe(@Req() request: Request, @Body() payload: UnsubscribePayload): Promise<void> {
    const userId = (request as RequestWithUser).user?.id ?? 0
    await this.pushSubscriptions.unsubscribe(userId, payload.endpoint)
  }
}
