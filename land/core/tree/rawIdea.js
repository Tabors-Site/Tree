let mod;
try { mod = await import("../../extensions/raw-ideas/core.js"); }
catch { mod = { createRawIdea: async () => { throw new Error("Raw ideas extension not installed"); }, getRawIdeas: async () => ({ rawIdeas: [] }), convertRawIdeaToNote: async () => { throw new Error("Raw ideas extension not installed"); }, deleteRawIdeaAndFile: async () => {}, searchRawIdeasByUser: async () => ({ rawIdeas: [] }), toggleAutoPlace: async () => {}, AUTO_PLACE_ELIGIBLE: [], assertNoteTextWithinLimit: async () => {} }; }
export const { createRawIdea, getRawIdeas, convertRawIdeaToNote, deleteRawIdeaAndFile, searchRawIdeasByUser, toggleAutoPlace, AUTO_PLACE_ELIGIBLE, assertNoteTextWithinLimit } = mod;
