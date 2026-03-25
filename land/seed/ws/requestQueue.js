// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// ws/requestQueue.js
// Per-key promise-chain queue. Supports serial (default) or bounded-concurrency modes.
// Different keys run in parallel.

const queues = new Map();          // key -> Promise (serial chain)
const concurrentQueues = new Map(); // key -> { active: number, waiting: [] }

// Original serial queue — backward compatible
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
  var q = concurrentQueues.get(key);

  return new Promise((resolve, reject) => {
    var task = () => {
      q.active++;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          q.active--;
          if (q.waiting.length > 0) {
            var next = q.waiting.shift();
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
  var cq = concurrentQueues.get(key);
  if (cq) return cq.active + cq.waiting.length;

  // Serial queue: at most 1 active
  if (queues.has(key)) return 1;

  return 0;
}
