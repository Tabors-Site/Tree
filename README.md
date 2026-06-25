# TreeOS Story

![stamper](/philosophy/stamper.gif)

Plant a seed on a host. It stores and grows a federated and cryptographically signed Story: histories of Named beings who act in space on matter.

It also provides a "5th dimensional" Library that Names can act in to share books of histories, and Search all Stories they are peered with.

## Run it

TreeOS boots on Rust. The kernel (content hash, chain verify, fold, the append only store) is a zero dependency Rust binary that reads, verifies, folds, and serves a Story with no Node in the loop. The Word runtime, the language that writes new acts, runs as a worker behind the front door. That worker is Node today and is being ported to Rust, the goal being one self contained binary anyone can boot.

Needs a Rust toolchain (rustup). Node.js 18+ runs the Word worker and genesis for now.

```bash
git clone https://github.com/Tabors-Site/Tree.git
cd Tree

# build the Rust kernel, then boot it (serves the chain over HTTP + WebSocket)
cargo build --release --manifest-path rust/Cargo.toml
./rust/target/release/treeos serve 127.0.0.1:7070 store/past
```

`treeos serve` reads, verifies, and folds the chain in Rust and exposes it: `GET /health`, `/reels`, `/reel/<history>/<kind>/<id>`, a `/ws` stream, and `POST /word`, the write seam that delegates to the JS Word worker and stamps the result onto the chain.

For writes and for planting a fresh Story (genesis and the Portal UI), the Node side seeds through `npm install && npm run build:native && npm start`, until genesis ports across. Open the URL it prints to use your Portal.

## Read deeper

- [`seed/FACTORY.md`](seed/FACTORY.md), the seed in its own words
- [`philosophy/`](philosophy/), the doctrine
- [`philosophy/I_AM.md`](philosophy/I.md), the cryptographic root
- [`philosophy/theorems.md`](philosophy/theorems.md), the formal results
- [`resources/README.md`](resources/README.md), building extensions

## License

Dual licensed: AGPL-3.0 (free and open) or commercial (paid, closed-source friendly). See [`LICENSING.md`](LICENSING.md).

Created by Tabor Holly. taborgreat@gmail.com.
