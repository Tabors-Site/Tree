import SectionNav from "./SectionNav";

const WhatToDoNextSection = () => {
    return (
        <>
            <h1>Getting Started</h1>

            <h2>Create your account</h2>
            <ol>
                <li>
                    Create an account in the app and log in.
                </li>
                <li>
                    After logging in, you’ll see your profile in the app.
                </li>
            </ol>

            <h2>Build your first tree</h2>
            <ol>
                <li>Create your first root node.</li>
                <li>
                    The name of the root defines what the entire tree grows from.
                </li>
                <li>
                    Add branches manually, or skip ahead and let AI help generate
                    structure.
                </li>
            </ol>

            <p>
                You can build as much or as little structure as you want before
                involving AI.
            </p>

            <h2>Connect the AI (MCP connector)</h2>
            <p>
                AI integration works through ChatGPT using a custom MCP connector.
                This only needs to be set up once.
            </p>

            <ol>
                <li>
                    Go to{" "}
                    <a href="https://chatgpt.com" target="_blank" rel="noreferrer">
                        <strong>chatgpt.com</strong>
                    </a>{" "}
                    and make sure you have a <strong>ChatGPT Plus</strong> subscription.
                </li>
                <li>
                    Open <strong>Settings → Apps</strong>.
                </li>
                <li>
                    Scroll down to <strong>Advanced Settings</strong> and enable{" "}
                    <strong>Developer Mode</strong>.
                </li>
                <li>
                    Go back to <strong>Apps</strong> and click <strong>Create App</strong>.
                </li>
            </ol>

            <p>Use the following settings:</p>
            <ul>
                <li>
                    <strong>Name:</strong> tree
                </li>
                <li>
                    <strong>MCP Server URL:</strong>{" "}
                    https://tree.tabors.site/mcp
                </li>
                <li>
                    <strong>Authentication:</strong> OAuth
                </li>
            </ul>

            <p>
                You’ll be prompted to log in to tree.tabors.site to connect your account
                if you aren’t already logged in.
            </p>

            <h2>Start the AI</h2>
            <p>
                Once Developer Mode is enabled and the <strong>tree</strong> app is
                added, you’ll see a plus icon next to the ChatGPT input.
                Select the <strong>tree</strong> tool.
            </p>

            <p>Then type:</p>
            <pre>start tree</pre>

            <p>
                You can include a root ID, or ask:
                <br />
                <em>“What are my root nodes?”</em>
            </p>

            <pre>{`start tree

rootId: your-root-or-node-id`}</pre>

            <p>
                You can also pass any node ID to temporarily treat that node as
                the root.
            </p>

            <h2>Enter “Be” mode</h2>
            <p>
                Once you’ve built a solid structure — manually, with AI, or both —
                you can enter <strong>Be mode</strong>.
            </p>

            <p>
                In Be mode, the AI guides you through your tree, helping you reflect,
                decide next actions, and move forward using what already exists.
            </p>

            <p>
                This is where the system shifts from managing data to thinking
                clearly and making progress.
            </p>

            <SectionNav currentId="gettingstarted" />
        </>
    );
};

export default WhatToDoNextSection;

