// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Seed Migration 0.2.0 — Plan-uniqueness audit.
 *
 * Detects scopes (any node) that have MORE THAN ONE plan-type child.
 * The new unique partial index on (parent, type) where type === "plan"
 * (added in this same change in seed/models/node.js) prevents future
 * duplicates, but pre-existing data from before the index may already
 * violate the invariant. Mongo will silently fail to create the index
 * if duplicates exist; this migration surfaces them so the operator
 * knows what to clean up.
 *
 * Non-destructive: this migration NEVER deletes or moves nodes. It
 * logs every offender with full identification (parent id, child plan
 * ids, step counts) so the operator can decide what to merge / archive
 * by hand. Resolution is application-domain-specific (which plan has
 * the canonical contracts? which has the active steps?) and a generic
 * "pick the latest" rule would mask real splits.
 *
 * After cleanup the operator can re-run boot and the index will create
 * successfully.
 */
import log from "../log.js";
import Node from "../models/node.js";

export default async function migrate() {
  let duplicates;
  try {
    // Aggregate: group every plan-type node by its parent, count.
    duplicates = await Node.aggregate([
      { $match: { type: "plan" } },
      { $group: {
        _id: "$parent",
        planIds: { $push: "$_id" },
        count: { $sum: 1 },
      }},
      { $match: { count: { $gt: 1 } } },
    ]);
  } catch (err) {
    log.error("Seed", `0.2.0: duplicate-plan audit query failed: ${err.message}`);
    return;
  }

  if (!duplicates || duplicates.length === 0) {
    log.verbose("Seed", "0.2.0: plan-uniqueness audit clean (no duplicates).");
    return;
  }

  log.warn(
    "Seed",
    `🪦 0.2.0: ${duplicates.length} scope(s) have multiple plan-type children. ` +
    `The new unique index on (parent, type=plan) will not create until these are resolved. ` +
    `Manually pick a winner per scope and reparent the rest aside (or archive them). Listing each:`,
  );

  for (const dup of duplicates) {
    const parentId = dup._id;
    const planIds = dup.planIds;

    let parentName = "(unknown)";
    try {
      const parentDoc = await Node.findById(parentId).select("name").lean();
      if (parentDoc?.name) parentName = parentDoc.name;
    } catch {}

    const planDetails = [];
    for (const planId of planIds) {
      try {
        const planDoc = await Node.findById(planId)
          .select("_id name dateCreated metadata")
          .lean();
        if (!planDoc) {
          planDetails.push(`  - ${planId} (NOT FOUND)`);
          continue;
        }
        const meta = planDoc.metadata instanceof Map
          ? planDoc.metadata.get("plan")
          : planDoc.metadata?.plan;
        const stepCount = Array.isArray(meta?.steps) ? meta.steps.length : 0;
        const branchCount = Array.isArray(meta?.steps)
          ? meta.steps.filter((s) => s?.kind === "branch").length
          : 0;
        const created = planDoc.dateCreated
          ? new Date(planDoc.dateCreated).toISOString()
          : "(no date)";
        planDetails.push(
          `  - ${planId} name="${planDoc.name}" created=${created} steps=${stepCount} branches=${branchCount}`,
        );
      } catch (err) {
        planDetails.push(`  - ${planId} (read failed: ${err.message})`);
      }
    }

    log.warn(
      "Seed",
      `Scope ${parentId} ("${parentName}") has ${planIds.length} plan-type children:\n` +
      planDetails.join("\n"),
    );
  }

  log.warn(
    "Seed",
    `0.2.0: audit complete. The unique index will not enforce until each duplicated scope is resolved. ` +
    `Until then, ensurePlanAtScope's race-protection will still pick the first matching plan, but reads ` +
    `may be split across the duplicates. Resolve before relying on plan-uniqueness invariants.`,
  );
}
