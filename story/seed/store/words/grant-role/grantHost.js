// grantHost.js — host env for grant-role.word's two escapes. Both reuse the SAME
// primitives the grant-role JS handler calls (no reimplementation):
//   roleExists(role) — the role-registry lookup (getRole); a role can't be granted unless
//                      it's registered. A bounded compute, not a substrate read.
//   grantStamp()     — the grant's wall-clock instant (the SAME new Date().toISOString()
//                      the JS handler stamps into params.grantedAt). This is the ONE
//                      external-resource escape: the story has no clock of its own, so
//                      the timestamp is reached through this host fn, NEVER the evaluation
//                      loop (the time-doctrine; same shape as credential-reset's resetAt).
//                      The grant record carries it; expiry stays a moment concept (no clock).
import { getRole } from "../../../present/roles/registry.js";

export function grantHostEnv() {
  return {
    "role-exists": ({ args: [role] }) => !!getRole(String(role || "")),
    "grant-stamp": () => new Date().toISOString(),
  };
}
