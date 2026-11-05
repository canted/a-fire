/** Storage keeps the existing preference value; the public API names Entries. */
export function notificationTypeToApi(value: string): string {
  return value === "posts" ? "entries" : value;
}

export function notificationTypeFromApi(value: string): string {
  return value === "entries" ? "posts" : value;
}
