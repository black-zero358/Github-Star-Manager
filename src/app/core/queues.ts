export type QueueTask<T> = () => Promise<T>;

export async function runWithConcurrency<T>(tasks: QueueTask<T>[], concurrency: number): Promise<T[]> {
  const results: T[] = [];
  const executing = new Set<Promise<void>>();
  let index = 0;

  const runNext = async () => {
    const current = index;
    index += 1;
    if (current >= tasks.length) return;
    const value = await tasks[current]();
    results[current] = value;
    await runNext();
  };

  while (index < tasks.length && executing.size < concurrency) {
    const runner = runNext().then(() => {
      executing.delete(runner);
    });
    executing.add(runner);
  }

  await Promise.all(executing);
  return results;
}
