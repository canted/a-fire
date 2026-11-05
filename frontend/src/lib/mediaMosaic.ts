export type MediaTile = { x: number; y: number; width: number; height: number };
/** Native projection of MediaMosaic.module.css's four-column placements. */
export function mediaMosaic(count: number): MediaTile[] {
  const special: Record<number, number[][]> = {
    1: [[0, 0, 4, 2]],
    2: [[0, 0, 2, 2], [2, 0, 2, 2]],
    3: [[0, 0, 2, 2], [2, 0, 2, 1], [2, 1, 2, 1]],
    4: [[0, 0, 2, 2], [2, 0, 1, 1], [2, 1, 1, 1], [3, 0, 1, 2]],
    5: [[0, 0, 2, 2], [2, 0, 1, 1], [3, 0, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1]],
    6: [[0, 0, 2, 2], [2, 0, 2, 1], [2, 1, 1, 1], [3, 1, 1, 1], [0, 2, 2, 1], [2, 2, 2, 1]],
    7: [[0, 0, 2, 2], [2, 0, 1, 1], [3, 0, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [2, 1, 1, 2], [3, 1, 1, 2]],
  };
  if (count < 1) return [];
  if (special[count]) return special[count].map(([x, y, width, height]) => ({ x, y, width, height }));
  const tiles: MediaTile[] = [{ x: 0, y: 0, width: 2, height: 2 }];
  for (let cell = 0; tiles.length < count; cell++) {
    const x = cell % 4, y = Math.floor(cell / 4);
    if (x < 2 && y < 2) continue;
    tiles.push({ x, y, width: 1, height: 1 });
  }
  return tiles;
}
