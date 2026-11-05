/** Round URLs use their own identity, independently of Room placement. */
export function roundPath(roundId: string | number) {
  return `/app/rounds/${roundId}`
}
