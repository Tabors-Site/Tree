// jobs/rawIdeaAutoPlace.js
// Periodically picks up the latest pending text raw idea for each premium/god user
// and fires the raw-idea orchestrator as if they had clicked the Auto-place button.

import User from "../db/models/user.js";
import RawIdea from "../db/models/rawIdea.js";
import AIChat from "../db/models/aiChat.js";
import { orchestrateRawIdeaPlacement } from "../ws/orchestrator/rawIdeaOrchestrator.js";
import { isUserOnline } from "../ws/websocket.js";
import { userHasLlm } from "../ws/conversation.js";

// ─────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────

const ELIGIBLE_PLANS = ["standard", "premium", "god"];

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

  console.log(
    `⏰ Auto-placing raw idea ${rawIdea._id} for user ${user.username} (${user.profileType})`,
  );

  // Fire-and-forget — same pattern as the HTTP route
  orchestrateRawIdeaPlacement({
    rawIdeaId: rawIdea._id.toString(),
    userId,
    username: user.username,
    source: "background",
  }).catch((err) =>
    console.error(
      `❌ Auto-place orchestration failed for user ${userId}:`,
      err.message,
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN RUN
// ─────────────────────────────────────────────────────────────────────────

export async function runRawIdeaAutoPlace() {
  console.log("⏰ Raw idea auto-place job running…");
  try {
    const users = await User.find({
      profileType: { $in: ELIGIBLE_PLANS },
      rawIdeaAutoPlace: { $ne: false },
    })
      .select("_id username profileType")
      .lean();

    if (users.length === 0) {
      console.log("⏰ No eligible users — skipping.");
      return;
    }

    console.log(`⏰ ${users.length} eligible user(s) to check.`);

    // Sequential so we don't fire 100 orchestrations simultaneously
    for (const user of users) {
      await processUser(user).catch((err) =>
        console.error(
          `⚠️ processUser error for ${user._id}:`,
          err.message,
        ),
      );
    }
  } catch (err) {
    console.error("❌ Raw idea auto-place job error:", err.message);
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
      console.log(`⏰ Reset ${modifiedCount} stale processing raw idea(s) → pending`);
    }
  } catch (err) {
    console.error("⚠️ Failed to reset stale processing raw ideas:", err.message);
  }

  // Finalize any AI chats left without an endMessage from a previous server run
  try {
    const { modifiedCount } = await AIChat.updateMany(
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
      console.log(`⏰ Finalized ${modifiedCount} stale pending AI chat(s)`);
    }
  } catch (err) {
    console.error("⚠️ Failed to finalize stale AI chats:", err.message);
  }

  console.log(
    `⏰ Raw idea auto-place job started (interval: ${intervalMs / 1000}s)`,
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
    console.log("⏹ Raw idea auto-place job stopped");
  }
}
