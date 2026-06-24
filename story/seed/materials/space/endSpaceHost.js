// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// endSpaceHost.js — the floor see-op for end-space.word (space/ops.js, the end-space DO op).
//
// The CONTROL strand (the return) is the .word; the genuine substrate READS + read-after-write
// hygiene this op needs are one host see-op, `resolve-end-space-spec`:
//   - the OWNER / not-root authority check (resolveSpaceAccess walks the ancestor chain) + the
//     getSpaceOwner read — only the resolved owner may end a non-root space; root spaces only from
//     root view; non-I actors gated, I bypasses (genesis / registry mirrors),
//   - the already-deleted refusal (the loaded row's parent === DELETED),
//   - the beforeSpaceDelete hook (extensions may cancel),
//   - the per-reel lock (brackets the soft-delete so a concurrent fold sees a coherent slot) +
//     invalidateSpace (read-after-write cache hygiene, same class set-space's host runs).
// It REUSES the SAME primitive the JS handler called (deleteSpaceHistory), which loads the row, runs
// every gate, acquires/releases the lock, invalidates, and mutates ONLY an in-memory view (it lays NO
// fact — the do:end-space auto-Fact the dispatcher stamps IS the act; the space reducer DERIVES
// parent→DELETED + position→DELETED + owner→the deleter from the fact's act + `through`). It
// reimplements nothing. The .word reaches it through `see`; a host throw is the .word's refusal — a
// READ. Mirrors set-space's setSpaceHost.js (resolve-set-space-spec).
//
// THE BLOCK it returns is { spaceId } — the death space id (the .word promotes it via idFrom:"spaceId"
// as the fact TARGET). NO factParams: the reducer derives the whole fold from the fact's act + through,
// so the do:end-space fact carries verb:do, act:end-space, of:{space,id}, through:deleter, EMPTY params
// — byte-identical to the pre-conversion handler's auto-Fact (ctx.params was {} there too).
//
// The actor (deleter) rides ctx.identity.beingId — CALLER mode (no `through`): runAbleWord sets
// identity = moment.identity, the real caller. I-internal flows (genesis, boot mirror sync) carry
// identity.beingId = I, which deleteSpaceHistory's `beingId !== I` gate bypasses, exactly as before.

import { deleteSpaceHistory } from "./spaces.js";

export function endSpaceHostEnv() {
  return {
    // resolve-end-space-spec(target, branch) — the genuine substrate read + the soft-delete gate +
    // the read-after-write hygiene. Loads the space, runs the owner/not-root authority check, the
    // already-deleted refusal, and the beforeSpaceDelete hook; acquires/releases the per-reel lock;
    // invalidates the cache. Lays NO fact (the reducer derives the fold). Returns { spaceId }.
    "resolve-end-space-spec": async ({ args: [target, branch] }, ctx) => {
      const { targetIdOf } = await import("../_targetShape.js");
      const spaceId = targetIdOf(target);
      // The actor is whoever called. I-internal flows (registry mirror sync at genesis + boot) carry
      // identity.beingId = I; deleteSpaceHistory's `beingId !== I` gate bypasses for I, as before.
      const actorBeingId = ctx?.identity?.beingId || null;
      const deleted = await deleteSpaceHistory(
        spaceId,
        actorBeingId,
        // actId is unused by deleteSpaceHistory (it lays no fact — the do:end-space auto-Fact is the
        // act); pass the open moment's actId regardless to mirror the old handler's call exactly.
        ctx?.moment?.actId || null,
      );
      return { spaceId: String(deleted?._id || spaceId) };
    },
  };
}
