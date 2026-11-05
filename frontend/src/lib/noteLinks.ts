/** Preserve only supported Note routes and audio parameters across authentication. */
export function safeNoteDestination(value: string): boolean {
  if (!/^\/app\/note\/[1-9]\d*(?:\/audio-reply)?(?:[?#]|$)/.test(value) || /[\\\s]/.test(value)) return false;
  try {
    const url = new URL(value, 'https://app.local');
    if (!/^\/app\/note\/[1-9]\d*(?:\/audio-reply)?$/.test(url.pathname)) return false;
    const entries = [...url.searchParams];
    if (new Set(entries.map(([key]) => key)).size !== entries.length) return false;
    for (const [key, val] of entries) {
      if (key === 'audio' ? !/^[1-9]\d*$/.test(val) : key === 'audioNode' ? !/^[\w-]{1,128}$/.test(val) : key === 't' ? !/^\d+(?:\.\d+)?$/.test(val) || !Number.isFinite(Number(val)) : true) return false;
    }
    if ((url.pathname.endsWith('/audio-reply') || entries.length) && !url.searchParams.has('audio')) return false;
    return !url.hash || /^#[\w-]{1,128}$/.test(url.hash);
  } catch { return false; }
}
