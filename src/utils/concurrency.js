/**
 * Run independent async work with a small, explicit concurrency ceiling.
 * Results retain input order, which keeps evidence and dossier rendering stable
 * even though the underlying calls complete in a different order.
 */
export async function mapWithConcurrency(items, concurrency, mapper) {
  if (!Array.isArray(items) || !items.length) return [];

  const limit = Math.max(1, Math.min(items.length, Math.floor(Number(concurrency) || 1)));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}
