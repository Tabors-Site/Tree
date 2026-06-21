// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// switchHost.js — the floor see-ops for switch.word (be:switch).
//
// Three irreducible reads the control strand reaches through `see`: is the destination history
// missing (not found / deleted), is it paused, and does the caller's reel fold to a LIVING birth
// there. Reimplements nothing — wires the same isMain / loadHistory / loadOrFold the be.js switch
// handler called. The SESSION seat (socket.currentHistory) is the verb/transport's job (stamp-then-
// seat), never a floor read. Mirrors deathHost.js / truenameHost.js.

export function switchHostEnv() {
  return {
    // not-found OR deleted (both invalid-input). main always exists.
    "destination-missing": async ({ args: [history] }) => {
      const { isMain, loadHistory } =
        await import("../../../materials/history/histories.js");
      const h = String(history || "");
      if (isMain(h)) return false;
      const row = await loadHistory(h);
      return !row || !!row.deleted;
    },
    // paused (story-paused — a live history that is frozen for writes, not bogus). main is never paused.
    "destination-paused": async ({ args: [history] }) => {
      const { isMain, loadHistory } =
        await import("../../../materials/history/histories.js");
      const h = String(history || "");
      if (isMain(h)) return false;
      const row = await loadHistory(h);
      return !!(row && row.paused);
    },
    // A session may only seat where the being's reel folds to a LIVING birth on that history's
    // lineage view: a name (born here, not after the fork) and no death. Else a switch would stamp
    // be:switch as the first fact of an orphan reel (a biography with no be:birth).
    "being-lives-on": async ({ args: [caller, history] }) => {
      const { loadOrFold } = await import("../../../materials/projections.js");
      const destSlot = await loadOrFold("being", String(caller), String(history));
      return !!(destSlot?.state?.name && !destSlot?.state?.qualities?.death?.time);
    },
  };
}
