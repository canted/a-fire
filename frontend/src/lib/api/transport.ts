// Portable transport. Platform adapters own persistence, navigation and media cookies.
export type Tokens = { accessToken: string; refreshToken: string };
export interface SessionStorage {
  read(): Promise<Tokens | null>;
  write(tokens: Tokens | null): Promise<void>;
  withLock?<T>(operation: () => Promise<T>): Promise<T>;
  subscribe?(listener: (tokens: Tokens | null, reset: boolean) => void): () => void;
}
export type ApiRequestOptions = Omit<RequestInit, 'body' | 'method'> & { body?: unknown };
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export function tokenNeedsRefresh(token: string): boolean {
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    return typeof exp === 'number' && exp - Date.now() / 1000 <= 600;
  } catch { return false; }
}

// Identity is used only to prevent session mixing, never to authorize a request.
export function sessionSubject(tokens: Tokens | null): string | null {
  try {
    const encoded = tokens!.accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const value = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))).sub;
    return typeof value === 'string' ? value : null;
  } catch { return null; }
}

type Coordinator = { refreshAbort?: AbortController; refreshPromise: Promise<string | null> | null; generation: number; writes: Promise<void> };
const coordinators = new WeakMap<SessionStorage, Map<string, Coordinator>>();
export class SessionTransport {
  private readonly state: Coordinator;
  constructor(
    private readonly baseUrl: string,
    private readonly storage: SessionStorage,
    private readonly changed: (tokens: Tokens | null, reset: boolean) => void = () => {},
  ) {
    let origins = coordinators.get(storage);
    if (!origins) { origins = new Map(); coordinators.set(storage, origins); }
    let state = origins.get(baseUrl);
    if (!state) { state = { refreshPromise: null, generation: 0, writes: Promise.resolve() }; origins.set(baseUrl, state); }
    this.state = state;
  }

  async setSession(tokens: Tokens | null) {
    this.state.refreshAbort?.abort();
    this.state.generation++;
    this.state.refreshPromise = null;
    await this.withLock(() => this.persist(tokens, true));
  }
  observeExternalSession() {
    return this.storage.subscribe?.((tokens, reset) => {
      if (reset) {
        this.state.generation++;
        this.state.refreshAbort?.abort();
        this.state.refreshPromise = null;
      }
      this.changed(tokens, reset);
    }) ?? (() => {});
  }
  private withLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.storage.withLock ? this.storage.withLock(operation) : operation();
  }
  private persist(tokens: Tokens | null, reset = false) {
    const write = this.state.writes.catch(() => {}).then(async () => {
      await this.storage.write(tokens);
      this.changed(tokens, reset);
    });
    this.state.writes = write;
    return write;
  }
  async getAccessToken({ forceRefresh = false } = {}): Promise<string | null> {
    await this.state.writes;
    const tokens = await this.storage.read();
    if (!tokens) return null;
    if (!forceRefresh && tokens.accessToken && !tokenNeedsRefresh(tokens.accessToken)) return tokens.accessToken;
    if (this.state.refreshPromise) return this.state.refreshPromise;
    const generation = this.state.generation;
    const refresh = this.withLock(() => this.rotate(tokens, generation));
    this.state.refreshPromise = refresh;
    try { return await refresh; }
    finally { if (this.state.refreshPromise === refresh) this.state.refreshPromise = null; }
  }
  private async newerAccessToken(tokens: Tokens, generation: number): Promise<string | null | undefined> {
    const current = await this.storage.read();
    if (generation !== this.state.generation) throw new ApiError('Session changed. Please try again.', 401);
    if (!current) return null;
    if (current.accessToken === tokens.accessToken && current.refreshToken === tokens.refreshToken) return undefined;
    const subject = sessionSubject(tokens);
    if (subject && subject === sessionSubject(current)) return current.accessToken;
    throw new ApiError('Session changed. Please try again.', 401);
  }
  private async rejectSession() {
    this.state.generation++;
    this.state.refreshPromise = null;
    await this.persist(null, true);
  }
  private async rotate(tokens: Tokens, generation: number) {
    const newer = await this.newerAccessToken(tokens, generation);
    if (newer !== undefined) return newer;
    if (!tokens.refreshToken) { await this.rejectSession(); return null; }
    const controller = new AbortController();
    this.state.refreshAbort = controller;
    // A stalled network request must not hold the browser session lock indefinitely.
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(this.url('/v1/auth/refresh'), {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }), signal: controller.signal,
      });
      const replaced = await this.newerAccessToken(tokens, generation);
      if (replaced !== undefined) return replaced;
      if (!response.ok) {
        if ([400, 401, 403, 422].includes(response.status)) await this.rejectSession();
        throw await responseError(response);
      }
      const next = await response.json() as Tokens;
      if (!next.accessToken || !next.refreshToken) throw new Error('Invalid session response. Please try again.');
      const changed = await this.newerAccessToken(tokens, generation);
      if (changed !== undefined) return changed;
      await this.persist(next);
      return next.accessToken;
    } catch (error) {
      if (controller.signal.aborted && generation !== this.state.generation) throw new ApiError('Session changed. Please try again.', 401);
      throw error;
    } finally {
      clearTimeout(timeout);
      if (this.state.refreshAbort === controller) this.state.refreshAbort = undefined;
    }
  }
  private url(path: string) {
    if (/^https?:\/\//i.test(path)) return path;
    const base = this.baseUrl.replace(/\/$/, '');
    const prefix = new URL(base, 'http://local').pathname.replace(/\/$/, '');
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return base + (prefix && (normalized === prefix || normalized.startsWith(prefix + '/')) ? normalized.slice(prefix.length) : normalized);
  }
  private async response(path: string, method: HttpMethod, options: ApiRequestOptions, retry = true): Promise<Response> {
    const generation = this.state.generation;
    const publicAuth = /\/auth\/(request_otp|verify_otp|refresh)$/.test(path);
    const token = publicAuth ? null : await this.getAccessToken();
    const { body, headers, ...rest } = options;
    const form = typeof FormData !== 'undefined' && body instanceof FormData;
    const response = await fetch(this.url(path), {
      method, credentials: 'include',
      headers: { ...(!form ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : form ? body as BodyInit : JSON.stringify(body), ...rest,
    });
    if (generation !== this.state.generation) throw new ApiError('Session changed. Please try again.', 401);
    if (response.status === 401 && retry && !publicAuth) {
      const refreshed = await this.getAccessToken({ forceRefresh: true });
      if (refreshed) return this.response(path, method, options, false);
    }
    if (!response.ok) throw await responseError(response);
    return response;
  }
  async request<T>(path: string, method: HttpMethod = 'GET', options: ApiRequestOptions = {}): Promise<T> {
    const generation = this.state.generation;
    const response = await this.response(path, method, options);
    const text = await response.text();
    if (generation !== this.state.generation) throw new ApiError('Session changed. Please try again.', 401);
    return (text ? response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text : undefined) as T;
  }
  get<T>(path: string, options?: ApiRequestOptions) { return this.request<T>(path, 'GET', options); }
  post<T>(path: string, body?: unknown, options?: ApiRequestOptions) { return this.request<T>(path, 'POST', { ...options, body }); }
  put<T>(path: string, body?: unknown, options?: ApiRequestOptions) { return this.request<T>(path, 'PUT', { ...options, body }); }
  patch<T>(path: string, body?: unknown, options?: ApiRequestOptions) { return this.request<T>(path, 'PATCH', { ...options, body }); }
  delete<T>(path: string, options?: ApiRequestOptions) { return this.request<T>(path, 'DELETE', options); }
  async getBlob(path: string, options?: ApiRequestOptions) {
    const generation = this.state.generation;
    const blob = await (await this.response(path, 'GET', { credentials: 'same-origin', ...options })).blob();
    if (generation !== this.state.generation) throw new ApiError('Session changed. Please try again.', 401);
    return blob;
  }
}

async function responseError(response: Response) {
  const text = await response.text();
  let message = text || `Request failed with status ${response.status}`;
  try {
    const body = JSON.parse(text);
    message = [body.message, body.error].find(value => typeof value === 'string' && value.trim()) ?? message;
  } catch { /* Preserve non-JSON server errors. */ }
  return new ApiError(message, response.status);
}
