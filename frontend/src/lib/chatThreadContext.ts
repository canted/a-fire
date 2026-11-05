export function adjacentMessages<T extends { id: string | number }>(messages: T[], currentId: string | number) {
  const index = messages.findIndex(message => String(message.id) === String(currentId));
  return { previous: index > 0 ? messages[index - 1] : null, next: index >= 0 && index < messages.length - 1 ? messages[index + 1] : null };
}
