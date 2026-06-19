// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Branch path arithmetic — parsing and segment generation.
//
// Paths form a tree rooted at `"0"` (main). Each level alternates
// between numeric and alphabetic segments:
//
//   Level 0:  "0"       (main; no segment)
//   Level 1:  "1", "2", "3", ...                  (numbers)
//   Level 2:  "1a", "1b", ..., "1z", "1za", ...   (letters)
//   Level 3:  "1a1", "1a2", ...                   (numbers)
//
// Letter wrap: when more than 26 children are needed at a letter
// level, segments grow to two characters, then three, etc. The
// scheme prefixes z's and cycles the trailing character through a-z:
//
//   1st letter:  "a"
//   26th letter: "z"
//   27th letter: "za"
//   28th letter: "zb"
//   52nd letter: "zz"
//   53rd letter: "zza"
//   ...
//
// Numbers grow by ordinary decimal counting: "1", "2", ..., "9",
// "10", "11", ... — no special encoding needed.
//
// Branch numbering is STABLE: once #1 exists, the next branch off
// main is always #2 even if #1 is later deleted. The next-segment
// computation picks "the highest existing segment + 1" rather than
// "the count of existing siblings," so re-use is impossible.

const RE_DIGIT  = /^[0-9]+$/;
const RE_LETTER = /^[a-z]+$/;

/**
 * Parse a branch path into ordered segments.
 *
 * "0" → []           (main has no segments)
 * "1" → ["1"]
 * "1a" → ["1", "a"]
 * "22zb3" → ["22", "zb", "3"]
 *
 * @param {string} path
 * @returns {string[]}
 */
export function parseBranchPath(path) {
  if (path == null || path === "" || path === "0") return [];
  const out = [];
  let buf = "";
  let mode = null; // "number" | "letter"
  for (const ch of String(path)) {
    const isDigit  = ch >= "0" && ch <= "9";
    const isLetter = ch >= "a" && ch <= "z";
    if (!isDigit && !isLetter) {
      throw new Error(`parseBranchPath: invalid char "${ch}" in path "${path}"`);
    }
    const chMode = isDigit ? "number" : "letter";
    if (mode === null) mode = chMode;
    if (chMode === mode) {
      buf += ch;
    } else {
      out.push(buf);
      buf = ch;
      mode = chMode;
    }
  }
  if (buf) out.push(buf);

  // Validate alternation: first segment must be a number; segments
  // must alternate from there.
  let expected = "number";
  for (let i = 0; i < out.length; i++) {
    const seg = out[i];
    const got = RE_DIGIT.test(seg) ? "number" : RE_LETTER.test(seg) ? "letter" : "invalid";
    if (got !== expected) {
      throw new Error(`parseBranchPath: segment[${i}] "${seg}" violates alternation in path "${path}"`);
    }
    expected = expected === "number" ? "letter" : "number";
  }
  return out;
}

/**
 * The expected segment TYPE at the next level under the given path.
 * Main's children are numbers; numbers' children are letters; letters'
 * children are numbers — alternating.
 *
 * @param {string} parentPath
 * @returns {"number"|"letter"}
 */
export function nextSegmentType(parentPath) {
  const segs = parseBranchPath(parentPath);
  // Level 0 (main, segs.length === 0) → next child is level 1 → number.
  // After that the parent's depth tells us what the NEXT level expects.
  // Parent's last segment is at depth = segs.length. Its children are
  // at depth segs.length + 1.
  const childDepth = segs.length + 1;
  return childDepth % 2 === 1 ? "number" : "letter";
}

/**
 * Compute the next letter segment given the list of existing letter
 * siblings. Uses the z-prefix scheme: a..z, za..zz, zza..zzz, ...
 *
 * @param {string[]} existingLetterSegments
 * @returns {string}
 */
export function nextLetterSegment(existingLetterSegments) {
  // Convert each existing segment to its 1-based ordinal in the
  // z-prefix scheme, then pick (max + 1).
  let maxOrdinal = 0;
  for (const seg of existingLetterSegments) {
    if (!RE_LETTER.test(seg)) continue;
    const ord = letterSegmentToOrdinal(seg);
    if (ord > maxOrdinal) maxOrdinal = ord;
  }
  return ordinalToLetterSegment(maxOrdinal + 1);
}

/**
 * Convert a 1-based ordinal to a letter segment using the z-prefix
 * scheme. 1→"a", 26→"z", 27→"za", 28→"zb", 52→"zz", 53→"zza", …
 *
 * @param {number} ordinal  >= 1
 * @returns {string}
 */
export function ordinalToLetterSegment(ordinal) {
  if (!Number.isInteger(ordinal) || ordinal < 1) {
    throw new Error(`ordinalToLetterSegment: ordinal must be >= 1, got ${ordinal}`);
  }
  // Each "z-block" holds 26 ordinals. Block 0 = a-z (ord 1-26);
  // block 1 = za-zz (27-52); block 2 = zza-zzz (53-78); etc.
  const block = Math.floor((ordinal - 1) / 26);
  const offset = (ordinal - 1) % 26; // 0-25
  const finalChar = String.fromCharCode("a".charCodeAt(0) + offset);
  return "z".repeat(block) + finalChar;
}

/**
 * Inverse of ordinalToLetterSegment. "a"→1, "z"→26, "za"→27, "zb"→28, ...
 *
 * @param {string} seg
 * @returns {number}
 */
export function letterSegmentToOrdinal(seg) {
  if (!RE_LETTER.test(seg)) {
    throw new Error(`letterSegmentToOrdinal: "${seg}" is not a letter segment`);
  }
  // All leading characters must be 'z' (z-block prefix); the trailing
  // character is a-z.
  for (let i = 0; i < seg.length - 1; i++) {
    if (seg[i] !== "z") {
      throw new Error(`letterSegmentToOrdinal: "${seg}" violates the z-prefix scheme`);
    }
  }
  const block = seg.length - 1;
  const finalChar = seg[seg.length - 1];
  const offset = finalChar.charCodeAt(0) - "a".charCodeAt(0);
  return block * 26 + offset + 1;
}

/**
 * Compute the next number segment given existing siblings. Just
 * decimal: existing { "1", "2", "5" } → "6".
 *
 * @param {string[]} existingNumberSegments
 * @returns {string}
 */
export function nextNumberSegment(existingNumberSegments) {
  let maxN = 0;
  for (const seg of existingNumberSegments) {
    if (!RE_DIGIT.test(seg)) continue;
    const n = Number(seg);
    if (Number.isInteger(n) && n > maxN) maxN = n;
  }
  return String(maxN + 1);
}

/**
 * Concatenate a parent path with the next available segment, picking
 * the right type per the alternation rule.
 *
 * @param {string} parentPath          "0" for main, otherwise a valid path
 * @param {string[]} existingChildren  paths of existing direct children of parentPath
 * @returns {string} the new branch's path
 */
export function nextChildPath(parentPath, existingChildren) {
  const parentSegs = parseBranchPath(parentPath);
  const expected = nextSegmentType(parentPath);
  // Extract the last-segment of each existing child (the new segment
  // added at this child's level).
  const childSegs = [];
  for (const c of existingChildren) {
    const segs = parseBranchPath(c);
    if (segs.length !== parentSegs.length + 1) continue; // not a direct child
    // Validate the prefix matches.
    let prefixOK = true;
    for (let i = 0; i < parentSegs.length; i++) {
      if (segs[i] !== parentSegs[i]) { prefixOK = false; break; }
    }
    if (!prefixOK) continue;
    childSegs.push(segs[segs.length - 1]);
  }
  const newSeg = expected === "number"
    ? nextNumberSegment(childSegs)
    : nextLetterSegment(childSegs);
  return parentSegs.join("") + newSeg;
}

/**
 * Validate that a string is a syntactically well-formed branch path.
 * Returns true / false. For exception-based validation, call
 * parseBranchPath and catch.
 */
export function isValidBranchPath(path) {
  if (path === "0" || path === "") return true;
  try {
    parseBranchPath(path);
    return true;
  } catch {
    return false;
  }
}
