import "./LandingPage.css";
import "./Governing.css";
import Particles from "./Particles.jsx";

// ForemanPage. /governing/rulership/foreman
//
// The role that watches execution as a call stack. Top frames the Foreman
// as the call stack manager; middle covers what they do; bottom is the
// terminal status taxonomy and decision matrix.

const ForemanPage = () => {
  return (
    <div className="lp lp-gov">

      {/* HERO */}
      <section className="lp-hero">
        <Particles count={25} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🛠️</div>
          <h1 className="lp-title">The Foreman</h1>
          <p className="lp-subtitle">The fore man at the front of the work</p>
          <p className="lp-tagline">
            "Foreman" comes from someone who stands at the front of a crew,
            watching the work as it happens. The TreeOS Foreman does the
            same. They watch execution as a call stack and decide, when
            judgment is required, what comes next. Trees execute like
            functions on a stack. Step N+1 cannot start until step N's
            entire descendant subtree settles. The Foreman is the role that
            holds that frame discipline.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership">↑ Rulership</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/ruler">Ruler</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/planner">Planner</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/contractor">Contractor</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/worker">Worker</a>
          </div>
        </div>
      </section>

      {/* WHAT THEY ARE */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">A judgment required wakeup</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The Foreman doesn't run on every step. Routine forward motion
            stays programmatic. Sequential queue dispatch, step N done
            advances to step N+1, branch step rollup from sub statuses.
            The Foreman wakes when judgment is required. A branch failed.
            A swarm completed. A resume was requested. A user asked the
            Ruler to pause.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            This is deliberate. A Foreman call between every step on a
            deep tree would be untenable. Hundreds of LLM calls per
            session for decisions that don't need an LLM. The Foreman is
            the judgment surface. The structural enforcement (queue
            halts, frame discipline, terminal status writes) is
            programmatic.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            The Foreman is persistent for the duration of an execution
            but transient per wakeup. Each wakeup is a fresh LLM call
            reading a fresh snapshot. No carryover from prior wakeups,
            no accumulated assumptions about the work. The execution
            record persists. The cognition that judges it does not. This
            is the same fresh eyes principle that keeps Planners and
            Contractors honest, applied to the role that reads stack
            state. The position holds across the execution. The occupant
            of any single wakeup is replaceable. The Foreman's continuity
            lives in the execution record's persistent state, not in the
            LLM call.
          </p>
        </div>
      </section>

      {/* RULER RELATIONSHIP */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Under the Ruler's authority</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The Foreman operates under the Ruler's authority. The Ruler
            dispatches execution. The Foreman manages it. The Ruler
            decides what to do. The Foreman decides how the doing flows.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            When the Foreman's judgment exceeds its authority, when a
            failure pattern needs court adjudication, when a cancel
            decision belongs to the Ruler, when the Ruler should pause
            work for reasons the Foreman can't know, the Foreman
            escalates. The Ruler decides. The Foreman manages. Together
            they hold the scope's coherence across the lifecycle.
          </p>
        </div>
      </section>

      {/* PHILOSOPHY */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Philosophy</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Four principles shape every Foreman wakeup.
          </p>
          <div className="lp-cards">
            <div className="lp-card">
              <h3>Trees execute like call stacks</h3>
              <p>
                A parent dispatches a sub Ruler. The sub Ruler runs its
                full lifecycle. Only when the sub Ruler's entire
                descendant subtree settles does the parent move to the
                next step. Cancel a parent and all descendants halt. The
                shape is familiar from any programming language. The
                Foreman holds it across LLM driven execution.
              </p>
            </div>
            <div className="lp-card">
              <h3>Judgment required vs deterministic</h3>
              <p>
                Judgment is reserved for ambiguity. Deterministic
                decisions (sequential queue dispatch, step rollup
                arithmetic, status comparison) stay programmatic.
                Judgment required decisions (recoverability of a failure,
                terminal status when results are mixed, when to escalate)
                wake the Foreman.
              </p>
              <p>
                The architecture is honest about what deserves cognition.
                Routine motion doesn't. Ambiguous moments do. This is
                what keeps Foreman cost bounded at depth while preserving
                judgment where it matters.
              </p>
            </div>
            <div className="lp-card">
              <h3>Cancelled is not failed</h3>
              <p>
                "Cancelled" means decided not to finish. "Failed" means
                tried and couldn't. They have different semantics for
                future judgment. Courts read failure as evidence of
                capability mismatch or contract violation. Cancellation
                reads as a deliberate halt that doesn't reflect on the
                cancelled work's quality.
              </p>
              <p>
                Reputation tanks signatures that fail repeatedly.
                Cancellation is neutral. The Foreman writes the right
                terminal status. Readers downstream never collapse them
                into a generic "didn't complete" bucket.
              </p>
            </div>
            <div className="lp-card">
              <h3>Frame position survives</h3>
              <p>
                Pause and resume must remember where the stack was.
                Cancel a subtree and the cancel marker survives session
                refresh. The Foreman writes persistent markers, not just
                in memory signals. Whatever halts the stack today is
                still halted tomorrow.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* WHEN THEY WAKE */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">When the Foreman wakes</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Four lifecycle events bring the Foreman in. Each comes with
            its own judgment shape.
          </p>
          <div className="lp-cards">
            <div className="lp-card lp-card-sm">
              <h4>Branch failed</h4>
              <p>
                A branch hit a validator violation or exhausted retries.
                The Foreman reads the failure, the contracts in force,
                the branch's history. Decides retry, mark failed, or
                escalate to the Ruler.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Swarm completed</h4>
              <p>
                All branches at a step settled. Foreman reads terminal
                statuses across the swarm and decides the freeze.
                Completed, failed, partial, escalate.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Resume requested</h4>
              <p>
                Execution was paused. User said continue. Foreman reads
                what was paused, calls the resume helper to dispatch
                pending branches, reenters frame at the right position.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Stack op requested</h4>
              <p>
                Ruler routes a pause, cancel subtree, or advance step
                request. Foreman writes the persistent markers, aborts
                in flight controllers. The swarm queue's halt check picks
                up the marker on next dispatch.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* DECISION SURFACE */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">What the Foreman decides</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The Foreman picks one of these. Each has a clear shape and a
            clear tool.
          </p>
          <div className="lp-cards">
            <div className="lp-card lp-card-sm">
              <h4>retry-branch</h4>
              <p>
                The branch is recoverable. Spawn the branch's Ruler turn
                again with the failure reason in context.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>mark-failed</h4>
              <p>
                The branch can't be recovered at this scope. Stamp the
                terminal status. Let the rollup propagate.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>freeze-record</h4>
              <p>
                The execution record reaches its terminal state. Status.
                Completed, failed, partial. No more work at this record.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>cancel-subtree</h4>
              <p>
                Walk down. Mark every descendant cancelled. Abort in
                flight controllers. Persistent marker survives session
                refresh.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>pause-frame</h4>
              <p>
                Halt the queue at the current step (or at a specified
                step index for deferred pause). Writes{" "}
                <code>pausedAtStepIndex</code> so resume reenters at the
                right position.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>resume-frame</h4>
              <p>
                Clear pause markers. Use{" "}
                <code>detectResumableSwarm</code> to find pending
                branches. Redispatch via runBranchSwarm in resume mode.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>escalate-to-ruler</h4>
              <p>
                The judgment exceeds the Foreman's authority. Bump the
                case up to the Ruler with the relevant stack context.
                The Ruler decides revise, archive, or convene court.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>respond-directly</h4>
              <p>
                The user asked something the Foreman can answer from the
                stack snapshot. No state change. Just an explanation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* STACK SNAPSHOT */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">What the Foreman reads</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Different lens than the Ruler's. The Ruler reads "what does
            my domain need now?". The Foreman reads "where in the
            execution stack am I, what's the next correct move?". The
            execution stack snapshot is built fresh per wakeup.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>frames[]</h4>
                <p>One per active execution record in the stack. Each frame. Depth, ruler nodeId, current step index, step statuses, cancellable flag, mid execution flag. Done frames collapse to one liners. Active frames render full step lists.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#60a5fa", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>parentContext</h4>
                <p>For sub Ruler frames. The lineage derived parent step and sibling state. The Foreman sees what the parent expected and how its other branches are doing.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#f59e0b", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>blockedOn[]</h4>
                <p>Derived list of what's holding the stack. Each entry has a <code>requiredAction</code> hint pointing at the right tool.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#a855f7", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>decisionHints[]</h4>
                <p>Non prescriptive suggestions the renderer surfaces. The Foreman reads them as advisory, not commands.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#ef4444", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>resumeAnchors[]</h4>
                <p>Per frame current step index captures. Read by <code>foreman-resume-frame</code> to know where to reenter when resuming.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TERMINAL STATUS */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 820}}>
          <h2 className="lp-section-title">Terminal status taxonomy</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            When the Foreman freezes a record, the status it writes
            carries semantic weight. Readers downstream (dashboards,
            court hooks, reputation accounting) discriminate on it.
          </p>
          <div style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12,
            padding: "20px 24px",
            margin: "20px 0",
            fontFamily: "ui-monospace, monospace",
            fontSize: "0.9rem",
            lineHeight: 2,
            color: "#e5e5e5",
          }}>
            <div><span style={{color: "#4ade80"}}>completed</span>. Every step succeeded. The work is done.</div>
            <div><span style={{color: "#facc15"}}>partial</span>. Some steps succeeded, others didn't. The user gets what shipped.</div>
            <div><span style={{color: "#ef4444"}}>failed</span>. Tried, couldn't. Fix or escalate.</div>
            <div><span style={{color: "#a855f7"}}>cancelled</span>. Decided not to finish. Different from failure.</div>
            <div><span style={{color: "#06b6d4"}}>paused</span>. Halted mid flight, awaiting resume.</div>
            <div><span style={{color: "#888"}}>superseded</span>. The parent revised the plan. This record is obsolete.</div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{color: "#888", fontSize: "0.92rem"}}>
            Distinct hooks fire per terminal status.{" "}
            <code>governing:executionCompleted</code>,{" "}
            <code>governing:executionFailed</code>,{" "}
            <code>governing:executionCancelled</code>, and others. So
            downstream consumers can discriminate cleanly without
            inspecting a status field.
          </p>
        </div>
      </section>

      {/* EXAMPLE FLOW: PAUSE */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">A pause, end to end</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            User starts a 3 deep build. Mid flight, says "pause." Here's
            what happens.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>1</div>
              <div className="lp-step-content">
                <h4>Ruler routes to Foreman</h4>
                <p>The user's "pause" arrives at the Ruler. Snapshot shows execution running. Ruler calls <code>governing-route-to-foreman</code> with a wakeup payload.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#60a5fa", color: "#000"}}>2</div>
              <div className="lp-step-content">
                <h4>Foreman reads stack</h4>
                <p>Foreman's snapshot renders 3 frames deep. Active step on each frame, sibling statuses, in flight branches. Foreman recognizes a pause request and picks <code>foreman-pause-frame</code> on the root record.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#f59e0b", color: "#000"}}>3</div>
              <div className="lp-step-content">
                <h4>Pause marker written</h4>
                <p>Status flips to <code>paused</code>. <code>pausedAtStepIndex</code> records position. The marker is persistent. Survives session refresh.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#a855f7", color: "#000"}}>4</div>
              <div className="lp-step-content">
                <h4>Queue halts on next dispatch</h4>
                <p>The swarm queue's halt check reads the marker before pulling the next branch. Sees <code>paused</code>. Halts. In flight controllers are aborted.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#ef4444", color: "#000"}}>5</div>
              <div className="lp-step-content">
                <h4>Foreman returns</h4>
                <p>Foreman's tool returns to the Ruler with a summary. "Paused at step 2 of root record. Resume with 'continue'." The Ruler synthesizes for the user. Next session, resume reenters at the right frame.</p>
              </div>
            </div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24, color: "#888", fontSize: "0.92rem"}}>
            One Foreman LLM call. The pause is structural. The
            programmatic halt check picks up the marker. Resume reenters
            at the right position because the anchor was written.
          </p>
        </div>
      </section>

      {/* EXAMPLE FLOW: FAILURE AND RETRY */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">A failure and retry, end to end</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Same Flappy Bird Battle Royale, mid build at depth 2. The
            entities sub Ruler dispatched its Worker. The contract
            validator just detected a violation. This wakeup shows the
            Foreman doing what makes it distinctive. Reading state
            across contracts, retries, and error category, then picking
            a tool that fits.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>1</div>
              <div className="lp-step-content">
                <h4>Validator flags the violation</h4>
                <p>Worker emitted <code>gameStateChanged</code>, but the ratified contract is <code>gameStateChange</code>. Validator marks the branch failed with reason "name mismatch on event:gameStateChange." Lifecycle event <code>branchFailed</code> wakes the Foreman.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#60a5fa", color: "#000"}}>2</div>
              <div className="lp-step-content">
                <h4>Foreman reads stack and contracts</h4>
                <p>Snapshot shows 2 frames. The entities frame at depth 2, mid branch with one failure. The Foreman reads the contract that was violated, the branch's retry budget (2 of 3 remaining), and the error category. Name mismatch is typically transient. Worker drifted on a literal name; a retry with the failure reason in context usually fixes it.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#f59e0b", color: "#000"}}>3</div>
              <div className="lp-step-content">
                <h4>Decide recoverable</h4>
                <p>Plain prose, one sentence. "Branch failed on a name mismatch. Recoverable. Retrying with the contract surfaced." Then call <code>foreman-retry-branch</code> with the failure reason, the violated contract name, and the retry budget update.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#a855f7", color: "#000"}}>4</div>
              <div className="lp-step-content">
                <h4>Branch retries and validator passes</h4>
                <p>The branch's Ruler turn spawns again with the failure reason in context. Worker reads the contract carefully this time, emits <code>gameStateChange</code>, validator passes. Branch flips to done. The swarm queue advances the rollup.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#ef4444", color: "#000"}}>5</div>
              <div className="lp-step-content">
                <h4>Swarm completes, second wakeup</h4>
                <p>All three sub Rulers settle. Lifecycle event <code>swarmCompleted</code> wakes the Foreman a second time. Snapshot shows all branches done, no failures pending. The Foreman calls <code>foreman-freeze-record</code> with status completed. The execution record reaches its terminal state.</p>
              </div>
            </div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24, color: "#888", fontSize: "0.92rem"}}>
            Two Foreman LLM calls. Two different kinds of judgment. Both
            needed. The first wakeup judged recoverability. The second
            judged terminal status across the whole swarm. Routine
            forward motion in between, the queue advancing branches as
            they settled, stayed programmatic.
          </p>
        </div>
      </section>

      {/* CLOSING CALLBACK */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760, textAlign: "center"}}>
          <p className="lp-section-sub lp-section-sub-wide" style={{fontSize: "1.1rem", color: "#e5e5e5"}}>
            The fore man stands at the front of the work. They don't do
            the work. They watch how it flows, decide when something
            needs intervention, hold frame discipline across the whole
            stack. When the work settles, the foreman steps back. When
            it stutters, the foreman judges.
          </p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-grid">
            <div className="lp-footer-col">
              <h4>Governing</h4>
              <a href="/governing">Overview</a>
              <a href="/governing/rulership">Rulership (Pass 1)</a>
              <a href="/governing/rulership/ruler">Ruler</a>
              <a href="/governing/rulership/planner">Planner</a>
              <a href="/governing/rulership/contractor">Contractor</a>
              <a href="/governing/rulership/foreman">Foreman</a>
              <a href="/governing/rulership/worker">Worker</a>
            </div>
            <div className="lp-footer-col">
              <h4>Docs</h4>
              <a href="/guide">Guide</a>
              <a href="/seed">The Seed</a>
              <a href="/ai">The AI</a>
              <a href="/cascade">Cascade</a>
              <a href="/governing">Governing</a>
              <a href="/swarm">Swarm</a>
              <a href="/flow">The Flow</a>
              <a href="/extensions">Extensions</a>
              <a href="/build">Build</a>
              <a href="/network">The Network</a>
              <a href="/mycelium">Mycelium</a>
              <a href="/lands">Start a Land</a>
              <a href="/cli">CLI</a>
            </div>
            <div className="lp-footer-col">
              <h4>TreeOS</h4>
              <a href="/use">Use</a>
              <a href="/about/api">API</a>
              <a href="/about/gateway">Gateway</a>
              <a href="/about/energy">Energy</a>
            </div>
            <div className="lp-footer-col">
              <h4>Community</h4>
              <a href="https://horizon.treeos.ai">Horizon</a>
              <a href="/blog">Blog</a>
            </div>
            <div className="lp-footer-col">
              <h4>Source</h4>
              <a href="https://github.com/taborgreat/create-treeos">GitHub</a>
              <a href="https://github.com/taborgreat/create-treeos/blob/main/template/seed/LICENSE">AGPL-3.0 License</a>
            </div>
          </div>
          <div className="lp-footer-bottom">
            TreeOS . AGPL-3.0 . <a href="https://tabors.site" style={{color: "inherit", textDecoration: "none"}}>Tabor Holly</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default ForemanPage;
