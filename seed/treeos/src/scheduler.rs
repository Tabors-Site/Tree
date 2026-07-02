// scheduler.rs — the SUMMON-DRIVEN WAKE (Phase 1 of the present-loop runtime). A being wakes ONLY on a
// real event (a summon lands in its inbox); it then drains its inbox through the moment conductor, one
// moment at a time. SERIAL per being (a being is a single line — one moment in flight at a time, so the
// being's reel advances without a self-fork), PARALLEL across beings (each being runs on its own thread).
//
// CLOCK-FREE BY CONSTRUCTION. There is NO timer, NO tick, NO sleep-for-timing, NO per-second rate limit
// anywhere here. The JS token-bucket `_checkRate` (60 summons/sec) is GONE — it was wall-clock, the same
// problem Tabor rejected for scheduled wakes. Serial-per-being processing bounds throughput naturally;
// the only optional guard is a QUEUE-DEPTH cap (a COUNT, never a rate). Periodic/scheduled wakes are
// NOT built (Phase 1 = wake on a real summon only); if ord-based periodic waking is ever needed it is
// "every N global ords", a count, never seconds — and it is deliberately absent here.
//
// The shape: a per-being in-memory FIFO inbox (rebuildable from the chain — it is a cache, the facts are
// the truth) behind a Mutex + Condvar. `wake(being_id, entry)` enqueues the summon and, if the being is
// idle, spawns its run-loop thread. The run-loop BLOCKS on the Condvar (no busy-wait, no poll-interval)
// until an entry is present, drains the conductor over each, and exits when the inbox is empty — so an
// idle being holds no thread. A later wake re-spawns it. Nothing reads a wall-clock to decide anything.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Condvar, Mutex, OnceLock};
use std::thread;

use treehash::Json;

/// One summon entry — the unit a being wakes on. Mirrors the JS pick'd entry (the fields the conductor
/// reads), CLOCK-FREE: `ord` is the global APPEND ord (a FIFO count, not a clock); `basis` is the act's
/// causal basis (the world's ord the summoner perceived from). There is NO `sentAt`/wall-clock field.
#[derive(Debug, Clone)]
pub struct Entry {
    /// the summon's correlation id (names this exchange; an answer evicts the row by it — Phase 2).
    pub correlation: String,
    /// who summoned this being (the LEFT Name that called), if any.
    pub from: Option<String>,
    /// the active able to think with (overrides the being's folded activeAble when present).
    pub able: Option<String>,
    /// the space the moment happens in (overrides the being's folded position space when present).
    pub space: Option<String>,
    /// the triggering EVENT clause (a scripted `When event:` flow matches face.event on this).
    pub event: Option<String>,
    /// an opaque payload the able's flows may read off the face.
    pub payload: Option<Json>,
    /// the history lane (branch) the moment runs on. "0" = main.
    pub history: String,
    /// the act's causal basis (the world ord the summoner perceived from), if declared.
    pub basis: Option<f64>,
    /// the being's last act-chain head, if known (the actId mint's `prev`). None = genesis "0".
    pub prev: Option<String>,
    /// OPTIONAL: the able's flows supplied directly (an embedder/test seam). None = parse the able's
    /// `.word` file. Used to inject a flow whose effect is a complete Word while treeword's flow-effect
    /// parser does not yet round-trip parameterized deeds. Not serialized over the wire.
    pub flows: Option<Vec<Json>>,
    /// the SUMMON priority (HUMAN/GATEWAY/INTERACTIVE/BACKGROUND). The drain orders by priorityRank then
    /// ord — a CLOCK-FREE count sort (treesecondary::priority_rank_of), never a clock. None = INTERACTIVE.
    pub priority: Option<String>,
}

impl Entry {
    /// A minimal summon: a correlation + an event clause, on main history. Defaults the rest.
    pub fn event(correlation: &str, event: &str) -> Self {
        Entry {
            correlation: correlation.to_string(),
            from: None,
            able: None,
            space: None,
            event: Some(event.to_string()),
            payload: None,
            history: "0".to_string(),
            basis: None,
            prev: None,
            flows: None,
            priority: None,
        }
    }

    /// The entry's priority RANK (lower = picked first), via the shared treesecondary map. None defaults
    /// to INTERACTIVE. A pure count, no clock.
    pub fn rank(&self) -> i64 {
        treesecondary::priority_rank_of(self.priority.as_deref().unwrap_or("INTERACTIVE"))
    }

    /// The entry's ORD tiebreak (the wake's basis = the triggering fact's append ord; a count). Entries
    /// with no basis sort LAST within a rank (a fresh wire summon yields to a chain-ordered one).
    fn ord_key(&self) -> f64 {
        self.basis.unwrap_or(f64::INFINITY)
    }
}

/// A being's in-memory inbox + its run-state. The inbox is a PROJECTION cache (the chain is the truth, so
/// it rebuilds from the inbox fold); `draining` says a run-loop thread is live for this being (serial
/// guarantee). The drain is NOT pure FIFO: `pop_priority` picks the lowest priorityRank, ord as tiebreak
/// — a CLOCK-FREE count sort. Insertion order is preserved as the final tiebreak (a stable pick).
struct Inbox {
    queue: VecDeque<Entry>,
    draining: bool,
}

impl Inbox {
    /// PRIORITY DRAIN (clock-free): pick the entry with the lowest priorityRank, then the lowest ord
    /// (the triggering fact's append ord, a count), then earliest insertion (the VecDeque index). A pure
    /// min-scan + remove — a count sort, never a clock. Replaces the Phase-1 pure `pop_front`.
    fn pop_priority(&mut self) -> Option<Entry> {
        if self.queue.is_empty() {
            return None;
        }
        let mut best = 0usize;
        for i in 1..self.queue.len() {
            let a = &self.queue[i];
            let b = &self.queue[best];
            let better = a.rank() < b.rank()
                || (a.rank() == b.rank() && a.ord_key() < b.ord_key());
            if better {
                best = i;
            }
        }
        self.queue.remove(best)
    }

    /// EVICT every queued entry by correlation (an answering Act closed this exchange — closeInboxOnAnswer).
    /// Returns the count removed. A pure retain, no clock.
    fn evict(&mut self, correlation: &str) -> usize {
        let before = self.queue.len();
        self.queue.retain(|e| e.correlation != correlation);
        before - self.queue.len()
    }
}

/// The shared scheduler state: per-being inboxes behind one Mutex, with a Condvar a being's run-loop
/// blocks on (no poll-interval, no timer — a pure wait/notify, clock-free).
struct Sched {
    /// QUEUE-DEPTH cap — a COUNT, never a per-second rate. 0 = unbounded. Over-cap enqueues drop (the
    /// oldest is kept; the new summon is refused) so a flood cannot grow memory without bound, with NO
    /// clock involved. Tabor's rule: bound by depth, never by seconds.
    depth_cap: usize,
    inboxes: Mutex<HashMap<String, Inbox>>,
    /// notified whenever an entry is enqueued (a being's run-loop wakes from its wait).
    woke: Condvar,
}

fn sched() -> &'static Sched {
    static S: OnceLock<Sched> = OnceLock::new();
    S.get_or_init(|| Sched {
        // a generous default depth cap (a count). The chain bounds the truth; this bounds the cache.
        depth_cap: 4096,
        inboxes: Mutex::new(HashMap::new()),
        woke: Condvar::new(),
    })
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Enqueue a summon for a being and, if it is idle, SPAWN its run-loop (one thread per active being;
/// parallel ACROSS beings, serial WITHIN one). Returns false if the queue-depth cap refused the entry
/// (a count guard, never a clock). The run-loop drains the conductor and exits when the inbox empties.
pub fn wake(being_id: &str, entry: Entry, root: &PathBuf) -> bool {
    let s = sched();
    let mut start_loop = false;
    {
        let mut inboxes = lock(&s.inboxes);
        let inbox = inboxes.entry(being_id.to_string()).or_insert_with(|| Inbox {
            queue: VecDeque::new(),
            draining: false,
        });
        if s.depth_cap != 0 && inbox.queue.len() >= s.depth_cap {
            return false; // depth cap (a count) refused — NO rate/clock involved.
        }
        inbox.queue.push_back(entry);
        if !inbox.draining {
            inbox.draining = true;
            start_loop = true;
        }
    }
    // notify any blocked run-loop; spawn one if this being was idle.
    s.woke.notify_all();
    if start_loop {
        let being = being_id.to_string();
        let root = root.clone();
        thread::spawn(move || run_loop(being, root));
    }
    true
}

/// A being's RUN-LOOP: drain its FIFO inbox through the moment conductor, one moment at a time (SERIAL).
/// Blocks on the Condvar when the inbox is momentarily empty WHILE other beings may still feed it in the
/// same wake burst — but exits (releasing the thread) once it is empty and no entry arrives, so an idle
/// being holds nothing. There is NO timed wait: the wait is unconditional (notify-driven), and the loop
/// re-checks the queue on every notify. To avoid a thread lingering forever it exits on the first empty
/// observation after draining at least one entry; a fresh summon re-spawns it via `wake`. CLOCK-FREE.
fn run_loop(being_id: String, root: PathBuf) {
    let s = sched();
    loop {
        // pop the next entry under the lock (FIFO); if empty, mark idle + exit (release the thread).
        let next = {
            let mut inboxes = lock(&s.inboxes);
            match inboxes.get_mut(&being_id) {
                Some(inbox) => match inbox.pop_priority() {
                    Some(e) => Some(e),
                    None => {
                        inbox.draining = false; // idle — a later wake re-spawns the loop
                        None
                    }
                },
                None => None,
            }
        };
        let entry = match next {
            Some(e) => e,
            None => return, // inbox drained, thread exits (no idle thread, no timer)
        };
        // run ONE moment through the conductor. It never panics (errors -> Cognition::Failure), but a
        // catch_unwind belts-and-braces keeps a stray panic from poisoning the whole run-loop.
        let report = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            crate::moment::run_moment(&being_id, &entry, &root)
        }));
        match report {
            Ok(r) => log_moment(&r),
            Err(_) => eprintln!("treeos present-loop: moment for '{being_id}' panicked (skipped, loop continues)"),
        }
        // loop back: drain the next entry. No sleep, no tick — the next pop happens immediately.
    }
}

/// A one-line log of a sealed moment (no wall-clock). The being woke, decided, and (maybe) acted.
fn log_moment(r: &crate::moment::MomentReport) {
    match &r.decision {
        treecognition::Cognition::Act { content } => {
            println!("  present-loop: {} woke -> ACT [{}] '{}' (actId {})", r.being_id, r.mode, content, &r.act_id[..r.act_id.len().min(12)]);
        }
        treecognition::Cognition::See => {
            println!("  present-loop: {} woke -> SEE [{}] (actId {})", r.being_id, r.mode, &r.act_id[..r.act_id.len().min(12)]);
        }
        treecognition::Cognition::Failure { shape, reason } => {
            println!("  present-loop: {} woke -> FAILURE [{}] {:?}: {}", r.being_id, r.mode, shape, reason);
        }
    }
}

/// Drain + run a being's whole inbox SYNCHRONOUSLY on the calling thread (no spawn). Used by the wire
/// seam (a summon that wants the moment's outcome inline) and by the verification harness — it runs the
/// same conductor the async run-loop runs, serially. Returns each moment's report. CLOCK-FREE.
pub fn wake_sync(being_id: &str, entry: Entry, root: &PathBuf) -> Vec<crate::moment::MomentReport> {
    let s = sched();
    {
        let mut inboxes = lock(&s.inboxes);
        let inbox = inboxes.entry(being_id.to_string()).or_insert_with(|| Inbox {
            queue: VecDeque::new(),
            draining: false,
        });
        if s.depth_cap == 0 || inbox.queue.len() < s.depth_cap {
            inbox.queue.push_back(entry);
        }
        inbox.draining = true; // claim the line so no async loop double-drains
    }
    let mut reports = Vec::new();
    loop {
        let next = {
            let mut inboxes = lock(&s.inboxes);
            match inboxes.get_mut(being_id) {
                Some(inbox) => match inbox.pop_priority() {
                    Some(e) => Some(e),
                    None => {
                        inbox.draining = false;
                        None
                    }
                },
                None => None,
            }
        };
        match next {
            Some(e) => reports.push(crate::moment::run_moment(being_id, &e, root)),
            None => break,
        }
    }
    reports
}

/// TEST/REHYDRATE SEAM: enqueue an entry into a being's inbox PROJECTION WITHOUT spawning the run-loop
/// (it claims `draining` so no thread drains it). Used to stage the in-memory inbox from the chain (a
/// rehydrated projection) or to assert the eviction/priority drain deterministically, with no run-loop
/// race and no clock. A parked inbox is drained by a later real `wake` (which finds it already draining,
/// so it only enqueues) — but a test inspects it via `depth` / `evict` first.
pub fn enqueue_parked(being_id: &str, entry: Entry) {
    let s = sched();
    let mut inboxes = lock(&s.inboxes);
    let inbox = inboxes.entry(being_id.to_string()).or_insert_with(|| Inbox {
        queue: VecDeque::new(),
        draining: false,
    });
    inbox.queue.push_back(entry);
    inbox.draining = true; // park: no run-loop is spawned, so nothing drains it out from under a test.
}

/// TEST SEAM: pop the next entry by the PRIORITY drain (lowest rank, ord tiebreak) off a parked inbox,
/// returning its correlation. Proves the count-sort order without running the conductor. No clock.
pub fn drain_next_correlation(being_id: &str) -> Option<String> {
    let s = sched();
    let mut inboxes = lock(&s.inboxes);
    inboxes
        .get_mut(being_id)
        .and_then(|inbox| inbox.pop_priority())
        .map(|e| e.correlation)
}

/// The current inbox depth for a being (a count, for tests/observability — no clock).
pub fn depth(being_id: &str) -> usize {
    let s = sched();
    lock(&s.inboxes).get(being_id).map(|i| i.queue.len()).unwrap_or(0)
}

/// INBOX EVICTION (closeInboxOnAnswer): an answering Act sealed carrying `answers: <correlation>` — drop
/// the matching open row from every being's in-memory inbox PROJECTION. The chain is the truth (the
/// answer fact is the durable close); this evicts the cache so a being never re-runs an answered summon.
/// Returns the count of queued entries removed. A pure retain, CLOCK-FREE.
pub fn evict(correlation: &str) -> usize {
    let s = sched();
    let mut inboxes = lock(&s.inboxes);
    let mut removed = 0;
    for inbox in inboxes.values_mut() {
        removed += inbox.evict(correlation);
    }
    removed
}
