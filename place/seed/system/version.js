// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// My version. At each boot I compare this against the value stored
// in .config; if they differ, every migration between the stored
// version and this one runs in order before the rest of genesis
// proceeds. Bump this when adding a new migrations/<version>.js.

export const SEED_VERSION = "0.23.0";
