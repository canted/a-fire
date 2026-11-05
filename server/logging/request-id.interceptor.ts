import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { Observable } from "rxjs"

const HEADER_NAME = "x-request-id"

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest()
    const response = context.switchToHttp().getResponse()

    const headerValue = typeof request?.headers?.[HEADER_NAME] === "string"
      ? request.headers[HEADER_NAME]
      : undefined
    const requestId = headerValue?.trim() || randomUUID()

    if (response?.setHeader) {
      response.setHeader(HEADER_NAME, requestId)
    }

    request.requestId = requestId

    return next.handle()
  }
}
