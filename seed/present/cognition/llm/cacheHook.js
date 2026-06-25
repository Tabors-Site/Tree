// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// cacheHook.js — bust the per-being LLM client cache when a being's reel receives a fact.
//
// The llm-connection ops (add / assign-llm-slot / update / delete) are now WORD-SOLE; their old JS
// handlers each did a post-fact clearBeingClientCache so a being's next LLM call picked up the new
// connection/slot immediately. A cache invalidation is NOT a fact, so the handler-less words drop
// it — and this fold-hook is its proper home: on afterReelArrival (which fires AFTER the batch
// seals, so the new config is already folded), clear the client cache for every being reel that
// changed. The next resolveClient re-reads the fresh qualities.llmConnections / beingLlm.slots.
//
// Reel-granular: there is no field in the payload, so this also clears on being writes that aren't
// LLM-related (a coord move, a grant). That is SAFE — over-invalidating a cache only costs a
// re-populate on next use, never correctness — and bounded, since a being's own reel only gets a
// fact when the being is modified (not on every turn it takes acting on others). The precise
// alternative (clearing inside the llm see) is fragile under the multi-moment runWordToStore model,
// where the see runs in a read-ambient moment with no afterSeal of its own.
import { hooks } from "../../../hooks.js";
import { clearBeingClientCache } from "./connect.js";

let _registered = false;

// Register the hook once. Called from genesis after the cognition layer is wired; idempotent so a
// re-import (or a re-boot in the same process, as the test rig does) never double-registers.
export function registerLlmCacheHook() {
  if (_registered) return;
  _registered = true;
  hooks.register(
    "afterReelArrival",
    async ({ reels }) => {
      for (const r of reels || []) {
        if (r && r.reelKind === "being") clearBeingClientCache(String(r.reelId));
      }
    },
    "seed",
  );
}
