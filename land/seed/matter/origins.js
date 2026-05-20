// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Matter-domain constants.
//
// What system the matter's underlying representation comes from.
// Origin determines how the matter is fetched, stored, kept in sync,
// addressed, and transferred. The content field's shape varies by
// origin:
//
//   IBP        : TreeOS native. content is a string (text) or null
//                (metadata-only object). Always in sync; TreeOS owns it.
//   FILESYSTEM : Bridges to a file on disk. content is { path, size,
//                mimeType }. Bytes live outside TreeOS.
//   WEB        : Bridges to a URL. content is { url, fetchedAt?, cache? }.
//                Live content lives at the URL.
//   CROSS_LAND : Bridges to matter on another TreeOS land.
//                content is { land, matterRef }.
//
// Future kinds (git, database, stream, service) plug in as new bridging
// patterns without altering the schema shape.

export const MATTER_ORIGIN = Object.freeze({
  IBP:        "ibp",
  FILESYSTEM: "filesystem",
  WEB:        "web",
  CROSS_LAND: "cross-land",
});
