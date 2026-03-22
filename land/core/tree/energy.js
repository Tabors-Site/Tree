// Energy extension bridge.
// If the energy extension is installed, re-exports from it.
// If not, provides no-op stubs so core code doesn't crash.

let mod;
try {
  mod = await import("../../extensions/energy/core.js");
} catch {
  // Energy extension not installed. Provide no-op stubs.
  mod = {
    DAILY_LIMITS: { basic: Infinity, standard: Infinity, premium: Infinity, god: Infinity },
    calculateFileEnergy: () => 0,
    registerAction: () => {},
    calculateEnergyCost: () => 0,
    maybeResetEnergy: () => false,
    EnergyError: class extends Error { constructor(m) { super(m); this.name = "EnergyError"; } },
    useEnergy: async () => ({ energyUsed: 0, remaining: Infinity }),
  };
}

export const {
  DAILY_LIMITS,
  calculateFileEnergy,
  registerAction,
  calculateEnergyCost,
  maybeResetEnergy,
  EnergyError,
  useEnergy,
} = mod;
