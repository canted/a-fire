import { expect, it, vi } from 'vitest';
import { MediaPlaybackSession } from '../../../../frontend/src/lib/mediaPlayback';

it('retains timestamp playback when an inactive thumbnail of the same asset unmounts', () => {
  const session = new MediaPlaybackSession();
  const thumbnail = Symbol(), timestamp = Symbol();
  session.activate('audio:1', timestamp, vi.fn());
  session.remember('audio:1', timestamp, 4.2);
  session.paused(timestamp);
  session.remember('audio:1', thumbnail, 0);
  expect(session.position('audio:1')).toBe(4.2);
});

it('pauses the previous player and keeps independent positions across media', () => {
  const session = new MediaPlaybackSession();
  const audio = Symbol(), video = Symbol();
  const pause = vi.fn(() => { session.remember('audio:1', audio, 12); session.paused(audio); });
  session.activate('audio:1', audio, pause);
  session.activate('video:2', video, vi.fn());
  session.remember('video:2', video, 8);
  expect(pause).toHaveBeenCalledOnce();
  expect(session.position('audio:1')).toBe(12);
  expect(session.position('video:2')).toBe(8);
  expect(new MediaPlaybackSession().position('audio:1')).toBeUndefined();
});
