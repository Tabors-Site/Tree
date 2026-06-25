#!/usr/bin/env node
// The four STORY views, side by side: world / being / place / lineage. The new story panel as
// a CLI probe. Full boot, scratch DB. (If the fact-field rename has fact-stamping down, the
// world story will be empty — that's the transition, not a story-layer bug.)

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH = path.join(os.tmpdir(), "story_story-" + process.pid);
process.env.PORT = "3809";
process.env.TREEOS_STORE_BASE = SCRATCH;
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "story-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "story-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "story-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { assembleStory } = await import(`${R}/seed/present/book/assemble.js`);

const poll = async (fn, t = 60000, e = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, e));
  }
  return null;
};
const head = (label, lines, n = 6) => {
  console.log(`\n  ── ${label} ── (${lines.length} acts)`);
  for (const a of lines.slice(0, n)) console.log(`     ${a.line}`);
  if (lines.length > n) console.log(`     … ${lines.length - n} more`);
};

console.log(`\n  THE STORY PANEL — world / being / place / lineage\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1500));

  // WORLD — the whole branch
  const world = await assembleStory("world", { branch: "0" });
  head("WORLD (the whole branch's story)", world);
  if (!world.length) {
    console.log(
      "\n  (no facts on the branch — fact-stamping is down mid-rename; re-run after it settles)",
    );
    process.exit(0);
  }

  // BEING — I's own thread
  const being = await assembleStory("being", { branch: "0", being: String(I) });
  head("BEING (I's own thread, first person)", being);

  // MOMENT (WHEN) — one moment's cross-section (pick an act with an actId from the world story)
  const withAct = world.find((a) => a.actId);
  if (withAct) {
    const moment = await assembleStory("moment", {
      branch: "0",
      moment: withAct.actId,
    });
    head(
      `MOMENT (the act ${String(withAct.actId).slice(0, 8)} — only its landings, the when)`,
      moment,
    );
  } else {
    console.log("\n  ── MOMENT ── (no act carried an actId to scope a moment)");
  }

  // PLACE (WHERE) — a space's whole history (pick a space that some fact targeted)
  const withSpace = world.find((a) => a.of?.kind === "space" && a.of?.id);
  if (withSpace) {
    const place = await assembleStory("place", {
      branch: "0",
      space: withSpace.of.id,
    });
    head(
      `PLACE (the space ${String(withSpace.of.id).slice(0, 8)} — its whole history, the where)`,
      place,
    );
  } else {
    console.log("\n  ── PLACE ── (no fact targeted a space to scope a where)");
  }

  // LINEAGE — I and its children, one generation
  const lineage = await assembleStory("lineage", {
    branch: "0",
    being: String(I),
    depth: 1,
  });
  head("LINEAGE (I + its children, depth 1 — the family story)", lineage);

  console.log(
    `\n  five views, one coordinate system: who × when × where — read, watch, act.`,
  );
  process.exit(0);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
