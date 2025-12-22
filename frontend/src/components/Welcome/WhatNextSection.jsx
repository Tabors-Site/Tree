import SectionNav from "./SectionNav";
const WhatToDoNextSection = () => {
    return (
        <>
            <h1>What to Do Next</h1>

            <h2>Get access</h2>

            <ol>
                <li>
                    Request a registration key by emailing{" "}
                    <strong>taborgreat@gmail.com</strong>.
                </li>
                <li>
                    Create an account at <a href="https://tabors.site"><strong>tabors.site</strong></a> and log in.
                </li>
                <li>
                    Once logged in, you’ll see your legacy tree dashboard at <a href="https://tree.tabors.site/legacy" target="_blank"><strong>tree.tabors.site/legacy</strong></a>.
                </li>
            </ol>

            <h2>Build your first tree</h2>

            <ol>
                <li>Create your first root node.</li>
                <li>
                    The name you give it defines what the entire tree grows out of.
                </li>
                <li>
                    Manually create branches to build your system — or skip ahead and let
                    AI help generate structure.
                </li>
            </ol>

            <p>
                You can build as much or as little structure manually as you want before
                involving AI.
            </p>

            <h2>Connect the AI (MCP connector)</h2>

            <p>
                The AI integration works through ChatGPT using a custom MCP connector.
                You only need to set this up once.
            </p>

            <ol>
                <li>
                    Go to <a href="https://chatgpt.com" target="_blank"><strong>chatgpt.com</strong></a> and make sure you have a{" "}
                    <strong>ChatGPT Plus</strong> subscription.
                </li>
                <li>
                    Open <strong>Settings → Apps &amp; Connectors</strong>.
                </li>
                <li>
                    Scroll to the bottom, open <strong>Advanced Settings</strong>, and
                    enable <strong>Developer Mode</strong>.
                </li>
                <li>
                    Go back to <strong>Apps &amp; Connectors</strong>.
                </li>
                <li>
                    Add a new custom connector (this may appear as{" "}
                    <em>“New App”</em> in the top right).
                </li>
            </ol>

            <p>Use the following settings:</p>

            <ul>
                <li>
                    <strong>Name:</strong> tree
                </li>
                <li>
                    <strong>MCP Server URL:</strong> tree.tabors.site/mcp
                </li>
                <li>
                    <strong>Authentication:</strong> No authentication
                </li>
            </ul>

            <h2>Set personalization</h2>

            <p>
                From the main ChatGPT settings menu, go to{" "}
                <strong>Personalization → Custom Instructions</strong>.
            </p>

            <p>
                Paste something like the following (replace the values with your own):
            </p>

            <pre>
                {`userId: your-user-id-here
rootId: default-root-id`}
            </pre>

            <p>
                You can find your <strong>userId</strong> in URL browser mode. The{" "}
                <strong>rootId</strong> can be any root node you want to work from.
            </p>

            <h2>Start the system</h2>

            <p>
                Once developer mode is enabled, you’ll see a plus icon next to the main
                ChatGPT input. Click it and select the new <strong>tree</strong> tool.
            </p>

            <p>
                Then type:
            </p>

            <pre>start tree</pre>

            <p>
                This command is the entry point for the system. Call it whenever you
                start a new chat or want to reset the flow.
            </p>

            <p>
                If you did not add <strong>userId</strong> and <strong>rootId</strong> in
                personalization, you can provide them manually:
            </p>

            <pre>
                {`start tree
userId: your-user-id
rootId: your-root-or-node-id`}
            </pre>

            <p>
                You can also use any node as a temporary root by passing its node ID
                instead.
            </p>

            <h2>Enter “Be” mode</h2>

            <p>
                Once you’ve built a solid structure — manually, with AI, or both — you
                can enter <strong>Be mode</strong>.
            </p>

            <p>
                In Be mode, the AI actively guides you through your tree, helping you
                reflect, decide next actions, and move forward based on what already
                exists.
            </p>

            <p>
                This is where the system becomes less about managing data and more about
                thinking clearly and making progress.
            </p>
            <SectionNav currentId="next" />

        </>
    );
};

export default WhatToDoNextSection;
