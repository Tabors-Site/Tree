// grantHost.js — host env for grant-able.word's two escapes. Both reuse the SAME
// primitives the grant-able JS handler calls (no reimplementation):
//   ableExists(able) — the able-registry lookup (getAble); a able can't be granted unless
//                      it's registered. A bounded compute, not a substrate read.
//   grantStamp()     — the grant's wall-clock instant (the SAME new Date().toISOString()
//                      the JS handler stamps into params.grantedAt). This is the ONE
//                      external-resource escape: the story has no clock of its own, so
//                      the timestamp is reached through this host fn, NEVER the evaluation
//                      loop (the time-doctrine; same shape as credential-reset's resetAt).
//                      The grant record carries it; expiry stays a moment concept (no clock).
import { getAble } from "../../../present/ables/registry.js";

export function grantHostEnv() {
  return {
    "able-exists": ({ args: [able] }) => !!getAble(String(able || "")),
    "grant-stamp": () => new Date().toISOString(),
  };
}
