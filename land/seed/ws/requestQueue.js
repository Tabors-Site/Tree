// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// ws/requestQueue.js
// Per-key promise-chain queue. Supports serial (default) or bounded-concurrency modes.
// Different keys run in parallel.

const queues = new Map();          // key -> Promise (serial chain)
const concurrentQueues = new Map(); // key -> { active: number, waiting: [] }
const MAX_QUEUE_DEPTH = 100;       // max waiting tasks per key

// Original serial queue. Backward compatible.
export function enqueue(key, fn, opts) {
  if (opts && opts.maxConcurrent && opts.maxConcurrent > 1) {
    return enqueueConcurrent(key, fn, opts.maxConcurrent);
  }

  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(key, next);
  next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  return next;
}

// Bounded-concurrency queue
function enqueueConcurrent(key, fn, maxConcurrent) {
  if (!concurrentQueues.has(key)) {
    concurrentQueues.set(key, { active: 0, waiting: [] });
  }
  const q = concurrentQueues.get(key);

  // Queue depth cap: reject if too many tasks are already waiting.
  // Prevents unbounded memory growth when all active slots are held by hung tasks.
  if (q.waiting.length >= MAX_QUEUE_DEPTH) {
    return Promise.reject(new Error(`Queue depth exceeded for key "${key}" (${MAX_QUEUE_DEPTH} waiting). Try again later.`));
  }

  return new Promise((resolve, reject) => {
    const task = () => {
      q.active++;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          q.active--;
          if (q.waiting.length > 0) {
            const next = q.waiting.shift();
            next();
          } else if (q.active === 0) {
            concurrentQueues.delete(key);
          }
        });
    };

    if (q.active < maxConcurrent) {
      task();
    } else {
      q.waiting.push(task);
    }
  });
}

// Returns total in-flight + waiting count for a key
export function getQueueDepth(key) {
  // Check concurrent queue first
  const cq = concurrentQueues.get(key);
  if (cq) return cq.active + cq.waiting.length;

  // Serial queue: at most 1 active
  if (queues.has(key)) return 1;

  return 0;
}
