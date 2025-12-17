const HowAIFitsInSection = () => {
    return (
        <>
            <h1>How AI Fits In</h1>

            <p>
                AI integrates directly through ChatGPT as a connector. You don’t use a
                separate AI interface or learn a new workflow — you just talk.
            </p>

            <p>
                Behind the scenes, the language model works with your tree to understand
                your structure, history, and intent. It pulls the information it needs
                directly from the tree instead of relying on generic assumptions.
            </p>

            <h2>What the AI does</h2>

            <p>
                The AI can read and work with existing data in your tree to:
            </p>

            <ul>
                <li>Create new plans and structures</li>
                <li>Edit or reorganize existing nodes</li>
                <li>Summarize what has happened so far</li>
                <li>Give guidance on what to do next</li>
                <li>Generate scripts and automations</li>
                <li>Use your data as context for other work</li>
            </ul>

            <p>
                Because the AI operates on your actual data, its output stays grounded
                in what you’ve already built instead of drifting into inflated or
                disconnected plans.
            </p>

            <h2>Why the tree structure matters</h2>

            <p>
                The branching structure is important because the AI doesn’t need your
                entire tree every time it works.
            </p>

            <p>
                It can pull only the relevant branches needed for a specific task —
                whether that’s a single node, a subtree, or a particular version. This
                keeps context focused and prevents unnecessary noise.
            </p>

            <p>
                Smaller, structured context leads to better results, faster responses,
                and fewer hallucinations.
            </p>

            <h2>How you interact with it</h2>

            <p>
                From your perspective, almost nothing is different from using ChatGPT
                normally.
            </p>

            <p>
                The only setup step is adding the connector and calling the{" "}
                <strong>root orchestrator</strong>. This initializes the system and gives the
                AI permission to operate on your tree.
            </p>

            <p>
                You can ask questions, request changes, plan future work, or reflect on past
                progress. The AI gathers the information it needs, uses the appropriate tools,
                and updates the tree behind the scenes.
            </p>

            <p>
                You don’t manage prompts, context windows, or individual tools. The root
                orchestrator handles coordination and context selection automatically.
            </p>

            <p>
                After it’s initialized, the experience feels like a normal conversation —
                except the AI understands your structure, remembers what matters, and can act
                on it over time.
            </p>

        </>
    );
};

export default HowAIFitsInSection;
