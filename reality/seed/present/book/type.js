// The LIVE-TYPING half of book view — press a Word line into your act, watch it land at the
// live edge. The inverse of assemble.js: that READS the book (the past, frozen), this WRITES
// the next line (always the present). Parse the typed Word → evaluate each statement in the
// reader's OPEN act (the stamper) → facts land at the live edge → assembleBook's tail shows
// them. The caller opens the act (withIAmAct, or the reader's portal session) and seals it:
// this shapes the ink, the act brings the stamp down. You can only ever write at the edge —
// the statement resolves NOW, never into the past (presentism + append-only).
//
// Returns what was laid (the new beads) so the view can re-read just the tail (the live
// update) rather than the whole book.

export async function typeIntoBook(wordText, { summonCtx, identity, branch = "0", position = null, bindings = {}, env = {} } = {}) {
  if (!summonCtx || !Array.isArray(summonCtx.deltaF)) {
    throw new Error("typeIntoBook: needs an OPEN act (summonCtx with deltaF) — the press happens inside a moment");
  }
  const { parse } = await import("../word/parser.js");
  const { evaluate } = await import("../word/evaluator.js");

  let statements;
  try {
    statements = parse(wordText);
  } catch (err) {
    return { ok: false, where: "parse", error: err.message, statements: 0, laid: [] };
  }

  const ctx = {
    dryRun: false, branch, summonCtx, identity,
    position,                               // where the typist stands — "make here" parents to it
    env, bindings, deltaF: summonCtx.deltaF, flows: [],
  };
  const before = summonCtx.deltaF.length;

  try {
    for (const stmt of statements) await evaluate(stmt, ctx);
  } catch (err) {
    // a Word refusal (a gate said no) or a real fault — the press fails, nothing forced
    return {
      ok: false, where: "evaluate", error: err.message, refusal: !!err.__wordRefusal,
      statements: statements.length, laid: summonCtx.deltaF.slice(before).map(glance),
    };
  }

  const laid = summonCtx.deltaF.slice(before);
  return {
    ok: true, statements: statements.length,
    laid: laid.map(glance),                 // the new lines, as they'll read in the book
    bindings: ctx.bindings, result: ctx.result,
  };
}

const glance = (f) => `${f.verb}:${f.action}${f.target ? ` → ${f.target.kind}:${String(f.target.id ?? "").slice(0, 12)}` : ""}`;
