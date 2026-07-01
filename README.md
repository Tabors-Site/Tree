# TreeOS Story

![stamper](/philosophy/stamper.gif)

Plant a seed on a host. It stores and grows a federated and cryptographically signed Story: histories of Named beings who act in space on matter.

It also provides a "5th dimensional" Library that Names can act in to share books of histories, and Search all Stories they are peered with.

## Run it (Rust)

TreeOS boots on Rust. One self-contained binary reads, verifies, folds, writes, and serves a Story with no Node in the loop. You need a Rust toolchain ([rustup](https://rustup.rs)).

```bash
git clone https://github.com/Tabors-Site/Tree.git
cd Tree

# build the binaries → rust/target/release/{treeos, treeportal}
cargo build --release --manifest-path rust/Cargo.toml
```

### Make a store (plant a fresh Story)

`genesis` reads the seed's genesis words (`seed/store/genesis-*.word`) and plants a brand-new world — the Name "I", the being "Am", the vocabulary, the spaces, the delegates — into an empty store directory:

```bash
# treeos genesis <store-dir> <seed-dir>   (both optional; default store/past + seed)
./rust/target/release/treeos genesis store/past seed
```

The store directory is where your Story lives (its chain + projections). Name it something else (`store/mystory`) to spin up a fresh, isolated Story — its own chain, like a new database. Genesis refuses if the directory already exists (delete it first to replant).

### Serve it

```bash
# treeos serve <host:port> <store-dir>   (defaults 127.0.0.1:7070 + store/past)
./rust/target/release/treeos serve 127.0.0.1:7070 store/past
```

`serve` exposes the chain over HTTP + WebSocket: `GET /health`, `/reels`, `/reel/<history>/<kind>/<id>`, a `/ws` stream, and `POST /word` — the write seam that runs a Word and stamps the resulting fact onto the chain, all in Rust.

Want a one-shot integrity check instead? Run the binary with no subcommand to read + fold + verify a store and print a boot report:

```bash
./rust/target/release/treeos store/past
```

### The Portal (the UI)

`treeportal` is the native window onto a running `treeos`. Start the server, then:

```bash
# connects to ws://127.0.0.1:7070/ws by default; pass another URL to point elsewhere
./rust/target/release/treeportal
# or:  ./rust/target/release/treeportal ws://host:port/ws
```

Sign in with a Name + password, drive a being, and move through the world: the 2D map, first-person 3D, the Story render, the 4D branch tree, and the Rain.

### Where the binaries are

After `cargo build --release`:

- **Linux / macOS:** `rust/target/release/treeos` and `rust/target/release/treeportal`
- **Windows:** `rust\target\release\treeos.exe` and `rust\target\release\treeportal.exe` — same `cargo build --release` command in a Windows shell (PowerShell / cmd)

Copy a binary anywhere and run it — no toolchain, no Node, no `node_modules`.

## Config (first-boot settings)

A Story's boot-critical identity — its outward domain, port, store name, display name, and token secret — is the first-boot config: the equivalent of what you'd set on an OS's first boot. Today these live in **`.env`** (see `.env.example`); the canonical values fold onto the Story's **library reel** once the store is open, and runtime knobs live in the `.config` heaven space.

> Status: the Rust runtime currently defaults the Story domain to `localhost` and doesn't yet read `.env`. Wiring the Rust genesis to read these settings (or a native Rust config) and stamp a custom domain / name / secret into the library on first boot is the next step. Until then, `.env` holds the intended settings and the Rust binary runs a local `localhost` Story.

## Read deeper

- [`seed/FACTORY.md`](seed/FACTORY.md), the seed in its own words (the JS reference implementation)
- [`philosophy/`](philosophy/), the doctrine
- [`philosophy/I.md`](philosophy/I.md), the cryptographic root
- [`philosophy/theorems.md`](philosophy/theorems.md), the formal results

The `seed/` tree is the original JS implementation, kept as the reference the Rust port is proven against.

## License

Dual licensed: AGPL-3.0 (free and open) or commercial (paid, closed-source friendly). See [`LICENSING.md`](LICENSING.md).

Created by Tabor Holly. taborgreat@gmail.com.
