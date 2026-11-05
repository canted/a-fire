/** Native responder ownership keeps child controls separate from parent presses. */
export function isContentControl(_event: unknown): boolean {
  return false;
}
