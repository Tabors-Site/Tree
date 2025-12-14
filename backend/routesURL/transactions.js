import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import { getTransactions } from "../core/transactions.js";

const router = express.Router();

const allowedParams = ["token", "html"];

router.get("/:nodeId/:version/transactions", urlAuth, async (req, res) => {
  try {
    const { nodeId, version } = req.params;

    const parsedVersion = Number(version);
    if (isNaN(parsedVersion)) {
      return res.status(400).json({
        error: "Invalid version: must be a number",
      });
    }

    const filtered = Object.entries(req.query)
      .filter(([key]) => allowedParams.includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    const result = await getTransactions({
      nodeId,
      version: parsedVersion,
    });

    // JSON MODE
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml) {
      return res.json({
        nodeId,
        version: parsedVersion,
        ...result,
      });
    }

    // HTML MODE
    const transactions = result.transactions || [];

    const transactionsHtml =
      transactions.length > 0
        ? `
      <ul>
        ${transactions
          .map((tx) => {
            const isNodeA = tx.perspective === "nodeA";

            const selfVersion = isNodeA ? tx.versionAIndex : tx.versionBIndex;

            const counterpartyVersion = isNodeA
              ? tx.versionBIndex
              : tx.versionAIndex;

            return `
  <li>
    <br/>

    <small>
      <em>${new Date(tx.date || tx.createdAt).toLocaleString()}</em>
    </small>
    <br/>

    <small>
      You:
      <a href="/api/${nodeId}/${selfVersion}${queryString}">
        <code>${nodeId} version: ${selfVersion}</code>
      </a>
    </small>
    <br/>

    <small>
      Counterparty:
      <a href="/api/${
        tx.counterparty?._id
      }/${counterpartyVersion}${queryString}">
        <code>${tx.counterparty?._id} version: ${counterpartyVersion}</code>
      </a>
    </small>
    <br/>

    <small>
      Sent:
      <code>${JSON.stringify(tx.valuesSent)}</code>
    </small>
    <br/>

    <small>
      Received:
      <code>${JSON.stringify(tx.valuesReceived)}</code>
    </small>
  </li>
`;
          })
          .join("")}
      </ul>
    `
        : `<p><em>No transactions found</em></p>`;

    return res.send(`
        <html>
        <head>
          <title>Node Transactions</title>
          <style>
            body {
              font-family: system-ui, sans-serif;
              padding: 20px;
              line-height: 1.6;
              background: #fafafa;
            }

            h1 { margin-bottom: 6px; }
            h2 { margin-top: 28px; }

            a {
              color: #0077cc;
              text-decoration: none;
              font-weight: 500;
            }

            a:hover { text-decoration: underline; }

            ul {
              list-style: none;
              padding-left: 18px;
            }

            li {
              margin-bottom: 14px;
            }
              li em {
  color: #777;
  font-size: 12px;
}


            code {
              background: #eee;
              padding: 2px 6px;
              border-radius: 4px;
              font-size: 12px;
            }

            small {
              color: #555;
            }
          </style>
        </head>

        <body>

        

          <p>
             <h2><a href="/api/${nodeId}${queryString}">
              Node: ${nodeId}
            </a></h2>
            

           <h2> Version:
            <a href="/api/${nodeId}/${parsedVersion}${queryString}">
              <code>${parsedVersion}</code>
            </a></h2>
          </p>

           <h2><strong>Transactions</strong></h2>
          ${transactionsHtml}

          

        </body>
        </html>
      `);
  } catch (err) {
    console.error("Error in :nodeId/:version/transactions:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
