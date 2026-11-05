import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, throwError } from "rxjs";
import { catchError, tap } from "rxjs/operators";
import { capturePosthogException } from "../runtime/posthog";

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = Date.now();
    const request = context.switchToHttp().getRequest();
    const method = request?.method;
    const url = request?.originalUrl || request?.url;
    const requestId = request?.requestId;
    const sessionId = request?.sessionId ?? requestHeader(request, "x-posthog-session-id");

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        const status = response?.statusCode;
        const durationMs = Date.now() - start;
        // Structured log for ingestion (stdout-friendly).
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            event: "http_request",
            method,
            path: url,
            request_id: requestId,
            session_id: sessionId,
            status,
            duration_ms: durationMs,
          }),
        );
      }),
      catchError((error) => {
        const durationMs = Date.now() - start;
        const status =
          error instanceof HttpException
            ? error.getStatus()
            : typeof error?.status === "number"
              ? error.status
              : 500;
        console.error(
          JSON.stringify({
            event: "http_error",
            method,
            path: url,
            request_id: requestId,
            session_id: sessionId,
            status,
            duration_ms: durationMs,
            message: error?.message ?? "Unknown error",
            stack: error?.stack,
          }),
        );
        if (status >= 500) {
          capturePosthogException({
            error,
            distinctId: requestDistinctId(request),
            properties: {
              method,
              path: url,
              request_id: requestId,
              session_id: sessionId,
              status,
              duration_ms: durationMs,
            },
          });
        }
        return throwError(() => error);
      }),
    );
  }
}

function requestDistinctId(request: any): string | number {
  return request?.user?.id ?? request?.user?.sub ?? requestHeader(request, "x-posthog-distinct-id") ?? "server";
}

function requestHeader(request: any, name: string): string | undefined {
  const value = request?.headers?.[name] ?? request?.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" ? value : undefined;
}
