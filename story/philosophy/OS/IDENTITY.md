# IDENTITY — Beings and Realities as Wallets

> _"Immutable things are named by their content. Living agents are named by their key."_

This file pins how TreeOS names everything, and how a being proves it is itself, in one reality or across many. It is the contract the portal and any frontend builds against. Read alongside [chainRoots.js](../../seed/past/fact/chainRoots.js) (the Merkle roots) and [realityIdentity.js](../../seed/realityIdentity.js) (the reality keypair).

## The one principle

TreeOS already content-addresses its record: a fact's `_id` IS `SHA-256(p | canonical(content))`, acts the same, and reel, branch, and reality Merkle roots roll up from those hashes. Identity-by-equality is free: the same content anywhere produces the same id.

The agents and objects were the holdout. They were random uuids: `beingId`, `matterId`, `realityId`. A uuid is unique enough but it is not verifiable and not portable. A foreign reality has no way to prove "this is the same being" or that the holder controls the id.

So we split naming into two clean categories:

- **Immutable content is named by the hash of its content.** Facts, acts, matter (the row id, not just the bytes), and eventually rules.
- **Living agents are named by their public key.** Beings AND realities. The public key IS the global address, like a Nostr `npub` or a wallet address. The private key signs. Because the id IS the verification key, every signature is SELF CERTIFYING: a verifier checks "did this agent sign this" against the id directly, with no directory, no PKI, no DNS lookup.

A public key is just the content address of a secret, so this is one idea, not two: everything is named by a cryptographic value of what it is.

## What gets which id (the derivation rule)

The rule underneath both categories is: **an id is derived from the thing's nature.** There are three natures, so three derivations:

- **Content** has bytes and context. Address it by the **hash** of those: facts, acts, matter (the row id is `SHA-256` of its birth spec), and eventually rules. Same content anywhere, same id.
- **Agents** have a keypair. Address them by the **public key**: beings and realities. The id IS the verification key.
- **Position** has neither bytes nor a key. A **space** is a slot in the tree, and its nature is to be a _stable handle that survives renames and structural moves_. The honest representation of that nature is an **opaque, locally unique id** — a uuid. A space's real identity is its position (the parent chain); the row id is just the stable name of the slot. Hashing `{parent, name}` would only hash its position-label, buys no dedup (siblings are already name unique), and would wrongly make two different realities' identically-named heaven slots share an id — they are different slots and must be different ids.

So the uuid on a space is not a holdout from the old world; it is the correct id for a position. This is the **one** place in the substrate where an opaque random id is honest, precisely because opacity-with-stability IS what a space is. Everywhere else, the id derives from content or from a key. If you ever see a random uuid standing in for a fact, act, matter, being, or reality, that is the bug; a random uuid naming a space is the rule.

## The wallet model

Creating a being is creating a wallet.

- You get a **public key**. That is your permanent global address, your `beingId`. It is what other beings reference for stances, mates, beings, summons. It works in every reality. Your display NAME can change per branch or per reality (names fold from facts), but this underlying identity never moves.
- You get a **private key**. It signs your acts and proves you are you. The home reality holds it encrypted and signs on your behalf (custodial). You can also EXPORT it (the auth gated `key-export` op, owner only, direct response channel): the key PEM plus the same key as a 24 word BIP39 phrase you can write on paper. And you can IMPORT it: `be:birth` accepts the exported key (PEM or the 24 words) and births you on that reality WITH this identity — same key, same id. The wire layer holds the imported key OUT of the chain (the secret stash; a credential in a fact would be a plaintext secret in the fixed past). It is your recovery and your exit.

Encoding: a `beingId` is the bare `z<base58btc(0xed01 || raw 32-byte ed25519 public key)>` — the did:key VALUE, deliberately colon free. Ids flow through colon delimited keys everywhere (projection slots `<branch>:<type>:<id>`, reel keys, act-head keys), so a `did:tree:` or `did:key:` prefix would corrupt key parsing; the prefix is display only (`did:key:z...` renders fine in any UI). The `z` is multibase base58btc (path and URL safe, so the id flows through IBP addresses and WebSocket routes) and the `0xed01` multicodec makes the id self describing and algorithm agile. Realities use the same encoding for their `realityId`.

## What gets signed, and when

Acts are signed at the one seal chokepoint ([sealAct in 4-stamped.js](../../seed/present/stamper/4-stamped.js)). The signature commits to both the act and exactly its facts, so neither can be swapped:

```
signingPayload = {
  actId,                 // = act._id, already the hash of the full opening
  beingIn, beingOut,     // the moment's actor tuple
  reality, branch,
  p,                     // chain position (prev-hash link)
  factIds: sortedFactIds,
  time,                  // the seal time (endMessage.time, ISO)
}
sig = sign(privateKey, canonical(signingPayload))
```

The `sig` rides on the Act row as a closure field `{ alg, by, value }` — `by` is the signer's key id (or the literal `i-am`, which verifies against the reality key) — so it does not change `act._id` and replay still dedups. The wire (`serializeAct`) carries `{ alg, by }`; the `verify-act` SEE op verifies on demand.

### Secondary unlock (the felt control)

The reality holds your key, but it will only sign for you while your session is UNLOCKED with your own secret: a password the reality stores only as a hash. No active unlocked session, no signing on your behalf. This does not eliminate the custodial risk (a compromised or malicious reality can bypass its own check), but it raises the bar a lot and gives you the real sense that you control your being. It is the practical middle ground given that we are not putting private keys in the browser yet. The unlock secret gates WHEN the reality is willing to use the key.

Built (2026-06-12): `signing-unlock` / `signing-lock` DO ops (self only; unlock proves the password), birth and connect open the session (the secret was just proven), it re-locks on idle timeout and on sign out, and the gate applies to HUMANS only — scripted and LLM beings have no hand to type a secret, and gating them would just turn the whole tree unsigned. A locked human still acts; the acts seal UNSIGNED, visibly (the portal badges every act signed/unsigned, and the shell carries the latch). The latch itself is in-memory host state, not facts; the unlock/lock ACTS are on the chain.

## Cross reality

When you act in a foreign reality, you present your `beingId` (your public key) and a signature. The foreign reality verifies the signature against the id directly. Self certifying. No directory lookup, because the id IS the key.

Two layers of proof stack cleanly:

- The canopy DOMAIN key proves "this reality sent this envelope."
- Your BEING key proves "this specific being authored this act."

Both are checkable, so a foreign reality cannot forge acts attributed to its own users without their key.

The being signature travels with the cross reality envelope and commits to exactly the deed: this verb, on this address, with this payload, tied to your home act. The receiving reality verifies it against your `beingId` before it does anything, with no callback to your home reality. A present signature that fails is refused hard; an absent one is accepted under the canopy domain signature (so peers that do not sign yet still work). This is the self certifying floor under everything below.

## Sovereign self hosting dissolves the custodial gap

The one true red flag below is custodial signing: when a reality holds your key, it can technically forge your acts. There is a clean way out that needs no new code, only a topology. Run your OWN reality. Be I_AM of it. Birth your being from yourself. Now the custodian is you, and "the host can forge your acts" becomes "you can forge your own acts," which is not a threat.

This is why client side edge signing was never strictly required to close the gap. Your home reality IS the edge. The machine running your instance is the wallet; a hardware wallet or a backup laptop is just another place that instance can live. Self hosting and edge signing are the same act. You then visit other realities as VENUES: your being acts there, the facts land on their chain with crossOrigin pointing home, but your act, your deed, your biography stays on your chain, signed by your key. They verify you self certifyingly and accept or refuse by policy. They can refuse you. They cannot become you, hold your identity hostage, or deplatform you out of existence, because you still hold your keys, your chain, and every other venue.

Hosted users still accept the custodial boundary below; sovereign self hosters dissolve it entirely. The same protocol serves both, and the cross reality being signature is what makes the sovereign case work without trusting any reality in the middle.

## No rotation, only succession

There is no key rotation, and the reason is exact. A being has ONE keypair; the id IS the public key. You cannot swap the key underneath the id, because the key and the id are the same object. And you cannot revoke a key globally: `be:close` is local to one reality (it stops THAT reality from honoring the being), but the private key still produces valid signatures, and because every reality verifies self certifyingly against the id with no callback, there is no revocation list to push anywhere. You cannot un publish a public key.

So a stolen key cannot be rotated away. What a stolen key forges is a HOLLOW being: a valid signature with none of the history, relationships, or lineage the real being accumulated. Identity here is "key plus chain," and the chain does not travel with the key.

Recovery is SUCCESSION, and it needs no new primitive. You birth a new being (`be:birth` already mints a fresh keypair, so a fresh `beingId`), copy over from the old one whatever you want to carry forward (relationships, matter, a reference to the old chain), and `be:close` the old being on the realities you control. The new being is a clean cryptographic identity; the old one is marked closed wherever you have reach. "Make a new being and copy what you want" is the whole recovery story. The frontend can wrap that sequence in one "succeed this being" gesture, but underneath it is only birth plus ordinary acts.

## The genesis root: I_AM is the reality

The reality is a wallet too, and its key is not a separate thing floating free of the beings. It IS I_AM's key. I_AM is the reality's primary agent, the first thing at t=0, the reality named from above. So there is exactly ONE keypair at genesis:

- The reality's keypair IS I_AM's keypair (the one already held on disk by realityIdentity.js).
- realityId = I_AM's public key, encoded the same `z...` way as any being id. `realityId === encodeKeyId(I_AM_pubkey)`.
- I_AM signs the genesis fact and every Merkle reality-root with that one private key.

On first boot one keypair is generated, the genesis fact commits its public key, and I_AM signs the genesis. A foreign reality, given only that public key, walks: reality pubkey, signed reality root, genesis committing and signed by the same key. It concludes "this is the world that key founded," self certifying all the way down. The random `realityId` uuid retires; the public key is the identity, the signed Merkle root is the provenance, and the old one time onboarding token is at most a local operator convenience.

The human operator (the founder) is NOT the cryptographic root and is NOT required at first boot. When a human is created they get their own independent keypair like any being, and they can be granted high privilege through facts and ables, but the reality's identity never depends on them. This is the disconnect avoided: there is no random reality key, only I_AM's, so "every agent is named by its key" holds with no hole.

## I_AM, the reality from above

I_AM is the one being that breaks the surface pattern, on purpose. Its internal `_id` stays the literal string `i-am`, because that is how the world names itself from inside (and the whole seed already references it that way). But its KEY identity, the `z...` public key it presents to peers, is the reality's public key. Two views of one key: `i-am` from inside, the `z...` id (= realityId) from above. Every OTHER being, the founder, the seed delegates, every human, every being-child, gets its own independent keypair at birth, and that key signs its acts. I_AM is the exception that proves the rule: agents are named by their key, and I_AM simply shares its key with the world it is.

## What the frontend builds (built 2026-06-12, the portal identity panel)

- **Create a being is create a wallet.** The post register overlay shows the new public key as the permanent address and offers the key backup right there: the 24 word phrase to write down plus the PEM download, with the plain warning that the home reality holds a copy and the paper backup is for recovery and for taking the identity to another reality you control.
- **Unlock UX.** The shell carries the latch (the lock dot beside the socket dot); the identity panel carries the controls. Locked acts seal unsigned and the history view badges them so the control is FELT, not decorative.
- **Address display.** The `beingId` (the `z...` pubkey, renderable as `did:key:z...`) is the canonical identity everywhere; the per branch or per reality NAME is the friendly label. They are different: the key is permanent, the name is contextual.
- **Verification surfacing.** Act badges show signed/unsigned from the wire; clicking one asks the reality to verify (the `verify-act` SEE op, self certifying against the signer id). The reality's own signed chain root is verified LOCALLY in the browser (WebCrypto ed25519 against the realityId).
- **Recovery and import.** Register accepts an exported key (PEM or the 24 words) and births you with that identity. There is no succession button: a lost key means registering a fresh being and carrying over what you want through ordinary acts. The key is the id and cannot be revoked, so there is nothing to "recover" in place (see "No rotation, only succession" above).

## Accepted boundaries (state these plainly)

Cryptographic identity makes a lot provable, and a few things it cannot, by the custody choice we made. Name them so they are known, not surprises.

What it CLOSES:

- Identity within a verification: a signature checks against the id itself. Self certifying, no trusted directory.
- Content integrity: facts, acts, and matter are named by their content hash; the Merkle roots prove whole world replay; the reality root is bound to the reality key.
- Reality provenance: a foreign reality verifies a world back to its founder, self certifyingly.
- Portability and recovery: you can export your key and prove ownership anywhere, even if your home reality is offline.

What it does NOT close:

- **Custodial signing (the one true red flag, for HOSTED beings only).** When a reality holds a being's private key, it CAN technically forge any act by that being. The signature proves "this reality vouches for this being's act," not "this being personally pressed the button." This bites ONLY when you let someone else's reality hold your key. Running your own reality dissolves it entirely (see "Sovereign self hosting" above): the custodian becomes you, and no edge signing is needed. For genuinely hosted beings the mitigations are the secondary unlock and the full Merkle audit trail, which raise the bar and make tampering attributable. Acceptable because a user who wants the guarantee can always self host, and most others either do that or only join realities they trust.
- No client side (edge) signing as a separate feature, because self hosting already provides it: your own reality is your edge.
- Able and rule content addressing is deferred (authority retroactivity: a content addressed able is immutable per hash, which fights in place able editing).
- No key rotation by design (see "No rotation, only succession" above): a key cannot be revoked globally, so recovery is succession to a new being, not rotation of an existing one.

Net: identity, content, and reality provenance become mathematically provable, and every id unifies around hash or key. It does not make a malicious HOST honest about the beings it custodially signs for, but a sovereign self hoster has no such host. That is the whole shape of the remaining boundary.
