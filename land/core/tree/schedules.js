// Schedules extension bridge.
let mod;
try {
  mod = await import("../../extensions/schedules/core.js");
} catch {
  mod = {
    updateSchedule: async () => { throw new Error("Schedules extension not installed"); },
    getCalendar: async () => ({ nodes: [] }),
  };
}
export const { updateSchedule, getCalendar } = mod;
