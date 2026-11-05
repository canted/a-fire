import { describe, expect, it } from 'vitest';
import { contentLink, mediaLink } from '../../../../frontend/src/lib/contentLinks';
import { materialDocument } from '../../../../frontend/src/lib/materialDocument';
import { waveformEnvelope } from '../../../../frontend/src/lib/spectralWaveform';

describe('portable rich content boundaries', () => {
  it('rejects executable and protocol-relative document links', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,x', '//evil.test', '/\\evil.test', 'java\nscript:alert(1)']) expect(contentLink(value)).toBeUndefined();
    expect(contentLink('/app/rooms/4/chat#chat-8')).toBe('/app/rooms/4/chat#chat-8');
    expect(contentLink('https://example.test/path')).toBe('https://example.test/path');
    expect(mediaLink('mailto:user@example.test', 'https://app.test')).toBeUndefined();
    expect(mediaLink('/api/v1/uploads/4', 'https://app.test')).toBe('https://app.test/api/v1/uploads/4');
  });
  it('retains visible snapshots and document media without duplicating them', () => {
    const entry = { content: { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shared caption' }] }, { type: 'audio', attrs: { audioAssetId: 7 } }] }, format: 'mixed_media' as const, format_data: { audio_asset_id: 7, name: 'Study' } };
    const rendered = materialDocument(entry);
    expect(rendered.content?.filter(node => node.type === 'audio')).toHaveLength(1);
    expect(materialDocument({ ...entry, content: rendered })).toEqual(rendered);
    expect(rendered.content?.[0]).toEqual(entry.content.content[0]);
  });
  it('preserves short previews and finite real amplitudes', () => {
    expect(waveformEnvelope([0.5])).toEqual([1]);
    const envelope = waveformEnvelope([...Array(16).fill(0.2), NaN, -1]);
    expect(envelope?.every(Number.isFinite)).toBe(true);
    expect(envelope?.at(-1)).toBe(1);
  });
});

import { mediaMosaic } from '../../../../frontend/src/lib/mediaMosaic';
it('keeps native media tiles inside the four-column mosaic without overlaps', () => {
  for (let count = 1; count <= 20; count++) {
    const tiles = mediaMosaic(count);
    expect(tiles).toHaveLength(count);
    const occupied = new Set<string>();
    for (const tile of tiles) {
      expect(tile.x + tile.width).toBeLessThanOrEqual(4);
      for (let y = tile.y; y < tile.y + tile.height; y++) for (let x = tile.x; x < tile.x + tile.width; x++) {
        expect(occupied.has(`${x}:${y}`)).toBe(false);
        occupied.add(`${x}:${y}`);
      }
    }
  }
  const [cover, audio, video] = mediaMosaic(3);
  expect(cover.height).toBe(audio.height + video.height);
  expect(audio.x).toBe(video.x);
  expect(video.y).toBe(audio.y + audio.height);
});

import { localAppLink } from '../../../../frontend/src/lib/contentLinks';
it('retains the active app origin for absolute internal and local-alias links', () => {
  expect(localAppLink('http://127.0.0.1:5173/app/entries/3#reply-4', 'http://localhost:5173')).toBe('/app/entries/3#reply-4');
  expect(localAppLink('https://afire.app/app/entries/3', 'https://afire.app')).toBe('/app/entries/3');
  expect(localAppLink('http://127.0.0.1:4000/app/entries/3', 'http://localhost:5173')).toBe('http://127.0.0.1:4000/app/entries/3');
  expect(localAppLink('https://example.com/app/entries/3', 'https://afire.app')).toBe('https://example.com/app/entries/3');
});
