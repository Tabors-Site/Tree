// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// being/inheritationOps.js — the two DO ops that move authority around
// the being-tree:
//
//   grant-inheritation    a Name with authority over a being-tree
//                         position hands ANOTHER Name an inheritation
//                         point there. The granted Name gains authority
//                         over that position and its whole subtree
//                         (downward), without owning any of it. This is
//                         delegation.
//   revoke-inheritation   the asymmetric counterpart. Removes a point
//                         previously granted. Read as latest-of-two by
//                         seq in inheritation.js (the lineage.js
//                         attach/detach pattern), so a later revoke wins
//                         over an earlier grant and vice-versa.
//
// Both target a being (the position). The granted Name rides in
// params.name. The fact lands on the POSITION being's reel (so
// inheritation.js can find points by target.id = position), attributed
// to the granting/revoking Name (the actor) on its own act-chain.
//
// WORD-SOLE (handler-less, Tabor's no-mirror law): neither op has a JS handler. Each op's world
// strand is its co-located `.word` — grant-inheritation.word / revoke-inheritation.word, the ONLY
// path (do.js runOpWord runs it). The CONTROL strand (the `name`-required gate + the return) is the
// .word; the genuine substrate READS + the authority gate — resolve the acting Name, the
// grantable-Name check (declared + not banished, grant only), and hasAuthorityOver(actingName,
// position) — are one host see-op, `resolve-inheritation` (inheritationHost.js), reusing the SAME
// loadProjection / isNameBanished / hasAuthorityOver the handlers called. The word returns
// { position, factParams:{name}, grantedBy|revokedBy }; runOpWord (stampsWordFact, idFrom:"position")
// lays the one caller-attributed do:grant/revoke-inheritation on the position being's reel, and
// inheritation.js folds it by params.name + seq exactly as before. No JS body, no adapter.
//
// Authority to grant or revoke at a position is authority OVER that position — exactly what
// hasAuthorityOver answers. authorize.js gates these the same way (inheritation coverage as a
// do-on-being fallback), and resolve-inheritation re-checks for defense in depth and for
// direct-call paths that bypass authorize. I (universal authority) always may.
//
// These self-register at module load; seed/services.js imports this
// file for side effects.

import { registerOperation } from "../../ibp/operations.js";
import { registerAbleWord } from "../../present/word/ableWordRegistry.js";
import { inheritationHostEnv } from "./inheritationHost.js";

// Self-register the co-located world strands so resolveAbleWord("inheritation", <op>) finds them.
registerAbleWord(
  "inheritation",
  "grant-inheritation",
  new URL("./grant-inheritation.word", import.meta.url),
);
registerAbleWord(
  "inheritation",
  "revoke-inheritation",
  new URL("./revoke-inheritation.word", import.meta.url),
);

// grant-inheritation — WORD-SOURCED. grant-inheritation.word + resolve-inheritation (mode "grant").
// SINGLE-WRITER: the fact lands on the position being's reel via idFrom:"position", attributed to
// the granting Name; the granted Name rides in params.name.
registerOperation("grant-inheritation", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "grant-inheritation",
  args: {
    name: { type: "text", label: "Name to grant authority to", required: true },
  },
  word: { noun: "being", able: "inheritation", idFrom: "position" },
  hostEnv: inheritationHostEnv,
});

// revoke-inheritation — WORD-SOURCED. revoke-inheritation.word + resolve-inheritation (mode
// "revoke"). Same authority + same reel as grant; the later of the two facts (by seq) decides
// liveness in inheritation.js.
registerOperation("revoke-inheritation", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "revoke-inheritation",
  args: {
    name: { type: "text", label: "Name whose point to remove", required: true },
  },
  word: { noun: "being", able: "inheritation", idFrom: "position" },
  hostEnv: inheritationHostEnv,
});
