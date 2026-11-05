/** Session-only playback positions; no players, tokens, or media bytes persist. */
export class MediaPlaybackSession {
  private positions = new Map<string, { owner: symbol; seconds: number }>();
  private active?: { owner: symbol; pause: () => void };

  position(key: string) {
    return this.positions.get(key)?.seconds;
  }
  pauseActive() {
    this.active?.pause();
    this.active = undefined;
  }

  activate(key: string, owner: symbol, pause: () => void) {
    if (this.active?.owner !== owner) this.active?.pause();
    const seconds = this.position(key) ?? 0;
    this.positions.delete(key);
    this.positions.set(key, { owner, seconds });
    if (this.positions.size > 256)
      this.positions.delete(this.positions.keys().next().value!);
    this.active = { owner, pause };
  }

  remember(key: string, owner: symbol, seconds: number) {
    const entry = this.positions.get(key);
    // A thumbnail and timestamp can mount the same asset simultaneously.
    // Only its most recently activated player may replace the saved position.
    if (entry?.owner === owner && Number.isFinite(seconds))
      entry.seconds = seconds;
  }

  paused(owner: symbol) {
    if (this.active?.owner === owner) this.active = undefined;
  }
}
