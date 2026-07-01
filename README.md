# TreeOS Story

![stamper](/philosophy/stamper.gif)

Plant a seed on a host. It stores and grows a federated and cryptographically signed Story: histories of Named beings who act in space on matter.

It also provides a "5th dimensional" Library that Names can act in to share books of histories, and Search all Stories they are peered with.

## Setup

One Rust binary does everything (read, verify, fold, write, serve).Needs [rustup](https://rustup.rs).

```bash
git clone https://github.com/Tabors-Site/Tree.git && cd Tree
cargo build --release --manifest-path rust/Cargo.toml
```

Binaries land in `rust/target/release/` — `treeos` (the Story) and `treeportal` (the window onto it).

## Make a store

A **store** is your Story's world on disk — its own chain, like a fresh database. `genesis` plants a new one:

```bash
./rust/target/release/treeos genesis store/mine
```

That's it: a fresh world at `store/mine` (the Name "I", the being "Am", vocabulary, spaces). Pick any folder name for a separate Story. It won't overwrite an existing one.

## Run

```bash
./rust/target/release/treeos serve 127.0.0.1:7070 store/mine   # serve over http + ws
./rust/target/release/treeos store/mine                        # no subcommand = read+verify boot report
./rust/target/release/treeportal                               # the UI (connects to ws://127.0.0.1:7070/ws)
```

- **serve** — exposes the chain: `/health`, `/reels`, `/reel/...`, `/ws`, and `POST /word` (run a Word, stamp the fact).
- **portal** — sign in with a Name + password, drive a being: 2D map, 3D, Story render, 4D branch tree, Rain.

## Peers on the LAN (no DNS)

`serve` advertises this reality by **name** over mDNS with a signed address-fact. Find others on the network:

```bash
./rust/target/release/treeos discover          # find peers, verify signatures, pin the valid ones
./rust/target/release/treeos whois <alias>      # where an alias resolves (or that it's ambiguous)
```

Trust is the I-key signature, not DNS — a spoofed address is refused. See [`philosophy/dns.md`](philosophy/dns.md).

## Windows

Same `cargo build --release` in PowerShell/cmd. Binaries: `rust\target\release\treeos.exe` and `treeportal.exe`. Copy either anywhere and run — no toolchain, no Node.

## Config (first boot)

Copy `.env.example` to `.env`. Three deployment lines, read at startup:

- **`STORY_DOMAIN`** — the Story's name / alias (becomes its address `name::path@being`). Not a DNS domain; a reality is its I key plus a chosen name, resolved through Peering. `genesis` plants under it.
- **`PORT`** — where `serve` answers (default 7070).
- **`STORE_NAME`** — the `store/<name>` folder (default `past`).

Everything else (`JWT_SECRET`, display bits, runtime knobs) is a **live config word**: I acts `set-config <key> <value>` on the library reel, effective immediately — no restart.

## Read deeper

- [`seed/FACTORY.md`](seed/FACTORY.md) — the seed in its own words (JS reference implementation)
- [`philosophy/`](philosophy/) — the doctrine · [`I.md`](philosophy/I.md) the cryptographic root · [`theorems.md`](philosophy/theorems.md) the formal results

The `seed/` tree is the original JS, kept as the reference the Rust port is proven against.

## License

Dual licensed: AGPL-3.0 (free and open) or commercial (paid, closed-source friendly). See [`LICENSING.md`](LICENSING.md).

Created by Tabor Holly. taborgreat@gmail.com.
