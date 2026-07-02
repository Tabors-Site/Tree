# TreeOS Story

![stamper](/philosophy/stamper.gif)

Plant this seed on a computer. It Stores and grows a Story that is federated and cryptographically signed (one fact-stamp per moment forming "Time"): the histories of Named beings who act in space, on matter.

It also gives you a higher dimensioned Library. Names can act in it to share Books of Histories, and to Search, in Word, across every Story you are peered with.

## Setup

One Rust binary does everything: read, verify, fold, write, and serve. You need [rustup](https://rustup.rs).

```bash
git clone https://github.com/Tabors-Site/Tree.git && cd Tree
cargo build --release --manifest-path rust/Cargo.toml
```

The binaries land in `rust/target/release/`: `treeos` (the Story) and `treeportal` (the window onto it).

## Make a store

A **store** is your Story's world on disk. It is its own chain, like a fresh database. `genesis` plants a new one:

```bash
./rust/target/release/treeos genesis store/past
```

That is it: a fresh world at `store/past`, with the Name "I", the being "Am", the vocabulary, and the spaces. Pick any folder name for a separate Story. It will not overwrite one that already exists.

## Run

```bash
./rust/target/release/treeos serve 127.0.0.1:7070 store/mine   # serve over http + ws
./rust/target/release/treeos store/mine                        # no subcommand = read + verify boot report
./rust/target/release/treeportal                               # the UI (connects to ws://127.0.0.1:7070/ws)
```

- **serve** exposes the chain over http and ws: `/health`, `/reels`, `/reel/...`, `/ws`, and `POST /word` (run a Word, stamp the fact).
- **portal** lets you sign in with a Name and password and drive a being: 2D map, 3D, Story render, 4D branch tree, and Rain.

## Peers on the LAN (no DNS)

`serve` advertises this reality by **name** over mDNS, with a signed address fact. To find others on the network:

```bash
./rust/target/release/treeos discover          # find peers, verify signatures, pin the valid ones
./rust/target/release/treeos whois <alias>      # where an alias resolves (or that it is ambiguous)
```

Trust comes from the I-key signature, not from DNS, so a spoofed address is refused. See [`philosophy/dns.md`](philosophy/dns.md).

## Windows

Run the same `cargo build --release` in PowerShell or cmd. The binaries are `rust\target\release\treeos.exe` and `treeportal.exe`. Copy either one anywhere and run it. No toolchain, no Node.

## Config (first boot)

Copy `.env.example` to `.env`. Three deployment lines are read at startup:

- **`STORY_DOMAIN`**: the Story's name or alias. It becomes the address `name::path@being`. This is not a DNS domain; a reality is its I key plus a chosen name, resolved through Peering. `genesis` plants under it.
- **`PORT`**: where `serve` answers (default 7070).
- **`STORE_NAME`**: the `store/<name>` folder (default `past`).

Everything else (`JWT_SECRET`, display bits, runtime knobs) is a **live config word**. The I acts `set-config <key> <value>` on the library reel, and it takes effect right away, with no restart.

## Read deeper

- [`seed/FACTORY.md`](seed/FACTORY.md): the seed in its own words (the JS reference implementation).
- [`philosophy/`](philosophy/): the doctrine. [`I.md`](philosophy/I_AM.md) is the cryptographic root, and [`theorems.md`](philosophy/theorems.md) has the formal results.

## License

Dual licensed: AGPL-3.0 (free and open) or commercial (paid, friendly to closed source). See [`LICENSING.md`](LICENSING.md).

Created by Tabor Holly. taborgreat@gmail.com.
