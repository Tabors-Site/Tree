// jobs/rawIdeaAutoPlace.js
// Periodically picks up the latest pending text raw idea for each premium/god user
// and fires the raw-idea orchestrator as if they had clicked the Auto-place button.

import log from "../../seed/log.js";
import User from "../../seed/models/user.js";
import RawIdea from "./model.js";
import Chat from "../../seed/models/chat.js";
import { orchestrateRawIdeaPlacement } from "./pipeline.js";
import { isUserOnline } from "../../seed/ws/websocket.js";
import { userHasLlm } from "../../seed/llm/conversation.js";

// ─────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────

const ELIGIBLE_PLANS = ["standard", "premium"];

// ─────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────

let jobTimer = null;

// ─────────────────────────────────────────────────────────────────────────
// SINGLE-USER HANDLER
// ─────────────────────────────────────────────────────────────────────────

async function processUser(user) {
  const userId = user._id.toString();

  // Skip if user is currently online — they can trigger it themselves
  if (isUserOnline(userId)) return;

  // Skip if user has no LLM connection
  if (!await userHasLlm(userId)) return;

  // Mirror the button: skip if another idea is already being orchestrated
  const alreadyProcessing = await RawIdea.findOne({
    userId,
    status: "processing",
  }).lean();
  if (alreadyProcessing) return;

  // Find the latest pending text raw idea (same legacy-compat $or as getRawIdeas)
  const rawIdea = await RawIdea.findOne({
    userId,
    contentType: "text",
    $or: [
      { status: "pending" },
      { status: null },
      { status: { $exists: false } },
    ],
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!rawIdea) return;

 log.verbose("Raw Ideas", 
    `⏰ Auto-placing raw idea ${rawIdea._id} for user ${user.username}`,
  );

  // Fire-and-forget — same pattern as the HTTP route
  orchestrateRawIdeaPlacement({
    rawIdeaId: rawIdea._id.toString(),
    userId,
    username: user.username,
    source: "background",
  }).catch((err) =>
 log.error("Raw Ideas", 
      `❌ Auto-place orchestration failed for user ${userId}:`,
      err.message,
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN RUN
// ─────────────────────────────────────────────────────────────────────────

export async function runRawIdeaAutoPlace() {
 log.verbose("Raw Ideas", "⏰ Raw idea auto-place job running…");
  try {
    const users = await User.find({
      $or: [
        { "metadata.tiers.plan": { $in: ELIGIBLE_PLANS } },
        { isAdmin: true },
      ],
      "metadata.rawIdeas.autoPlace": { $ne: false },
    })
      .select("_id username isAdmin metadata")
      .lean();

    if (users.length === 0) {
 log.verbose("Raw Ideas", "⏰ No eligible users — skipping.");
      return;
    }

 log.verbose("Raw Ideas", `⏰ ${users.length} eligible user(s) to check.`);

    // Sequential so we don't fire 100 orchestrations simultaneously
    for (const user of users) {
      await processUser(user).catch((err) =>
 log.error("Raw Ideas", 
          `⚠️ processUser error for ${user._id}:`,
          err.message,
        ),
      );
    }
  } catch (err) {
 log.error("Raw Ideas", " Raw idea auto-place job error:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Start the recurring job.
 * @param {object} [opts]
 * @param {number} [opts.intervalMs=900000]  15 min by default
 */
export async function startRawIdeaAutoPlaceJob({ intervalMs = 15 * 60 * 1000 } = {}) {
  if (jobTimer) {
    clearInterval(jobTimer);
  }

  // Reset any ideas left in "processing" from a previous server run
  try {
    const { modifiedCount } = await RawIdea.updateMany(
      { status: "processing" },
      { $set: { status: "pending" } },
    );
    if (modifiedCount > 0) {
 log.verbose("Raw Ideas", `⏰ Reset ${modifiedCount} stale processing raw idea(s) → pending`);
    }
  } catch (err) {
 log.error("Raw Ideas", " Failed to reset stale processing raw ideas:", err.message);
  }

  // Finalize any AI chats left without an endMessage from a previous server run
  try {
    const { modifiedCount } = await Chat.updateMany(
      { "endMessage.time": null },
      {
        $set: {
          "endMessage.time": new Date(),
          "endMessage.stopped": true,
          "endMessage.content": "Server restarted before completion",
        },
      },
    );
    if (modifiedCount > 0) {
 log.verbose("Raw Ideas", `⏰ Finalized ${modifiedCount} stale pending AI chat(s)`);
    }
  } catch (err) {
 log.error("Raw Ideas", " Failed to finalize stale AI chats:", err.message);
  }

 log.info("Raw Ideas", `⏰ Raw idea auto-place job started (interval: ${intervalMs / 1000}s)`,
  );

  // Run once immediately, then on every interval
  jobTimer = setInterval(runRawIdeaAutoPlace, intervalMs);

  // Return handle in case caller wants to store it
  return jobTimer;
}

export function stopRawIdeaAutoPlaceJob() {
  if (jobTimer) {
    clearInterval(jobTimer);
    jobTimer = null;
 log.info("Raw Ideas", "⏹ Raw idea auto-place job stopped");
  }
}
