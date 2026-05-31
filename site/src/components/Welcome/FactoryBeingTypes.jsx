import { Link } from "react-router-dom";
import "./IbpPage.css";

/**
 * FactoryBeingTypes. The being-types page in the Factory section.
 *
 * Plain language description of what a being IS in TreeOS, what kinds
 * of cognition the substrate supports today, and (the main section) what
 * an LLM being's one moment actually looks like.
 *
 * Doctrine. Forward fold reads the world, not the act-chain. The
 * default LLM moment's prompt is system + user, period . no
 * past-messages slot. Half / inward orientations exist in the model
 * but are not wired yet.
 *
 * Distinct from MCP. MCP is a wire protocol for tools. An LLM being
 * is a first-class participant in TreeOS: it has an address, a reel
 * of facts, a position in the tree, and lives inside the moment
 * cycle. MCP is one option for how that being's cognition reaches
 * tools. The being is the thing; MCP is just one wire.
 */
const FactoryBeingTypes = () => {
  return (
    <article className="ns-doc">
      <header className="ns-doc-header">
        <p className="ns-doc-eyebrow">Being types</p>
        <h1 className="ns-doc-title">What a being is, and the four kinds we have today</h1>
        <p className="ns-doc-lede">
          A being is whoever stamps a reel of facts. The cognition behind
          the stamping can be a script, an LLM, a human, or a composite.
          The substrate treats all four the same.
        </p>
      </header>

      <section>
        <h2>The being IS the chain of facts</h2>
        <p>
          A being is not a process. It is not a thread, not a chat session,
          not an agent that holds state between turns. A being is a row
          (name, roles, home space, LLM connection if any) plus a reel of
          facts. Everything else about who they are, how they think, and
          what they have done, is folded from the reel each moment.
        </p>
        <p>
          The cognition is what decides what to do next inside a moment.
          The four kinds below differ in their cognition, not in their
          standing in the world. To the inbox, the scheduler, the sealer,
          and any other being looking at them, they all look the same.
        </p>
      </section>

      <section>
        <h2>The four kinds of cognition</h2>

        <ol className="ns-flow">
          <li className="ns-flow-step">
            <span className="ns-flow-num">1</span>
            <div>
              <h3>Scripted</h3>
              <p>
                The cognition is a function. When the being is summoned,
                the function reads the fold and decides what to do in code.
                The harmony drummer is scripted. It walks toward the drum,
                strikes when adjacent, and ticks. No model, no prompt,
                no inference. Deterministic and fast.
              </p>
            </div>
          </li>

          <li className="ns-flow-step">
            <span className="ns-flow-num">2</span>
            <div>
              <h3>LLM</h3>
              <p>
                The cognition is one call to a language model per moment.
                The model decides what to do by emitting a tool call,
                prose, both, or neither. Detailed below.
              </p>
            </div>
          </li>

          <li className="ns-flow-step">
            <span className="ns-flow-num">3</span>
            <div>
              <h3>Human</h3>
              <p>
                The cognition is a person looking at a screen. The summon
                lands in the human's inbox; the human reads it through a
                portal, decides what to do, and acts through the same
                verbs an LLM or a script would use. The substrate does not
                care that the latency is minutes instead of milliseconds.
              </p>
            </div>
          </li>

          <li className="ns-flow-step">
            <span className="ns-flow-num">4</span>
            <div>
              <h3>Composite</h3>
              <p>
                The cognition is a being made of other beings. A ruler
                that delegates to workers, a panel that votes, an
                ensemble. The substrate is the wiring; each member's
                moments are normal moments. Future direction, not built
                out yet.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section>
        <h2>LLM beings, the shape of one moment</h2>
        <p>
          An LLM being is the case worth understanding in detail. The
          cognition is one call to a language model per moment. One call,
          one decision, one act. Multi step work is many moments, not
          one moment with many calls.
        </p>

        <h3>Forward by default</h3>
        <p>
          Every moment has an orientation that names what the fold is
          allowed to read. The default, used everywhere unless a being
          explicitly turns, is <em>forward</em>: the fold reads the
          world (the spaces and matter the being can see) and does
          <strong> not</strong> read the being's own past acts.
        </p>
        <p>
          That means a being woken forward has no memory of what it has
          done before this moment. The dancer that just stepped to (3,4)
          and wakes for the next tick does not remember stepping. It
          looks at the grid as it is now, sees its current position via
          the world's projection, sees its neighbors, and decides where
          to step next. The fact that it moved before is recorded on
          its act-chain, but the act-chain is not in scope for a forward
          moment.
        </p>
        <p>
          This is on purpose. The dance is harmonic because each dancer
          reacts to the present grid, not to its own trajectory. A being
          that secretly carries its prior moves into every moment is a
          quietly ruminating contemplative, and the harmony falls apart.
          Statelessness inside the moment is the design.
        </p>

        <h3>Two things go into the call</h3>
        <p>
          When a forward moment fires, the factory builds the prompt
          from exactly two pieces:
        </p>
        <ul>
          <li>
            <strong>System prompt.</strong> The role's identity for this
            instant. Who the being is, where it is, what it can see
            (the world face: position, neighbors, what is around it),
            what tools it has, the role's persona, and the current
            time. Built fresh every moment from the role spec plus the
            position the being is at.
          </li>
          <li>
            <strong>User message.</strong> The content of the summon
            that woke this being. The wake event verbatim ("the drum
            ticked beat 7"), or the message a person sent, or whatever
            else opened the moment. This is what just landed in front
            of the being.
          </li>
        </ul>
        <p>
          That is the entire prompt. No third "past messages" slot.
          The chat format's three-slot shape (system / past / user) is
          how the provider's API happens to be structured; it is not
          how TreeOS thinks. Mapping the past slot onto "the being's
          prior acts" would be exactly the forward-fold violation
          described above . it would make every moment a half-turn by
          default.
        </p>

        <h3>The tools the model is offered</h3>
        <p>
          Alongside the prompt, the model is given a list of tools it may
          reach for. The list is the intersection of four things:
        </p>
        <ul>
          <li>
            The tools the role declares. A harmony dancer declares only
            "step". A reality manager declares "reality-see" and
            "reality-do". The role names the surface.
          </li>
          <li>
            Tools extensions have injected for this role at install time.
            Extensions can grow the set without changing the role.
          </li>
          <li>
            Any position-level allow / block list. An ancestor space can
            tighten the tools available inside its subtree.
          </li>
          <li>
            The role's permissions. A read-only role never sees a write
            tool, because the verb tag on the tool is filtered against
            the role's permissions before the list is built. The model
            cannot reach for what is not in the list.
          </li>
        </ul>

        <h3>Three things can come out</h3>
        <p>
          The response is parsed into exactly one of three outcomes:
        </p>
        <ul>
          <li>
            <strong>Act.</strong> The model emitted a tool call. The
            factory runs the first one. (If the model emitted more than
            one, the rest are dropped. One moment, one act. The next
            moment will see whatever this act changed and can take the
            next step.) If the model also emitted prose alongside the
            tool, that prose closes the act . the "I just did this"
            sentence. The act seals: a row is written, the fact the
            tool emitted commits with it, and any reply fires.
          </li>
          <li>
            <strong>See.</strong> The model emitted no tool call. The
            being looked and did not act. This is a legitimate outcome,
            not a failure. No row writes, no reply fires, the inbox
            closes cleanly.
            <br /><br />
            Note: prose without a tool call is also see. Speech is an
            act, acts go through tools. A being that should speak
            declares a speech tool (`canDo: ["respond"]` or similar)
            and the tool dispatches the speech-act. A being that has
            no speech tool cannot speak; if the LLM emits prose
            anyway, the LLM did not call a tool, which is see. The
            prose is logged so a misfire is visible but does not
            pollute the act-chain.
          </li>
          <li>
            <strong>Failure.</strong> The call broke (timeout, provider
            error, garbage response). No row, no reply. The inbox may
            evict if the failure is deterministic, or stay open if it
            was transient (an abort, a cancelled call).
          </li>
        </ul>
        <p>
          The rule is uniform: every act in the system goes through a
          declared tool. There is no chat-shape vs structured-shape
          distinction. A being's <code>canDo</code> is the complete
          description of what it can do, including talking if it
          talks. Tools are the language; the LLM picks the next word.
        </p>

        <h3>Multi step work uses many moments, not one</h3>
        <p>
          A role can declare <code>selfContinue: true</code>. When an act
          seals, the sealer enqueues a fresh summon to the same being.
          The next moment folds the world AFTER this act and decides
          again. Each moment is still forward; each moment still has no
          memory of its own prior acts. What the next moment sees is
          the world the prior act CHANGED . the file is now edited, the
          page is now created, the new being is now placed . and it
          decides from there.
        </p>
        <p>
          The loop ends naturally when the model has nothing left to
          do and emits a see. That is the exit: silence.
        </p>
        <p>
          Most beings default to <code>selfContinue: false</code>. They
          do one act per summon and rely on something external to wake
          them again. The harmony dancers are this kind: the drummer
          ticks, every dancer wakes once, decides, acts or sees, and is
          done until the next tick.
        </p>

        <h3>Half and inward, when the being explicitly turns</h3>
        <p>
          A being can request that its next moment NOT be forward.
          It does this by self-summoning with an explicit orientation:
        </p>
        <ul>
          <li>
            <strong>Half.</strong> The fold reads the world AND
            structured recall of the being's own prior acts.
            Recall is causal, not chronological . it surfaces past
            acts stitched to entities currently changing in the
            face, not the last N acts the being sealed. A dancer
            considering its trajectory would half-turn; a chess
            being reviewing why it played a certain opening would
            half-turn.
          </li>
          <li>
            <strong>Inward.</strong> The fold reads only the
            being's own act-chain. The world drops away. Pure
            reflection. A being asking "who have I been" turns
            inward.
          </li>
        </ul>
        <p>
          Neither is wired yet. The forward default is the only
          orientation the factory honors today; a half / inward
          summon is accepted, logged, and downgraded to forward so
          a misrouted turn does not silently inject past before the
          recall primitives are in place. The orientation parameter
          is named and present on every moment so that when the
          turns land they slot in cleanly.
        </p>
      </section>

      <section>
        <h2>An LLM being is not an MCP client</h2>
        <p>
          MCP (the Model Context Protocol) is a wire format for letting
          a model reach out to a server full of tools. It is one shape
          of bridge between a model and a toolbox.
        </p>
        <p>
          An LLM being is not that. An LLM being is a participant in
          the world. It has a name, a home space, a reel of its own
          facts, an inbox where summons arrive, and a position in the
          tree that changes what it sees. Other beings can summon it
          by address. It can summon them back. Its acts join the chain
          of facts that the rest of the world reads from. It is,
          structurally, the same kind of thing as a scripted being or a
          human being. The only difference is how its cognition happens.
        </p>
        <p>
          The tools the LLM reaches for inside its moment come from the
          factory's tool registry, filtered by role and position. They
          dispatch through the same four verbs (SEE / DO / SUMMON / BE)
          every other being uses. The model never sees the verbs
          directly; the tools wrap them. The model only sees a list of
          named things it can call.
        </p>
        <p>
          MCP is one option for how that wrapping could happen at the
          edge. It is not the default and it is not required. The
          factory dispatches tool calls directly through the registered
          handler today; MCP can be added as a transport for
          compatibility with outside model runtimes, but the being
          inside the world is unchanged either way.
        </p>
      </section>

      <section className="ns-doc-aside">
        <h2>Where this lives in the seed</h2>
        <p>
          The one-moment LLM cognition is in{" "}
          <code>seed/present/cognition/llm/llmMoment.js</code>. The role
          registry and dispatcher are in{" "}
          <code>seed/present/roles/</code> and{" "}
          <code>seed/present/cognition/defaultSummon.js</code>. The
          discriminated result type (act / see / failure) is in{" "}
          <code>seed/present/cognition/cognitionResult.js</code>. The
          fold doctrine (forward / half / inward) lives in
          <code> philosophy/MODEL.md</code> and{" "}
          <code>philosophy/INNER-FOLD.md</code>.{" "}
          <Link to="/factory/momentum" className="ns-inline-link">
            Beat 4 (momentum)
          </Link>{" "}
          is the beat where this all happens inside one moment.
        </p>
      </section>
    </article>
  );
};

export default FactoryBeingTypes;
