import { ReadableStream } from 'node:stream/web';
import { SessionTransport, type Tokens, type SessionStorage } from '../../../../frontend/src/lib/api/transport';
import { fetchLiveRoomPage, mergeRoomMessages, type RoomMessage, type RoomPage } from '../../../../frontend/src/lib/api/room';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function setup() {
  let tokens: Tokens | null = { accessToken: '', refreshToken: 'refresh-1' };
  const storage: SessionStorage = { read: async () => tokens, write: async value => { tokens = value; } };
  return { storage, client: new SessionTransport('https://example.test/api', storage) };
}
afterEach(() => vi.unstubAllGlobals());
it('shares refresh rotation across clients using the same storage and API', async () => {
  const { client, storage } = setup();
  const fetcher = vi.fn(async () => json({ accessToken: 'new', refreshToken: 'rotated' }));
  vi.stubGlobal('fetch', fetcher);
  await Promise.all([client.getAccessToken(), new SessionTransport('https://example.test/api', storage).getAccessToken()]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await storage.read()).toEqual({ accessToken: 'new', refreshToken: 'rotated' });
});
it('preserves tokens when refresh fails temporarily', async () => {
  const { client, storage } = setup();
  vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'Try later' }, 503)));
  await expect(client.getAccessToken()).rejects.toMatchObject({ status: 503 });
  expect((await storage.read())?.refreshToken).toBe('refresh-1');
});
it('clears rejected refresh tokens', async () => {
  const { client, storage } = setup();
  vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'Expired' }, 401)));
  await expect(client.getAccessToken()).rejects.toMatchObject({ status: 401 });
  expect(await storage.read()).toBeNull();
});
it('cannot resurrect a session when logout overtakes a refresh', async () => {
  const { client, storage } = setup();
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const pending = client.getAccessToken();
  const assertion = expect(pending).rejects.toMatchObject({ status: 401 });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await client.setSession(null);
  finish(json({ accessToken: 'late', refreshToken: 'late' }));
  await assertion;
  expect(await storage.read()).toBeNull();
});
it('does not refresh a stale session before public OTP verification', async () => {
  const { client } = setup();
  const fetcher = vi.fn(async (_url: RequestInfo | URL) => json({ accessToken: 'new', refreshToken: 'new' }));
  vi.stubGlobal('fetch', fetcher);
  await client.post('/v1/auth/verify_otp', { email: 'test@example.test', token: '123456' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('https://example.test/api/v1/auth/verify_otp');
});
const message = (id: number) => ({ id, body: String(id) }) as RoomMessage;
it('catches up through more than one page without skipping a burst', async () => {
  const client = { get: vi.fn().mockResolvedValueOnce({ messages: [message(51)], next_cursor: 51 }).mockResolvedValueOnce({ messages: [message(52)], next_cursor: null }), post: vi.fn() };
  const page = await fetchLiveRoomPage(client, 1, { messages: [message(1)], next_cursor: null, viewer_user_id: 1, liveStartId: 1, historyCursor: 0 });
  expect(client.get.mock.calls.map(call => call[0])).toEqual(['/v2/rooms/1/chat/messages?after=0&limit=100', '/v2/rooms/1/chat/messages?after=51&limit=100']);
  expect(page.messages.map(item => item.id)).toEqual([51, 52]);
  expect(page.historyCursor).toBe(0);
});
it('deduplicates historical/live overlap with the current version winning', () => {
  const pages = [{ messages: [message(2), message(1)] }, { messages: [{ ...message(2), body: 'edited' }] }] as RoomPage[];
  expect(mergeRoomMessages(pages).map(item => item.body)).toEqual(['1', 'edited']);
});
it('forwards cancellation through streamed response consumption', async () => {
  const { client } = setup();
  await client.setSession({ accessToken: 'valid', refreshToken: 'refresh' });
  const controller = new AbortController();
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal('fetch', vi.fn(async (_url, options: RequestInit) => {
    signal = options.signal;
    return new Response(new ReadableStream({
      start(stream) { signal?.addEventListener('abort', () => stream.error(new Error('cancelled'))); },
    }) as unknown as BodyInit);
  }));
  const request = client.getBlob('/file', { signal: controller.signal });
  const assertion = expect(request).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(signal).toBe(controller.signal));
  controller.abort();
  await assertion;
});
it('preserves the signed-in identity when accepting an invitation', async () => {
  const { client } = setup();
  await client.setSession({ accessToken: 'existing-viewer', refreshToken: 'refresh' });
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => json({ success: true }));
  vi.stubGlobal('fetch', fetcher);
  await client.post('/v1/auth/invites/accept', { token: 'invite' });
  expect(fetcher).toHaveBeenCalledWith('https://example.test/api/v1/auth/invites/accept', expect.objectContaining({
    headers: expect.objectContaining({ Authorization: 'Bearer existing-viewer' }),
  }));
});

it.each(['text', 'blob'] as const)('rejects private %s content when sign-out occurs during body consumption', async (kind) => {
  const { client } = setup();
  await client.setSession({ accessToken: 'valid', refreshToken: 'refresh' });
  let finish!: () => void;
  const response = json({ title: 'Private source entry' });
  if (kind === 'text') vi.spyOn(response, 'text').mockImplementation(() => new Promise(resolve => { finish = () => resolve('{"title":"Private source entry"}'); }));
  else vi.spyOn(response, 'blob').mockImplementation(() => new Promise(resolve => { finish = () => resolve(new Blob(['private media'])); }));
  vi.stubGlobal('fetch', vi.fn(async () => response));
  const pending = kind === 'text' ? client.get('/v1/projects/347/entries/5958') : client.getBlob('/private-media');
  const assertion = expect(pending).rejects.toMatchObject({ status: 401 });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await client.setSession(null);
  finish();
  await assertion;
});

const identityTokens = (sub: string, revision: string): Tokens => ({
  accessToken: `header.${btoa(JSON.stringify({ sub, exp: 1, revision }))}.signature`,
  refreshToken: revision,
});

it('serializes independent storage adapters and reuses the successor after acquiring the lock', async () => {
  let stored: Tokens | null = identityTokens('alice', 'original');
  let queue = Promise.resolve();
  const adapter = (): SessionStorage => ({
    read: async () => stored,
    write: async value => { stored = value; },
    withLock<T>(operation: () => Promise<T>) {
      const pending = queue.then(operation);
      queue = pending.then(() => {}, () => {});
      return pending;
    },
  });
  const successor = identityTokens('alice', 'successor');
  const fetcher = vi.fn(async () => json(successor));
  vi.stubGlobal('fetch', fetcher);
  const clients = [new SessionTransport('/api', adapter()), new SessionTransport('/api', adapter())];
  expect(await Promise.all(clients.map(client => client.getAccessToken()))).toEqual([successor.accessToken, successor.accessToken]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(stored).toEqual(successor);
});

it.each(['alice', 'bob'])('preserves a newer %s session when an unlocked older refresh is rejected', async subject => {
  let stored: Tokens | null = identityTokens('alice', 'original');
  const storage: SessionStorage = { read: async () => stored, write: async value => { stored = value; } };
  const client = new SessionTransport('/api', storage);
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const pending = client.getAccessToken();
  const assertion = subject === 'alice'
    ? expect(pending).resolves.toBe(identityTokens(subject, 'newer').accessToken)
    : expect(pending).rejects.toMatchObject({ status: 401 });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  stored = identityTokens(subject, 'newer');
  finish(json({ message: 'Already rotated' }, 401));
  await assertion;
  expect(stored).toEqual(identityTokens(subject, 'newer'));
});

it('aborts a stalled refresh so local logout can acquire the session lock', async () => {
  let stored: Tokens | null = identityTokens('alice', 'original');
  let queue = Promise.resolve();
  const storage: SessionStorage = {
    read: async () => stored,
    write: async value => { stored = value; },
    withLock<T>(operation: () => Promise<T>) {
      const pending = queue.then(operation);
      queue = pending.then(() => {}, () => {});
      return pending;
    },
  };
  let started = false;
  vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    started = true;
    options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  })));
  const client = new SessionTransport('/api', storage);
  const pending = client.getAccessToken();
  const assertion = expect(pending).rejects.toMatchObject({ status: 401 });
  await vi.waitFor(() => expect(started).toBe(true));
  await client.setSession(null);
  await assertion;
  expect(stored).toBeNull();
});
