import router from "./routes.js";
import { resolveHtmlAuth } from "./routes.js";
import tools from "./tools.js";
import {
  startRawIdeaAutoPlaceJob,
  stopRawIdeaAutoPlaceJob,
} from "./autoPlaceJob.js";
import { setEnergyService } from "./core.js";

import chooseRoot from "./modes/chooseRoot.js";
import rawIdeaPlacement from "./modes/raw-idea-placement.js";

export async function init(core) {
  resolveHtmlAuth();
  const { setServices } = await import("./core.js");
  setServices({ models: core.models, contributions: core.contributions });
  if (core.energy) setEnergyService(core.energy);
  core.modes.registerMode("home:raw-idea-choose-root", chooseRoot, "raw-ideas");
  core.modes.registerMode("home:raw-idea-placement", rawIdeaPlacement, "raw-ideas");
  core.llm.registerUserLlmSlot?.("rawIdea");

  // Register quick link on user profile
  try {
    const { getExtension } = await import("../loader.js");
    const treeos = getExtension("treeos-base");
    treeos?.exports?.registerSlot?.("user-quick-links", "raw-ideas", ({ userId, queryString }) =>
      `<li><a href="/api/v1/user/${userId}/raw-ideas${queryString}">Raw Ideas</a></li>`,
      { priority: 15 }
    );
    treeos?.exports?.registerSlot?.("user-profile-sections", "raw-ideas", ({ userId, queryString }) =>
      `<div class="glass-card raw-ideas-section">
        <h2>Capture a Raw Idea</h2>
        <form method="POST" action="/api/v1/user/${userId}/raw-ideas${queryString}"
              enctype="multipart/form-data" class="raw-idea-form" id="rawIdeaForm">
          <textarea name="content" placeholder="What's on your mind?" id="rawIdeaInput"
                    rows="1" maxlength="5000" autofocus></textarea>
          <div class="char-counter" id="charCounter">
            <span id="charCount">0</span> / 5000
            <span class="energy-display" id="energyDisplay"></span>
          </div>
          <div class="form-actions">
            <div class="file-input-wrapper">
              <input type="file" name="file" id="fileInput" />
              <div class="file-selected-badge" id="fileSelectedBadge">
                <span>\uD83D\uDCCE</span>
                <span class="file-name" id="fileName"></span>
                <button type="button" class="clear-file" id="clearFileBtn" title="Remove file">\u2715</button>
              </div>
            </div>
            <button type="submit" class="send-button" title="Save raw idea" id="rawIdeaSendBtn">
              <span class="send-label">Send</span>
              <span class="send-progress"></span>
            </button>
          </div>
        </form>
      </div>`,
      { priority: 10 }
    );
  } catch {}

  return {
    router,
    tools,
    jobs: [
      {
        name: "raw-idea-auto-place",
        start: () => startRawIdeaAutoPlaceJob({ intervalMs: 15 * 60 * 1000 }),
        stop: () => stopRawIdeaAutoPlaceJob(),
      },
    ],
  };
}
