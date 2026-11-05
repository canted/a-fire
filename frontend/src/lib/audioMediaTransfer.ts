import type { ApiRequestOptions } from './api/transport';
type Client = { getBlob: (url: string, options?: ApiRequestOptions) => Promise<Blob> };
// Share concurrent work only, partitioned by client and authentication identity.
// Neither settled bytes nor failed promises survive the transfer.
const pendingTransfers = new WeakMap<Client, Map<string, Promise<Blob>>>();
export function loadAudioMediaBlob(client: Client, session: string, url: string, options?: ApiRequestOptions): Promise<Blob> {
  let pending = pendingTransfers.get(client);
  if (!pending) { pending = new Map(); pendingTransfers.set(client, pending); }
  const key = `${session}:${url}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const transfer = (url.startsWith('blob:')
    ? fetch(url).then(response => { if (!response.ok) throw new Error('Recording unavailable.'); return response.blob(); })
    : options ? client.getBlob(url, options) : client.getBlob(url)).finally(() => { if (pending!.get(key) === transfer) pending!.delete(key); });
  pending.set(key, transfer);
  return transfer;
}
