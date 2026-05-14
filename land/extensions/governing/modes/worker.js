// tree:governing-worker
//
// The legacy generic Worker mode. Workers are now typed (Build,
// Refine, Review, Integrate) and the Planner picks the type per
// leaf step. This mode delegates to the Build worker — that's the
// default cognitive shape and the one most leaf steps had under
// the old generic-Worker substrate.
//
// Callers that explicitly want a typed Worker should use one of
// `tree:governing-worker-{build,refine,review,integrate}`. This
// alias exists so older plans without a `workerType` field still
// resolve to a usable Worker mode, and so any existing references
// to `tree:governing-worker` keep working.

import buildWorker from "./workerBuild.js";

export default {
  ...buildWorker,
  name: "tree:governing-worker",
  // Keep the original emoji and label so dashboards and ledgers
  // that key off these surface the generic Worker identity rather
  // than the typed one. The body is Build's body (the default
  // cognitive shape).
  emoji: "🔨",
  label: "Worker",
};
