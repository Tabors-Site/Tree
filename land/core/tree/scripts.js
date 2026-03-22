let mod;
try { mod = await import("../../extensions/scripts/core.js"); }
catch { mod = { updateScript: async () => { throw new Error("Scripts extension not installed"); }, executeScript: async () => { throw new Error("Scripts extension not installed"); }, getScript: async () => null }; }
export const { updateScript, executeScript, getScript } = mod;
