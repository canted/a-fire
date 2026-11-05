import { SessionTransport } from '../src/lib/api/transport';

/** Story previews cannot contact an account, even when a fixture is incomplete. */
class StoryTransport extends SessionTransport {
  override async request<T>(path: string): Promise<T> {
    throw new Error(`This preview has no API action for ${path}.`);
  }
  override async getBlob(): Promise<Blob> {
    throw new Error('This preview does not download private media.');
  }
  override async getAccessToken() { return null; }
  override async setSession() { throw new Error('This preview cannot change a session.'); }
}
export const apiBaseUrl = 'https://storybook.invalid/api';
export const client = new StoryTransport(apiBaseUrl, { read: async () => null, write: async () => {} });
export const onSessionChange = () => () => {};
