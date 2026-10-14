/**
 * Cancels a server-internal DB wait, not the physical query. Late results/errors
 * stay observed. Never use for handle-producing filesystem work: its owner must
 * wait for that work to settle before closing the resulting descriptor.
 */
export function waitForDatabaseQuery<T>(query: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return query;
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    query.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}
