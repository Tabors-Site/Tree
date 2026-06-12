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

## The wallet model

Creating a being is creating a wallet.

- You get a **public key**. That is your permanent global address, your `beingId`. It is what other beings reference for stances, mates, vessels, summons. It works in every reality. Your display NAME can change per branch or per reality (names fold from facts), but this underlying identity never moves.
- You get a **private key**. It signs your acts and proves you are you. The home reality holds it encrypted and signs on your behalf (custodial). You can also EXPORT it: an encrypted private key plus an optional BIP39 seed phrase you can write on paper. The exported key is only useful when imported into another reality you control. It is your recovery and your exit.

Encoding: a `beingId` is `did:tree:z<base58btc(raw 32-byte ed25519 public key)>`. The `did:tree:` prefix self documents the scheme, the `z` is multibase base58btc (path and URL safe, so the id flows through IBP addresses and WebSocket routes), and it leaves room for a multicodec prefix. Realities use the same encoding for their `realityId`.

## What gets signed, and when

Acts are signed at the one seal chokepoint ([sealAct in 4-stamped.js](../../seed/present/beats/4-stamped.js)). The signature commits to both the act and exactly its facts, so neither can be swapped:

```
signingPayload = {
  beingId,
  realityId,
  branch,
  actId,                 // = act._id, already the hash of the full opening
  factIds: sortedFactIds,
  timestamp: act.stampedAt
}
sig = sign(privateKey, hash(canonical(signingPayload)))
```

The `sig` rides on the Act row as a closure field, so it does not change `act._id` and replay still dedups.

### Secondary unlock (the felt control)

The reality holds your key, but it will only sign for you while your session is UNLOCKED with your own secret: a password or PIN that you hold and the reality never stores in plaintext. No active unlocked session, no signing on your behalf. This does not eliminate the custodial risk (a compromised or malicious reality can bypass its own check), but it raises the bar a lot and gives you the real sense that you control your being. It is the practical middle ground given that we are not putting private keys in the browser yet. The unlock secret is independent of the encrypted key the reality holds: it gates WHEN the reality is willing to use the key.

## Cross reality

When you act in a foreign reality, you present your `beingId` (your public key) and a signature. The foreign reality verifies the signature against the id directly. Self certifying. No directory lookup, because the id IS the key.

Two layers of proof stack cleanly:

- The canopy DOMAIN key proves "this reality sent this envelope."
- Your BEING key proves "this specific being authored this act."

Both are checkable, so a foreign reality cannot forge acts attributed to its own users without their key.

## Rotation

Your `beingId` (the original identity public key) is permanent. Operational signing keys rotate underneath it via a `be:rotate-key` fact on your own reel. The identity key signs a delegation for the new operational key, so a verifier who trusts your `beingId` can validate the chain to your current key without a directory. Each act records which key signed it (`sig.pubkeyId`), so a verifier confirms that key was valid at the act's time. The home reality assists rotation; full decentralized revocation is deferred.

## The genesis root: I_AM is the reality

The reality is a wallet too, and its key is not a separate thing floating free of the beings. It IS I_AM's key. I_AM is the reality's primary agent, the first thing at t=0, the reality named from above. So there is exactly ONE keypair at genesis:

- The reality's keypair IS I_AM's keypair (the one already held on disk by realityIdentity.js).
- realityId = I_AM's public key, encoded the same `z...` way as any being id. `realityId === encodeKeyId(I_AM_pubkey)`.
- I_AM signs the genesis fact and every Merkle reality-root with that one private key.

On first boot one keypair is generated, the genesis fact commits its public key, and I_AM signs the genesis. A foreign reality, given only that public key, walks: reality pubkey, signed reality root, genesis committing and signed by the same key. It concludes "this is the world that key founded," self certifying all the way down. The random `realityId` uuid retires; the public key is the identity, the signed Merkle root is the provenance, and the old one time onboarding token is at most a local operator convenience.

The human operator (the founder) is NOT the cryptographic root and is NOT required at first boot. When a human is created they get their own independent keypair like any being, and they can be granted high privilege through facts and roles, but the reality's identity never depends on them. This is the disconnect avoided: there is no random reality key, only I_AM's, so "every agent is named by its key" holds with no hole.

## I_AM, the reality from above

I_AM is the one being that breaks the surface pattern, on purpose. Its internal `_id` stays the literal string `i-am`, because that is how the world names itself from inside (and the whole seed already references it that way). But its KEY identity, the `z...` public key it presents to peers, is the reality's public key. Two views of one key: `i-am` from inside, the `z...` id (= realityId) from above. Every OTHER being, the founder, the seed delegates, every human, every vessel-child, gets its own independent keypair at birth, and that key signs its acts. I_AM is the exception that proves the rule: agents are named by their key, and I_AM simply shares its key with the world it is.

## What the frontend builds

- **Create a being is create a wallet.** Show the new public key as the permanent address. Offer "back up your key": the encrypted key plus the BIP39 seed phrase to write down, with the plain warning that the home reality holds a copy and the paper backup is for recovery and for taking the identity to another reality you control.
- **Unlock UX.** A being acts only while unlocked. The frontend asks for the user's secret to start a signing session, shows a locked or unlocked indicator, and re-locks on timeout or sign out.
- **Address display.** Show the `beingId` (the `z...` pubkey, renderable as `did:key:z...`) as the canonical identity, and the per branch or per reality NAME as the friendly label. They are different: the key is permanent, the name is contextual.
- **Verification surfacing.** When viewing a foreign being or a cross reality act, show whether the being signature verified. Self certifying, so this is a local check.
- **Recovery and import.** A path to import an exported key into a reality the user controls, proving ownership of an existing being.

## Accepted boundaries (state these plainly)

Cryptographic identity makes a lot provable, and a few things it cannot, by the custody choice we made. Name them so they are known, not surprises.

What it CLOSES:
- Identity within a verification: a signature checks against the id itself. Self certifying, no trusted directory.
- Content integrity: facts, acts, and matter are named by their content hash; the Merkle roots prove whole world replay; the reality root is bound to the reality key.
- Reality provenance: a foreign reality verifies a world back to its founder, self certifyingly.
- Portability and recovery: you can export your key and prove ownership anywhere, even if your home reality is offline.

What it does NOT close:
- **Custodial signing (the one true red flag).** The home reality holds every hosted being's private key, so it CAN technically forge any act by any of its non founder beings. The signature proves "this reality vouches for this being's act," not "this being personally pressed the button." Only non custodial edge signing (the key lives only in your client and signs before the act reaches the reality) closes this fully, and that is out of scope for now. The secondary unlock and the full Merkle audit trail are the primary mitigations: they raise the bar and make tampering attributable. This is acceptable because most users will either run their own reality or only join realities they trust.
- No client side (edge) signing for now.
- Role and rule content addressing is deferred (authority retroactivity: a content addressed role is immutable per hash, which fights in place role editing).
- Full decentralized key rotation and revocation is deferred.

Net: identity, content, and reality provenance become mathematically provable, and every id unifies around hash or key. It does not make a malicious HOST honest about the beings it custodially signs for. That is the inherent ceiling of custodial signing, mitigated by secondary unlock plus auditability, and the only open item left in this category.
