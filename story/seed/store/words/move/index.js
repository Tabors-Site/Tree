// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// `do move` — pick up a space or matter and put it somewhere else. One unified
// relocation action with two modes, discriminated by which param the caller passes:
//
//   coord mode (`params.coord = { x, y[, z] }`)  — move the subject to a different spot
//     inside its current containing space (matter cell (3,4)→(7,2); a child tree to a new
//     spot in its parent). No container change.
//   container mode (`params.to = <spaceId>`)     — carry the subject across a doorway into
//     a different space (matter follows the carrier into the next room; a child tree is
//     reparented under another tree).
//
// The subject is the DISPATCH target ({kind,id}). Beings are not a move target — beings
// move themselves through set-being:coord / set-being:position; `move` is what beings do
// TO things in their world.
//
// WORD-SOURCED (handler-less, Tabor's no-mirror law): move has NO JS handler. Its world
// strand is move.word — the ONLY path. The op registers a `word` descriptor + its `hostEnv`
// (moveHostEnv); the dispatcher's generic runOpWord (do.js) resolves the word, runs it with
// the standard trigger { target, targetId, coord, to, branch, ... }, and promotes the
// word-authored fact (factParams { moved, mode, fromSpaceId } + factTarget { kind, id })
// via stampsWordFact. There is no `_moveViaWord` adapter and no JS body — this file is
// registration only.
//
// DYNAMIC fact kind: the moved subject is space OR matter, so the fact reel varies. The
// word names both via a {kind,id} factTarget (stampsWordFact honors the object kind, not
// the op's noun), so NO idFrom — the word authors its own target. `noun: "matter"` is the
// registry's required default; the word's factTarget overrides it per move.
//
// move.word VALIDATES (the mode fork + every refuse) and READS the source space (resolve-
// source, the ONE host escape — moveHost.js — the multi-step projection read that captures
// fromSpaceId for stamped.js's live-SEE invalidate). The dispatcher then lays the ONE
// caller-attributed do:move on the moved subject's reel; the right reducer (space → parent,
// matter → spaceId, coord either) folds it.

import { registerOperation } from "../../../ibp/operations.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { moveHostEnv } from "./moveHost.js";

// Self-register this slice's co-located WORLD strand (CONVERTING.md): the bridge resolves
// ("move", "move") to move.word, its host escape wired by moveHost.js. Registered at module
// load (services.js imports this file at seed boot).
registerAbleWord("move", "move", new URL("./move.word", import.meta.url));

// WORD-SOURCED registration — no handler. do.js routes this through runOpWord (CALLER mode),
// which runs move.word and stamps the one caller-attributed do:move fact on the moved
// subject (dynamic kind via the word's factTarget).
registerOperation("move", {
  targets: ["space", "matter"],
  ownerExtension: "seed",
  factAction: "move",
  args: {
    target: { type: "json", label: "Subject { kind, id } (optional if implied by position)", required: false },
    to: { type: "text", label: "Destination space id (container move)", required: false },
    coord: { type: "json", label: "Coord { x, y } (in-space move)", required: false },
  },
  word: { noun: "matter", able: "move" },
  hostEnv: moveHostEnv,
});
