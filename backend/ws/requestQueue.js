// ws/requestQueue.js
// Per-key promise-chain queue. Ensures only one async operation runs at a time
// for a given key (visitorId, userId:rootId, etc.). Different keys run in parallel.

const queues = new Map();

export function enqueue(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(key, next);
  next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  return next;
}
