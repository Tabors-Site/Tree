// lib.rs — the treeos crate ROOT as a LIBRARY. The binary (main.rs) is a thin shim over `run()`; the
// library exposes the modules so integration tests (and an embedder) can drive the present-loop runtime
// in-process. The module tree lives here, declared ONCE; main.rs calls `treeos_lib::run()`.
//
// This is purely a packaging move (a bin-and-lib crate): the conductor + scheduler + wire are unchanged,
// they just live under a lib root so `tests/` can `use treeos_lib::scheduler` to summon a being directly.

pub mod act;
pub mod chain;
pub mod cognize;
pub mod config;
pub mod federation;
pub mod ibp;
pub mod ibp_http;
pub mod live;
pub mod llm_http;
pub mod mdns;
pub mod moment;
pub mod resolve;
pub mod scheduler;
pub mod seeops;
pub mod subscriptions;
pub mod wire;

pub mod server;

/// The binary entry: parse argv (serve / peer-fact / one-shot boot report) and run. main.rs is a shim.
pub fn run() {
    server::run();
}
