// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// run.js — the loop over moments for one summon.
//
// A being doesn't live a moment. It lives a stream of them. When
// the moments come in a driven loop, that loop is the run.
// See philosophy/MOMENT.md "The stream, the run, the two chains."
//
// Two run shapes today:
//
//   LLM run (internal). One SUMMON to an LLM being unrolls into
//     many moments inside the present: the LLM folds, perceives
//     (SEE-shaped moments), decides, may take an act (DO/BE), then
//     folds again with the act's facts on the reel — and continues
//     until it answers. The loop runs INSIDE the present, driven
//     by the LLM voice's tool dispatch in voices/llm/runTurn.js.
//     That file is the home of the loop body today; this file
//     names the concept.
//
//   Human run (external). One wire-call per moment. The human's
//     own life is the loop; the present sees one moment at a time
//     come in from the transport. No internal loop is needed
//     because the human is already running theirs externally.
//
// Same atom either way — one moment is fold + at-most-one-act +
// seal. Only the location of the loop differs.
//
// What lives here as code, eventually:
//   - The LLM tool-call loop lifted out of voices/llm/runTurn.js
//     and named for what it is — `runForSummon(...)`.
//   - The per-summon bookkeeping that's currently fused with the
//     LLM voice (iteration cap, compress trigger, abort propagation
//     to nested moments).
//   - Hooks so other voices (a future scripted-loop voice, an
//     external-driver agent) can declare their own run shape.
//
// What lives here as concept today: nothing in code yet. The LLM's
// loop body is in voices/llm/runTurn.js; the per-being intake drain
// is in intake/scheduler.js. Both predate the run.js naming. This
// file is a docked seat for the consolidated form; calling it out
// here keeps run.js next to intake/ per doctrine.

export const RUN_DOCTRINE = `
A being lives a stream of moments. When those moments come in a
driven loop, the loop is the run. LLMs run inside the present;
humans run outside it. Same atom either way: fold, at-most-one-act,
seal.
`;
