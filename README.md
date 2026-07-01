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

### Find peers on the LAN (no DNS)

`serve` advertises this reality over mDNS as `_treeos._tcp`, carrying its **signed address-fact** — the I-key's signature over `{name, host, port, transport}`. Another reality on the same network finds it by **name**, with no DNS and no registrar:

```bash
./rust/target/release/treeos discover        # browse a few seconds, verify each signature, pin the valid ones
```

Every discovered reality's signature is checked against its own I public key; a bad or missing signature is **refused**, and the verified ones are pinned into `.story/peers.json` (the Peering cache that federation resolves through). This is TreeOS resolving names to network addresses by **cryptographic identity** instead of DNS — the first rung of [`philosophy/dns.md`](philosophy/dns.md).

### Where the binaries are

After `cargo build --release`:

- **Linux / macOS:** `rust/target/release/treeos` and `rust/target/release/treeportal`
- **Windows:** `rust\target\release\treeos.exe` and `rust\target\release\treeportal.exe` — same `cargo build --release` command in a Windows shell (PowerShell / cmd)

Copy a binary anywhere and run it — no toolchain, no Node, no `node_modules`.

## Config (first-boot settings)

A Story's first-boot identity lives in **`.env`** (copy `.env.example`) — read by the `treeos` binary at startup, the equivalent of what you'd set on an OS's first boot:

- **`STORY_DOMAIN`** — the Story's **name / alias**, its identity handle. It becomes the library reel id: how the Story is addressed (`name::path@being`) and what its acts commit to. This is **not** a DNS domain — a TreeOS reality is its I key plus a chosen alias, resolved through Peering, not DNS (see [`philosophy/dns.md`](philosophy/dns.md)). Pick whatever name you want; `genesis` plants the Story under it (`STORY_DOMAIN=tabors-site treeos genesis store/mine seed`).
- **`PORT`** — where `treeos serve` answers (default 7070).
- **`STORE_NAME`** — the store folder `store/<name>` (default `past`); name it fresh for an isolated Story.

Everything else a Story *is* — display bits, runtime knobs, `JWT_SECRET` — is a **live config word**: I acts `set-config <key> <value>`, which lands a `config-set` name-act on the library reel and takes effect immediately (no restart, no `.env`). So `.env` is just the three deployment lines above; the Story's identity and settings live on-chain, changeable in-system by I.

## Read deeper

- [`seed/FACTORY.md`](seed/FACTORY.md), the seed in its own words (the JS reference implementation)
- [`philosophy/`](philosophy/), the doctrine
- [`philosophy/I.md`](philosophy/I.md), the cryptographic root
- [`philosophy/theorems.md`](philosophy/theorems.md), the formal results

The `seed/` tree is the original JS implementation, kept as the reference the Rust port is proven against.

## License

Dual licensed: AGPL-3.0 (free and open) or commercial (paid, closed-source friendly). See [`LICENSING.md`](LICENSING.md).

Created by Tabor Holly. taborgreat@gmail.com.
