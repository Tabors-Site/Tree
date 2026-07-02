// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// treeos — a standalone Rust boot of the on-disk chain, with a front door + the present-loop runtime.
// NO Node, NO napi, NO FFI. This binary is a thin shim over the `treeos_lib` crate root (lib.rs), which
// owns the module tree; the server + boot-report logic live in `server.rs`.
//
//   cargo run -p treeos                         # one-shot boot report (read+fold+verify store/past)
//   cargo run -p treeos -- serve 127.0.0.1:7070 store/past   # serve the chain over http + ws

fn main() {
    treeos_lib::run();
}
