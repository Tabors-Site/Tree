import SectionNav from "./SectionNav";
const HowAIFitsInSection = () => {
  return (
    <>
      <h1>How AI Fits In</h1>

      <p>
        AI integrates directly through ChatGPT as a connector. You don’t use a
        separate AI interface or learn a new workflow. You just talk.
      </p>

      <p>
        Behind the scenes, the language model works with your tree to understand
        your structure, history, and intent. It pulls information directly from
        your tree instead of relying on generic assumptions. This allows it to
        respond with better context, reduce hallucinations, and produce more
        personalized and dependable results.
      </p>

      <h2>What the AI does</h2>

      <p>
        The AI can read and work with the existing data in your tree to:
      </p>

      <ul>
        <li>Create new plans and structures</li>
        <li>Edit or reorganize existing nodes</li>
        <li>Summarize what has happened so far</li>
        <li>Suggest what to do next</li>
        <li>Generate scripts and automations</li>
        <li>Use your data as context for other work</li>
      </ul>

      <p>
        Because the AI operates on your actual data, its output stays grounded in
        what you’ve already built instead of drifting into inflated or disconnected
        plans.
      </p>

      <h2>Why the tree structure matters</h2>

      <p>
        The branching structure matters because the AI doesn’t need your entire
        tree every time it works.
      </p>

      <p>
        It can pull only the relevant branches needed for a specific task, whether
        that’s a single node, a subtree, or a particular version. This keeps the
        context focused and avoids unnecessary noise.
      </p>

      <p>
        Smaller, well-structured context leads to better results and fewer hallucinations.
        The AI doesn’t just see the current node, but also the relevant surrounding node at lesser depths,
        allowing it to understand the broader picture.
      </p>


      <h2>How you interact with it</h2>

      <p>
        From your perspective, almost nothing feels different from using ChatGPT
        normally.
      </p>

      <p>
        The only setup step is adding the connector and calling the{" "}
        <code>start tree</code>. This initializes the system and gives
        the AI permission to work with your tree. You can learn more about setup in
        the “Interaction Methods” section.
      </p>

      <p>
        You can ask questions, request changes, plan future work, or reflect on
        past progress. The AI gathers the information it needs, uses the
        appropriate tools, and updates the tree behind the scenes.
      </p>

      <p>
        You don’t manage prompts, context windows, or individual tools. The root
        orchestrator handles coordination and context selection automatically.
      </p>

      <p>
        Once initialized, the experience feels like a normal conversation, except
        the AI understands your structure, remembers what matters, and can act on
        it over time. In practice, this means you can build systems and guide them
        using words, and they become more useful and more aligned the longer you
        work with them.
      </p>
      <SectionNav currentId="ai" />

    </>
  );
};

export default HowAIFitsInSection;
