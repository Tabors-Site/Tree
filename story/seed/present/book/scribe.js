// The SCRIBE's hands — ground + validate a Word draft against what's there, WITHOUT pressing.
//
// The scribe (present/ables/scribe) is an LLM being that proposes the Word from your intent;
// this is the code half it (and book view) leans on: the proofread/ground/refuse guard. It
// READS, never writes. A draft is returned for YOU to press (typeIntoBook, signed by your
// nameId). The scribe shapes the ink; you bring the stamp down. A draft that can't be pressed
// is not a draft — so draftWord returns `pressable` only when the line both parses (it IS the
// Word) and grounds (the place as it stands can hold the act).

export async function draftWord(candidate, { history = "0", position = null } = {}) {
  const { parse } = await import("../word/parser.js");
  const issues = [];

  let statements;
  try {
    statements = parse(candidate);
  } catch (err) {
    return {
      draft: candidate, parses: false, grounded: false, pressable: false,
      issues: [`that doesn't resolve to the Word (${err.message})`],
    };
  }
  if (!statements.length) {
    return { draft: candidate, parses: false, grounded: false, pressable: false, issues: ["there is nothing here to press"] };
  }

  // ground: does each line have what it needs in the world as it stands? (validity by
  // construction — refuse to call pressable a line that would not resolve)
  for (const s of statements) {
    if (s.kind === "act" && s.act === "create-space" && !position) {
      issues.push("you are nowhere to make this — stand in a space first");
    }
  }

  const grounded = issues.length === 0;
  return { draft: candidate, statements: statements.length, parses: true, grounded, pressable: grounded, issues };
}
