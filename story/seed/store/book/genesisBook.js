// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// genesisBook.js — the genesis book.
//
// All of the seed's words ARE a book (Tabor): a *genesis* book — a whole story's start, the root
// language every other word-package branches from (language.md). It is just **a `.book` of words**,
// the RESULT of the `.word` files — a STATIC artifact, like anything in the store. It does NOT get
// rendered live on boot: it stays the same after a point (it only changes when the words change /
// on download). So it is a precomputed `.book` FILE in the store when one exists, with a one-time
// live build as the fallback; and it is laid into the Library ON DEMAND (when first needed — a
// share/download), never eagerly at boot.
//
// It is sealed by the I_AM (its colophon root is the reality's first signature, reusing
// signedStoryRoot's key-signing machinery — no parallel root system). **Every book out of this
// story colophons back to it** until someone makes another root. The library's first signature.
// The economy is Love (colophon.md): given down, received, traced to its Roots, shared again — CAS
// makes every copy perfect, the signature riding along forever. ("Stuff in the store outside can be
// a `.book` too" — this is just the first one; the same load-or-build path serves any store `.book`.)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { captureBook } from "./capture.js";
import { sealColophon } from "./colophon.js";
import { getLibraryId, layBookOnLibrary, listLibrary } from "./library.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The precomputed genesis `.book` — a static artifact in the store (the `.word`s packaged). When
// present it is loaded cheaply instead of re-capturing the words live.
const GENESIS_BOOK_FILE = path.join(__dirname, "..", "genesis.book"); // seed/store/genesis.book

let _genesisRoot = null;

/** The colophon root of this story's genesis book — the anchor every book descends from. */
export function genesisRoot() { return _genesisRoot; }

// Every word declared on heaven "0" (the coin facts are the source of truth — the root language).
async function allSeedWordNames() {
  const Fact = (await import("../../past/fact/fact.js")).default;
  const coins = await Fact.find({ verb: "do", act: "coin", history: "0" }).select("params.word").lean();
  return [...new Set(coins.map((f) => f?.params?.word).filter(Boolean))];
}

/**
 * Build the genesis book LIVE: capture every seed word (the root language) into a book, titled by
 * the story, sealed by the I_AM (the story key — the first hand, the bottom of every lineage). This
 * is the one-time/build-tool path; prefer the precomputed `.book` file in normal operation.
 */
export async function buildGenesisBook() {
  const { getStoryDomain } = await import("../../ibp/address.js");
  const names = await allSeedWordNames();
  const storyName = process.env.STORY_NAME || getStoryDomain();
  const book = await captureBook({
    title: storyName,
    words: names,
    history: "0",
    sourceStory: getStoryDomain(),
    createdBy: "i-am",
  });
  return sealColophon(book); // default signer = the story identity (the I_AM key)
}

/** Load the precomputed genesis `.book` file (a static store artifact), or null if not built yet. */
export function loadGenesisBookFile() {
  try {
    if (!fs.existsSync(GENESIS_BOOK_FILE)) return null;
    return JSON.parse(fs.readFileSync(GENESIS_BOOK_FILE, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Build + WRITE the genesis `.book` file — the build tool (run once, or when the words change).
 * After this, ensureGenesisBook loads the static file instead of capturing the words live.
 * Returns the sealed book.
 */
export async function writeGenesisBookFile() {
  const book = await buildGenesisBook();
  fs.writeFileSync(GENESIS_BOOK_FILE, JSON.stringify(book));
  return book;
}

/**
 * Ensure the genesis book is the first volume in the Library — IDEMPOTENT and ON DEMAND (not a boot
 * step). If the reel already holds it, return its root. Otherwise lay it, preferring the precomputed
 * static `.book` file; falling back to a ONE-TIME live build if no file exists yet.
 */
export async function ensureGenesisBook() {
  const libraryId = await getLibraryId();
  if (!libraryId) return null; // library space not planted yet
  const existing = await listLibrary();
  if (existing.length > 0) {
    _genesisRoot = existing.find((e) => e.kind === "genesis")?.root ?? existing[0].root;
    return _genesisRoot;
  }

  const { withIAmAct } = await import("../../sprout.js");
  const { I_AM } = await import("../../materials/being/seedBeings.js");
  return withIAmAct("lay the genesis book", async (moment) => {
    const book = loadGenesisBookFile() || (await buildGenesisBook()); // static file, else one-time live build
    _genesisRoot = book?.colophon?.root ?? null;
    await layBookOnLibrary(book, { moment, through: I_AM, kind: "genesis" });
    return _genesisRoot;
  });
}
