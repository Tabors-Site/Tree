// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Seed Migration 0.1.0 - Baseline
 *
 * First versioned seed. Sets up config defaults that may not exist
 * on lands created before the versioning system.
 */

import log from "../log.js";
import { getLandConfigValue, setLandConfigValue } from "../landConfig.js";

const DEFAULTS = {
  cascadeEnabled: false,
  maxDocumentSizeBytes: 14680064,
  flowMaxResultsPerDay: 10000,
  ancestorCacheTTL: 30000,
};

export default async function migrate() {
  let set = 0;
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const existing = getLandConfigValue(key);
    if (existing === null || existing === undefined) {
      await setLandConfigValue(key, value);
      set++;
      log.verbose("Seed", `0.1.0: set ${key} = ${JSON.stringify(value)}`);
    }
  }
  if (set > 0) log.verbose("Seed", `0.1.0: ${set} config default(s) applied`);
}
