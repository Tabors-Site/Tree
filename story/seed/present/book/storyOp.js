// TreeOS Seed . the STORY see-op.
//
// Facts woven into past-tense Word — the SAME `assembleStory` fold the book renders and the
// RECALL verb reads. This is the convergence (Tabor): the LLM's recall view and the frontend
// story panel are ONE fold, different consumers — one reads the woven Word, one paints it.
//
// The coordinate system is who × when × where:
//   world          → the whole branch, all activity        (the WORLD's story)
//   {scope:being}   → a being's own thread from its start    (the BEING's story)
//   {scope:lineage} → a being + its descendants, depth N     (the FAMILY's story)
//   {scope:moment}  → one act's cross-section                (a WHEN view)
//   {scope:place}   → a space's whole history                (a WHERE view)
//
// SEE never stamps a fact; this is a pure read.

import { registerSeeOperation } from "../../ibp/seeOps.js";
import { assembleStory } from "./assemble.js";

registerSeeOperation("story", {
  ownerExtension: "seed",
  description:
    "A STORY view — facts woven into past-tense Word (the same fold the book + recall read). " +
    "args: {scope:'world'|'being'|'lineage'|'moment'|'place', being?, moment?, space?, depth?, limit?, since?}. " +
    "Defaults `being` to the caller for being/lineage. Returns {scope, acts:[{actId,date,by,subject,mine,line,landings}]}.",
  args: {
    scope:  { type: "text",   label: "Scope (world|being|lineage|moment|place)" },
    being:  { type: "text",   label: "Being id (defaults to you)" },
    moment: { type: "text",   label: "Moment (act) id" },
    space:  { type: "text",   label: "Space id" },
    depth:  { type: "number", label: "Lineage depth (blank = all)" },
    limit:  { type: "number", label: "Max acts (0 = all)" },
  },
  handler: async ({ identity, args, history }) => {
    const a = args || {};
    const scope = a.scope || "world";
    // being/lineage default to the caller — "my story", "my family" with no id passed
    const being = a.being ?? ((scope === "being" || scope === "lineage") ? identity?.beingId : undefined);
    const acts = await assembleStory(scope, {
      branch: history || "0",
      being:  being ? String(being) : null,
      moment: a.moment ? String(a.moment) : null,
      space:  a.space ? String(a.space) : null,
      depth:  a.depth != null && a.depth !== "" ? Number(a.depth) : null,
      limit:  Number(a.limit) || 0,
      since:  a.since || null,
    });
    return { scope, acts };
  },
});
