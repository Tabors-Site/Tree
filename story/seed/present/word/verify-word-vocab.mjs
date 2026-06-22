#!/usr/bin/env node
// verify-word-vocab — 14.md §4 step 1: a word-native role renders its vocabulary as WORD GRAMMAR
// (the words it may speak), not JSON tool schemas. Boot-free: drives renderVocabularyAsWord directly.
import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
// Set env so the import-time config checks pass — NO boot, NO DB connection; renderVocabularyAsWord
// only needs the literal can* pass-through (the resolver registry is empty).
process.env.MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/story_wordvocab_noconnect";
process.env.PORT = process.env.PORT || "3856";
process.env.JWT_SECRET = process.env.JWT_SECRET || "wordvocab-0123456789";
process.env.STORY_KEY_DIR = process.env.STORY_KEY_DIR || path.join(os.tmpdir(), "wordvocab-keys");
process.env.SOURCE_TREE_ROOT = process.env.SOURCE_TREE_ROOT || path.join(os.tmpdir(), "wordvocab-src");
const { renderVocabularyAsWord } = await import(`${R}/seed/present/cognition/llm/assemble.js`);
const { formatInnerFaceBlocksAsWord } = await import(`${R}/seed/present/cognition/llm/innerFaceFormat.js`);

let pass = 0, fail = 0; const ok = (l) => { pass++; console.log("  ✓ " + l); }; const bad = (l, d) => { fail++; console.log("  ✗ " + l); if (d !== undefined) console.log("      " + JSON.stringify(d).slice(0, 300)); };
console.log("\n  verify-word-vocab (14.md §4.1: the vocabulary renders as Word, not JSON)\n");
try {
  const role = {
    name: "test",
    canDo: [{ name: "create-space", description: "make a space" }, "move"],
    canSummon: ["tabor", { name: "coach", as: "receiver" }], // receiver entry must be filtered out
    canBe: ["birth"],
  };
  const out = await renderVocabularyAsWord(role, {});

  /do create-space <target>\./.test(out)
    ? ok("a granted do-word renders as Word grammar: `do create-space <target>.`")
    : bad("do-word not rendered as Word", out);

  /do create-space <target>\.\s+— make a space/.test(out)
    ? ok("the description rides as a guide (`— make a space`)")
    : bad("description not rendered", out);

  /do move <target>\./.test(out)
    ? ok("a bare-string grant renders too: `do move <target>.`")
    : bad("bare-string grant not rendered", out);

  (/call @tabor "<said>"\./.test(out) && !/coach/.test(out))
    ? ok("a call target renders `call @tabor \"<said>\".`; the receiver-side `coach` is filtered out")
    : bad("call/receiver handling wrong", out);

  /be birth\./.test(out)
    ? ok("a be-op renders `be birth.`")
    : bad("be-op not rendered", out);

  (/not JSON/.test(out) && /see <address>\./.test(out) && /Speak your one Word/.test(out))
    ? ok("the frame instructs one Word, not JSON, + the `see <address>.` look")
    : bad("framing missing", out);

  (!/parameters/.test(out) && !/"type"\s*:/.test(out) && !/JSON\.stringify/.test(out))
    ? ok("NO JSON tool-schema artifacts (no `parameters`, no `\"type\":`) — pure Word grammar")
    : bad("JSON schema leaked into the vocabulary", out);

  // The FACE half: the canSee blocks (facts folded from the reels at position) render as WORD, not JSON.
  const innerFace = { blocks: [
    { label: "here", payload: { space: "grid", beings: [{ name: "tabor", role: "coder" }], full: false } },
    { payload: "the grid is open." }, // a string block: already Word, passes through
  ] };
  const face = formatInnerFaceBlocksAsWord(innerFace);
  (/space: grid/.test(face) && /name tabor, role coder/.test(face) && /the grid is open\./.test(face) && !/[{}]/.test(face))
    ? ok("the face renders as Word — present-tense lines + string pass-through, NO JSON braces")
    : bad("face-as-Word wrong", face);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
} catch (e) {
  console.log("  ✗ threw: " + e.message); console.log("    " + String(e.stack).split("\n").slice(1, 6).join("\n    "));
  fail++;
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
}
process.exit(fail > 0 ? 1 : 0);
