// TreeOS Place . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// bootContext — the single-use credential bridge between plant and
// genesis.
//
// plant.js (the node-level wizard, above the seed) gathers three
// strings from the human at first plant: their name, the password
// on their new being, and their consent to genesis. plant gathers;
// plant does not mint. At plant time there is no being, no fact,
// no moment — only a node process holding strings.
//
// genesis.js (inside the seed) does the minting. After the I-Am's
// first moment ("I am that I am") and after the cherub is alive,
// genesis calls cherub to register the operator being — using the
// name and password plant gathered. The operator being is the
// first inhabitant: named, password-claimable, born by the
// ordinary cherub-authors-BE mechanism. Only the I-Am's birth is
// special.
//
// This module is the seam. plant writes once; genesis consumes
// once. The credentials live only in memory, only for the
// duration of one boot, and the call-and-clear pattern prevents
// any later code from reading them by accident.
//
// File lives at place/ root because it sits between plant.js
// (above seed) and seed/. Neither is the natural home — this is
// the bridge.

let _plantContext = null;

/**
 * Plant calls this with the operator credentials it gathered.
 * Single-use: a second call overwrites; genesis's consume() empties
 * the slot.
 *
 * @param {object} ctx
 * @param {string} ctx.operatorName       — what the human typed at the name prompt
 * @param {string} ctx.operatorPassword   — what the human typed at the password prompt
 */
export function setPlantContext(ctx) {
  _plantContext = ctx;
}

/**
 * Genesis calls this once. Returns whatever plant stashed (or null)
 * and clears the slot — the credentials cannot be read twice.
 */
export function consumePlantContext() {
  const ctx = _plantContext;
  _plantContext = null;
  return ctx;
}
