// horizon:delist. The horizon operator's editorial lever.
//
// Marks one (publisher, name, version) delisted in the registrar's
// catalog: this horizon declines to show it. Never a deletion (the
// version and its hash remain, mirrors may still carry it) and never the
// publisher's retire (that chains a pointer claim, via retire-listing).
// Doctrine: a horizon vouches for availability, never authenticity;
// exclusion is its one governance lever.
//
// Target is the registrar being whose qualities hold the catalog. The
// operator authors the delist; the op writes through the same
// set-being-on-the-registrar path the registrar's own handlers use.

export default {
  name: "delist", // becomes horizon:delist after loader namespacing
  targets: ["being"],
  args: {
    publisher: { type: "text", label: "Publisher reality (the listing's owner)", required: true },
    name:      { type: "text", label: "Listing name", required: true },
    version:   { type: "text", label: "Version to delist", required: true },
    reason:    { type: "text", label: "Why this horizon declines to show it (optional)", required: false },
  },
  skipAudit: true,

  async handler({ target, params, identity, summonCtx }) {
    const { loadTargetRow } = await import("../../../seed/materials/_targetShape.js");
    const registrar = await loadTargetRow(target, "being");
    const { delistVersion } = await import("../handlers.js");
    const ctx = {
      ...summonCtx,
      toBeing: { _id: String(registrar._id), name: registrar.name },
      branch: summonCtx?.actorAct?.branch || "0",
    };
    const result = await delistVersion(ctx, {
      publisher: params?.publisher,
      name:      params?.name,
      version:   params?.version,
      reason:    params?.reason || null,
    });
    return { ...result, _skipAudit: true };
  },
};
