// Understanding extension bridge.
let mod;
try {
  mod = await import("../../extensions/understanding/core.js");
} catch {
  mod = {
    createUnderstandingRun: async () => { throw new Error("Understanding extension not installed"); },
    findOrCreateUnderstandingRun: async () => { throw new Error("Understanding extension not installed"); },
    getNextCompressionPayloadForLLM: async () => null,
    commitCompressionResult: async () => {},
    prepareIncrementalRun: async () => {},
    listUnderstandingRuns: async () => [],
  };
}
export const {
  createUnderstandingRun,
  findOrCreateUnderstandingRun,
  getNextCompressionPayloadForLLM,
  commitCompressionResult,
  prepareIncrementalRun,
  listUnderstandingRuns,
} = mod;
