factory/                the mechanism
  intake/               summons arrive, queue, get picked
  stamper/              runs one stamping:
    assign/               who acts — being, role, voice
    fold/                 fold the reel into the present     (read)
    momentum/             the being's motion, the forward pass  (act)
    stamped/              lay the new facts on the reel       (write)

The four beats inside stamper are CQRS exactly: read state from the log, act, append to the log. Assign + fold are the read side (who is acting, what state are they reading); momentum + stamped are the write side (act, append). Reading top to bottom in stamper/ is reading one moment of a being's life in four words.

face/ is gone. The face isn't built — it's where assign and fold hand to momentum together. Two stages meet there; no fabrication folder.

intake/ stays outside stamper/. Intake isn't part of a stamping — it's the feed. Summons arrive, queue, get picked; then a stamping runs.

The Fact record itself isn't a factory folder. The reels and the chain are substrate, in the place layer. The factory reads through fold/ and writes through stamped/, but it doesn't hold the record. The factory is the assembly line; the record is the warehouse.

All three voices flow through the four beats equally — humans, LLM beings, scripted beings. The only difference lands at momentum: a human's act was already decided in another realm, a scripted being's act is its code, an LLM-being's act is the inference. assign decides which voice owns the being and hands the voice back at momentum so the right function call fires. Everything between is identical, and the stamped Fact is the same shape.
