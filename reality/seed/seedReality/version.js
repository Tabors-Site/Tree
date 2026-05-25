// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// My version. At each boot I compare this against the value stored
// in .config; if they differ, every migration between the stored
// version and this one runs in order before the rest of genesis
// proceeds. Bump this when adding a new migrations/<version>.js.
//
// Reset to 0.1.0 (2026-05-25). No historical migrations carry: every
// rename / schema shift before this point landed against fresh DBs
// and was removed with this version reset. The next bump happens the
// first time a migration is actually needed against deployed data.

export const SEED_VERSION = "0.1.0";
