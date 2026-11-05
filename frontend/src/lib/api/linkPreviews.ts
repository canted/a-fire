import type { SessionTransport } from "./transport";
import type { LinkPreview } from "../../contracts/linkPreviews";
export function resolveLinkPreview(client: Pick<SessionTransport, "post">, url: string) {
  return client.post<LinkPreview>("/v1/link-previews/resolve", { url });
}
