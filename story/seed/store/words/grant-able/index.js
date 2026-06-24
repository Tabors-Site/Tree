// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// store/words/grant-able/index.js — the grant-able DO op, carved out of
// materials/being/ops.js into its own store-word bundle.
//
// Ables are auth (seed/AblesAreAuth.md). A being holds a able by
// being granted it; authorize walks ablesGranted and matches the
// able's canX against the verb+action.
//
// grant-able emits one Fact on the target being's reel. The being
// reducer (applyAbleGrants in reducerHelpers.js) folds it into
// qualities.ablesGranted:
//   grant-able  → append { able, anchorSpaceId|anchorBeingId, grantedBy }
//
// Duplicate grants from different grantors live as separate entries,
// each separately revocable. The being holds the able until ALL
// grants of (able, anchor) are revoked.
//
// Auth: the caller's right to grant able X is encoded in their own
// granted ables' canDo: a able with canDo entry `grant-able:X` (or
// `grant-able:*` for super-grantors like angel) permits granting X.
// The chain back to I-Am is structural.
//
// WORD-SOURCED (handler-less, Tabor's no-mirror law): grant-able has NO JS handler.
// Its world strand is grant-able.word — the ONLY path. The op registers a `word`
// descriptor ({ noun:"being", idFrom:"granteeBeingId" }) + its `hostEnv` (grantHostEnv);
// do.js's generic runOpWord resolves grant-able.word, runs it with the standard trigger,
// and promotes the word-authored `factParams` (the grant record) + the grantee target
// (granteeBeingId) via stampsWordFact. The op's WORLD effect is the one do:grant-able fact
// on the grantee's reel. No `_grantAbleViaWord` adapter, no JS body — registration only.

import { registerOperation } from "../../../ibp/operations.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { grantHostEnv } from "./grantHost.js";

// Self-register this slice's co-located WORLD strand (CONVERTING.md): the bridge
// resolves ("being", "grant-able") to grant-able.word, its host escapes wired by
// grantHost.js. Registered at module load (services.js imports this file at boot).
registerAbleWord("being", "grant-able", new URL("./grant-able.word", import.meta.url));

registerOperation("grant-able", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "grant-able",
  args: {
    able:          { type: "text", label: "Able to grant",       required: true },
    anchorSpaceId: { type: "text", label: "Anchor space id",     required: false },
    anchorBeingId: { type: "text", label: "Anchor being id",     required: false },
  },
  // The able-walk authorizes the FULL action `grant-able:<able>` so
  // canDo entries can scope grantors per-able: `grant-able:human`
  // grants only human; `grant-able:*` (or bare `grant-able`, the
  // namespace match) is the super-grantor shape. Without this, the
  // per-able contract documented above was never enforced — the walk
  // only ever saw the bare op name, so any grantor could grant ANY
  // able and `grant-able:X` entries matched nothing.
  authAction: ({ params }) =>
    typeof params?.able === "string" && params.able.length
      ? `grant-able:${params.able}`
      : "grant-able",
  // No idFrom: the fact targets the dispatch target (the grantee) by default, and its params
  // ARE the input grant (able + anchor). grantedBy is the signer (the fact's `through`), not
  // a params field. There is no grantedAt: a grant's when IS its fact's chain place (seq), not
  // a stored clock value. So the .word just validates + returns the caller-facing result.
  word: { noun: "being" },
  hostEnv: grantHostEnv,
});
