/** Shared receipt batching; callers enqueue only genuine foreground exposures. */
export function createChatReadReceipts(save: (ids: number[]) => Promise<unknown>) {
  const pending = new Set<number>();
  const saved = new Set<number>();
  const inFlight = new Set<number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let active = true;
  const flush = async () => {
    clearTimeout(timer);
    if (running || !pending.size) return;
    running = true;
    const ids = [...pending].slice(0, 100);
    ids.forEach(id => { pending.delete(id); inFlight.add(id); });
    let failed = false;
    try { await save(ids); ids.forEach(id => saved.add(id)); }
    catch { failed = true; ids.forEach(id => pending.add(id)); }
    finally {
      running = false;
      ids.forEach(id => inFlight.delete(id));
      if (pending.size && (active || !failed)) timer = setTimeout(() => void flush(), failed ? 5000 : 150);
    }
  };
  return {
    enqueue(value: string | number) {
      const id = Number(value);
      if (!active || !Number.isSafeInteger(id) || id <= 0 || saved.has(id) || inFlight.has(id)) return;
      pending.add(id);
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), 150);
    },
    dispose() { active = false; clearTimeout(timer); void flush(); },
  };
}
