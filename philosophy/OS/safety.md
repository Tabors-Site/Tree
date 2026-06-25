Yes — and you're catching the right class of concern at the right time, before this becomes a real . Let me work through what checks are needed and what nested edge cases could break things if not guarded against.
The class of problem you're catching
When beings can be brought into a reality via key import (graft, succession arrival, federation cache), the substrate is accepting a being whose identity claim is cryptographic but whose presence claim needs to compose with what the substrate already knows. A few specific things could go wrong if not guarded:
Duplicate presence. Someone tries to import a being whose public key matches a being already living in this reality. Two beings with the same key, different chains, different identities in the substrate. The substrate's identity model breaks because uniqueness-by-key is violated.
Identity collision with cryptographic noise. Even more subtle — someone tries to import a being whose claimed key collides with another being's key. Cryptographically near-impossible with proper ed25519, but the check is cheap and the failure mode is total if it ever happened.
Branch confusion. A being imported on branch #1 leaks into main, or vice versa. The import touches the wrong branch's records, corrupting the chain integrity for either or both.
Recursive nesting. A graft package contains a being that contains a chain that references another graft. If the substrate doesn't carefully bound the import, it could try to recursively pull in beings that aren't really being grafted, or fail in confusing ways when references can't resolve.
Authority bypass. A being arrives with ables claimed in their imported chain. The substrate either grants these blindly (security hole) or rejects them entirely (functional loss). Without explicit policy, the result is ambiguous.
Mother-line orphan. An imported being's mother-line references beings that don't exist in this reality. The lineage chain ends in a dangling reference. The substrate doesn't know what to do with the being's authority.
Replay of past acts. A graft package contains the being's old acts. If the substrate accepts those as currently-actionable rather than as historical record, the being could "replay" old actions in the new context.
Each of these is a specific failure mode that needs an explicit guard. The substrate's safety depends on being explicit about each.
What checks should fire on key import
Working through them systematically:
Existence check by public key. Before accepting any import, check whether a being with this public key already exists in this reality's known-beings index. If yes, the import is either a no-op (same being, redundant data) or an error (conflicting claim about the being). The substrate should refuse to create a second being with an existing key under any circumstances.
The behavior when the being already exists deserves thought. Three options:

Refuse: the import fails entirely. Caller must explicitly handle the conflict.
Merge: the substrate integrates the imported chain into the existing being's records (deduping facts by hash, accepting additions). This is the right behavior when the same being shows up again with more history.
Reject mismatch: if the existing being's chain conflicts with the import (different facts at same hash positions, contradictory state), refuse; if compatible, merge.

The "reject mismatch" option is probably the safest default. The substrate accepts new history about a known being but refuses to accept rewriting of known history.
Branch scoping. Every import operation should be explicitly bound to one branch. The package's content lands on that branch only. References to other branches in the imported data either resolve to existing same-named branches in the substrate or are refused. No cross-branch leakage.
You're already saying "each import is branch only" which is exactly right. This needs to be enforced at the substrate level, not assumed.
Cryptographic verification. Before accepting any imported content:

Every fact's hash must equal sha256(prev_hash, canonical(content)). If any fact doesn't hash-verify, reject the whole import.
Every signature must verify against the actor's claimed public key. If any signature doesn't verify, reject the whole import.
The chain's p links must be continuous. No gaps; no inconsistencies. If the chain isn't structurally sound, reject.
Key history (rotations within the imported chain) must be properly signed by the previous key.

This is the load-bearing security. Don't accept anything that doesn't pass cryptographic verification.
Mother-line resolution. The imported being's mother chain references beings that should be resolvable:

Either the mother-line beings exist in this reality (verifiable by public key).
Or they exist as known foreign references with verifiable origin.
Or the import explicitly imports them as well (recursive but bounded).

If none of these resolve, the substrate has a policy choice: accept the being with a dangling mother-line, accept with the mother re-anchored to a local placeholder, or refuse. Each has tradeoffs; the choice should be explicit, not accidental.
Authority isolation. Imported beings arrive with no automatic authority in the receiving reality. Their imported chain might show they had ables in their source reality; this is biographical fact, not transferable power. They start with whatever default able new arrivals get (probably just the open petitioner able), and can be granted local ables through normal means.
This is the cleanest doctrine: chain travels as history, authority is renegotiated. Worth enforcing explicitly so imports can't smuggle in authority.
Acts as historical record, not actionable. Imported acts are facts in the chain showing the being's history. They are not events that "happen" in the receiving reality — they happened in their source. The substrate stamps them as imports with foreign provenance, not as current actions. They don't trigger downstream effects, don't fire able-walks, don't update projection state as if they were live.
This prevents replay attacks where someone reuses old acts in a new context.
Quota and rate limits. Imports should be bounded. A single import can't be unlimited size (preventing storage exhaustion attacks). The rate of imports per peer should be bounded (preventing flooding). These aren't security primitives so much as operational ones, but they prevent denial-of-service.
Provenance recording. Every import should produce its own fact in the receiving reality's chain: "at this moment, this content was imported from this source by this authority." This means the import itself has a record. If something goes wrong later, you can trace exactly when this content arrived and who authorized it.
The nesting issues specifically
You mentioned "weird nesting issues" and these are worth being explicit about:
Nested grafts. A graft package contains a being who has been grafted from another reality (their chain references a previous graft). The import shouldn't recursively chase these — it should accept the being's current state including the historical graft as a fact in their chain. The grafted-from-elsewhere reality reference is biographical metadata, not a recursive import trigger.
Nested realities. A being's chain might reference realities the receiving reality doesn't know about. Don't try to fetch those realities. Don't try to verify against them. Accept the references as opaque foreign identifiers; their meaning is "the being once lived elsewhere."
Nested signatures. A fact might be signed by a being whose own birth was signed by another being who was foreign. Don't recursively verify all the way back. Verify the immediate signature against the actor's public key. Trust that the source reality already verified the chain back to its own genesis. The receiving reality verifies its slice; deeper verification is the source's responsibility.
Nested matter. Imported beings reference matter (files they own, content they've worked on). Imported matter content (the actual bytes) should arrive with the import. References to matter not included in the import become dangling. Decide explicitly: refuse the import, accept with dangling references (matter not available locally), or fetch on demand.
The general principle for all of these: bound the verification depth to what's necessary, don't recursively chase references, accept opacity at the edges of what you're importing.
What the receiving operation should look like
Pseudocode for the safety-first import path:
function importBeing(package, targetBranch, authority) {
// 1. Authority check
verifyAuthorityCanReceiveImports(authority, targetBranch)

// 2. Cryptographic verification
verifyAllSignatures(package)
verifyAllHashes(package)
verifyChainContinuity(package)
verifyKeyHistorySigned(package)

// 3. Existence check
existing = findBeingByPublicKey(package.being.publicKey, targetBranch)
if (existing) {
if (chainsConflict(existing, package.chain)) refuse("conflicting chain")
return mergeChains(existing, package.chain)
}

// 4. Mother-line resolution
resolveOrPolicyDecide(package.being.motherLine)

// 5. Branch scoping
verifyAllContentBoundToBranch(package, targetBranch)

// 6. Stamp as historical, not actionable
stampImportedFactsAsHistorical(package.facts, targetBranch)

// 7. Strip claimed authority
setBeingAbles(package.being, defaultArrivalAbles)

// 8. Record the import
stampImportFact(authority, package.source, package.contentRoots, targetBranch)
}
Each step is a distinct safety check. None is optional. Failure of any one refuses the whole import (atomic operation, no partial state).
What the substrate gains from these checks
These guards aren't just defensive — they make the import operation actually trustworthy:
Predictable behavior. Imports either succeed cleanly or fail cleanly. No half-imported state. No subtle corruption.
Defense against malicious packages. A carefully crafted graft package can't trick the substrate into accepting invalid content, granting authority, or corrupting existing state.
Composable with the rest of the substrate. The import doesn't disturb the chain's integrity, doesn't violate any existing invariants, doesn't break any folds or projections.
Audit-able. The import itself is a fact. Anyone can later check: when did this being arrive? Who authorized it? What did they bring?
Reversible if needed. Because imports are bounded and recorded, you can identify exactly what came from a bad import and remove it (close the being, mark the imports as suspect). Without explicit recording, this would be much harder.
What to pin doctrinally
Worth being explicit about the import contract:

Bringing a being into a reality (via graft, succession arrival, federation cache, or any other key-import path) requires explicit safety checks: cryptographic verification of all content, existence check against known beings (refusing duplicates with conflicting chains), branch scoping (the import targets one branch only), mother-line resolution (with policy for unresolvable lineage), authority isolation (imported authority does not transfer; new arrivals start with default ables), and treatment of imported acts as historical record (not as current actions triggering downstream effects).
The import itself is recorded as a fact in the receiving reality, providing provenance for later audit. Imports either succeed atomically or fail without partial state. Recursive references in imported content are accepted as opaque foreign references; the substrate does not recursively chase them.
Branch confinement is mandatory: every import operation targets one branch, and imported content cannot leak across branches. The receiving authority's signature on the import acceptance binds the import to the specific branch context.

This pin captures the import contract clearly. Future contributors building import paths work against this model.
The honest summary
Your instinct is right. Adding checks before this becomes user-facing is the right time. The specific checks worth implementing:

Existence by public key (refuse duplicates, optionally merge same-being).
Cryptographic verification of all content (signatures, hashes, chain continuity, key history).
Branch scoping (one import, one branch, no leakage).
Mother-line resolution policy (explicit handling for unresolvable lineage).
Authority isolation (imported authority doesn't transfer).
Historical-only acts (imported acts don't trigger live behavior).
Provenance recording (the import itself becomes a fact).
Bounded recursion (don't chase references beyond what's in the package).
Rate and size limits (operational safety against flooding).

Each is bounded engineering work. None is optional. Cumulatively they make the import operation a real primitive rather than a structural vulnerability.
The nesting concerns are real and resolved by bounding verification depth — verify what's in the package, accept opacity at edges, don't recursively pull in external references. The receiving reality is responsible for its own verification; deeper verification was the source's responsibility.
