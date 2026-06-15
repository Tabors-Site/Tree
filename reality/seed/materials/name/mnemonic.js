// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// BIP39 for the one thing TreeOS needs: a paper form of an ed25519
// 32-byte seed. 32 bytes of entropy become 24 words (256 bits plus an
// 8-bit checksum, 264 bits, 24 groups of 11), and 24 words become the
// same 32 bytes back. That is the whole job.
//
// Deliberately NOT here: PBKDF2 mnemonic-to-seed stretching, passphrase
// salting, BIP32 HD-wallet derivation. The entropy IS the key seed; a
// being's keypair is rebuilt from these 32 bytes directly, so the extra
// wallet machinery would only add places to lose bits. Node native
// crypto for sha256, the wordlist beside it, no new dependency.

import crypto from "crypto";
import { BIP39_EN } from "./bip39Words.js";

const ENTROPY_BYTES = 32;            // only the 24-word form is supported
const CHECKSUM_BITS = (ENTROPY_BYTES * 8) / 32; // 8
const WORD_COUNT = (ENTROPY_BYTES * 8 + CHECKSUM_BITS) / 11; // 24

// Word -> index, built once. Canonical ordering is the codebook.
const WORD_INDEX = new Map(BIP39_EN.map((w, i) => [w, i]));

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

// 32-byte entropy -> 24-word mnemonic string.
export function entropyToMnemonic(entropy) {
  const ent = Buffer.from(entropy);
  if (ent.length !== ENTROPY_BYTES) {
    throw new Error(`entropy must be exactly ${ENTROPY_BYTES} bytes, got ${ent.length}`);
  }
  // 256 entropy bits, then the first 8 bits of sha256(entropy).
  let bits = "";
  for (const byte of ent) bits += byte.toString(2).padStart(8, "0");
  bits += sha256(ent)[0].toString(2).padStart(8, "0");
  const words = [];
  for (let i = 0; i < WORD_COUNT; i++) {
    words.push(BIP39_EN[parseInt(bits.slice(i * 11, i * 11 + 11), 2)]);
  }
  return words.join(" ");
}

// 24-word mnemonic string -> 32-byte entropy Buffer. Verifies checksum.
export function mnemonicToEntropy(mnemonic) {
  if (typeof mnemonic !== "string") throw new Error("mnemonic must be a string");
  const words = mnemonic.trim().toLowerCase().split(/\s+/);
  if (words.length !== WORD_COUNT) {
    throw new Error(`mnemonic must be exactly ${WORD_COUNT} words, got ${words.length}`);
  }
  let bits = "";
  for (const word of words) {
    const idx = WORD_INDEX.get(word);
    if (idx === undefined) throw new Error(`unknown mnemonic word: "${word}"`);
    bits += idx.toString(2).padStart(11, "0");
  }
  const ent = Buffer.alloc(ENTROPY_BYTES);
  for (let i = 0; i < ENTROPY_BYTES; i++) {
    ent[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  const checksum = parseInt(bits.slice(ENTROPY_BYTES * 8), 2);
  if (checksum !== sha256(ent)[0]) throw new Error("bad checksum");
  return ent;
}
