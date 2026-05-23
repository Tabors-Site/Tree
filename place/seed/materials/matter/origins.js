// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Where matter comes from.
//
// Every Matter row carries an `origin` tag naming the realm its
// underlying content actually lives in. The tag decides how the
// matter is fetched, stored, kept in sync, addressed, and
// transferred. The `content` field's shape varies by origin:
//
//   IBP        I own it. content is a string (text) or null
//              (qualities-only matter). Always in sync.
//   FILESYSTEM Bridges to a file on disk. content is { path, size,
//              mimeType }. Bytes live outside me.
//   WEB        Bridges to a URL. content is { url, fetchedAt?,
//              cache? }. Live content lives at the URL.
//   CROSS_PLACE Bridges to matter on another place. content is
//              { place, matterRef }.
//
// New origins (git, database, stream, service) plug in as new
// bridging patterns. The schema shape doesn't change; only the
// content interpretation does.

export const MATTER_ORIGIN = Object.freeze({
  IBP:        "ibp",
  FILESYSTEM: "filesystem",
  WEB:        "web",
  CROSS_PLACE: "cross-place",
});
