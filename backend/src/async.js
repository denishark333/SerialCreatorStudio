/** Drain active work before propagating a failure, so no writes outlive a job. */
export async function parallel(items, limit, task) {
  let cursor = 0,
    failure;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (!failure && cursor < items.length) {
        const index = cursor++;
        try {
          await task(items[index], index);
        } catch (error) {
          failure ??= error;
        }
      }
    }),
  );
  if (failure) throw failure;
}
export function createLimiter(limit) {
  let active = 0;
  const waiting = [];
  function pump() {
    while (active < limit && waiting.length) {
      active++;
      const { task, resolve, reject } = waiting.shift();
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  }
  return task =>
    new Promise((resolve, reject) => {
      waiting.push({ task, resolve, reject });
      pump();
    });
}
