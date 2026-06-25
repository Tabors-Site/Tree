// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// `do create-matter` — bring new matter into a space. One fact per birth (the spacebar
// lift): the compute is the taps (lays nothing), the dispatcher's single do:create-matter
// stamp is the finished mark.
//
// WORD-SOURCED (handler-less, Tabor's no-mirror law): create-matter has NO JS handler. Its
// world strand is create-matter.word — the ONLY path. The op registers a `word` descriptor
// ({ noun:"matter", idFrom:"matterId" }) + its `hostEnv` (matterHostEnv); the dispatcher's
// generic runOpWord (do.js) resolves the word, runs it with the standard trigger
// { target, targetKind, params, caller, branch }, and promotes the word-authored `factParams`
// (the enriched birth spec) + the content-addressed matterId target via stampsWordFact. There
// is no `_createMatterViaWord` adapter and no JS body — this file is registration only.
//
// The compute (resolve-birth-spec: name resolution, matter-type classification, content
// shaping + CAS store, coord-bounds, the content-addressed id mint) lives in matterHost.js as
// the see-escapes the .word reaches — it lays NO fact (a read of the floor).

import { registerOperation } from "../../../ibp/operations.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { matterHostEnv } from "./matterHost.js";

// Self-register this slice's co-located WORLD strand (CONVERTING.md): the bridge resolves
// ("matter", "create-matter") to create-matter.word. Registered at module load.
registerAbleWord("matter", "create-matter", new URL("./create-matter.word", import.meta.url));

// WORD-SOURCED registration — no handler. do.js routes this through runOpWord (CALLER mode),
// which runs create-matter.word and stamps the one caller-attributed do:create-matter fact,
// target forced to the new MATTER via idFrom.
registerOperation("create-matter", {
  targets: ["space", "matter", "stance"],
  ownerExtension: "seed",
  factAction: "create-matter",
  args: {
    name: { type: "text", label: "Name (defaults to the uploaded filename)", required: false },
    type: { type: "text", label: "Matter type (omit to classify from the content)", required: false },
    content: { type: "multiline", label: "Content (text, a cas ref from upload, or a reference object like {url}; optional)", required: false },
    coord: { type: "json", label: "Position {x,y,z?} inside the space (optional)", required: false },
  },
  // The able-walk sees `create-matter:<type>` so ables can scope which matter types they may
  // bring into the world — bare `create-matter` entries keep matching (namespace semantics).
  authAction: ({ params }) =>
    typeof params?.type === "string" && params.type.length
      ? `create-matter:${params.type}`
      : "create-matter",
  word: { noun: "matter", idFrom: "matterId" },
  hostEnv: matterHostEnv,
});
