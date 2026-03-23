import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, "../land/server.js");
const TEST_PORT = 39_001 + Math.floor(Math.random() * 900);
const TEST_DB = `mongodb://localhost:27017/tree-test-${Date.now()}`;
const BASE = `http://localhost:${TEST_PORT}/api/v1`;

let serverProc;
let token;
let apiKey;
let userId;
let rootId;
let childNodeId;

async function api(method, endpoint, body, headers = {}) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${endpoint}`, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function auth() {
  return { Authorization: `Bearer ${token}` };
}

describe("Core API", () => {
  before(async () => {
    serverProc = spawn("node", [SERVER_PATH], {
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        MONGODB_URI: TEST_DB,
        LAND_DOMAIN: "localhost",
        LAND_NAME: "Test Land",
        JWT_SECRET: "test-secret-key",
        CUSTOM_LLM_API_SECRET_KEY: "test-encryption-key-1234567890",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Server startup timed out")), 30_000);
      let output = "";
      const onData = (chunk) => {
        output += chunk.toString();
        if (output.includes("Land node online")) {
          clearTimeout(timeout);
          resolve();
        }
      };
      serverProc.stdout.on("data", onData);
      serverProc.stderr.on("data", onData);
      serverProc.on("error", (err) => { clearTimeout(timeout); reject(err); });
      serverProc.on("exit", (code) => {
        if (code !== null && code !== 0) { clearTimeout(timeout); reject(new Error(`Server exited ${code}:\n${output}`)); }
      });
    });
  });

  after(async () => {
    if (serverProc) {
      serverProc.kill("SIGTERM");
      await new Promise((r) => serverProc.on("exit", r));
    }
    const mongodbPath = path.resolve(__dirname, "../land/node_modules/mongodb/lib/index.js");
    const { MongoClient } = await import(mongodbPath);
    const client = new MongoClient(TEST_DB);
    try { await client.connect(); await client.db().dropDatabase(); } finally { await client.close(); }
  });

  it("GET /protocol returns server info", async () => {
    const { status, data } = await api("GET", "/protocol");
    assert.equal(status, 200);
    assert.equal(data.name, "TreeOS");
    assert.ok(Array.isArray(data.extensions));
    assert.ok(data.extensions.length > 0);
  });

  it("POST /register creates a user", async () => {
    const { status, data } = await api("POST", "/register", {
      username: "testuser",
      password: "testpass123",
      email: "test@test.com",
    });
    assert.ok([200, 201].includes(status), `Expected 200/201, got ${status}`);
    assert.ok(data.userId, "Should return a user ID");
    assert.ok(data.token, "Should return a token");
    userId = data.userId;
    token = data.token;
    if (data.apiKey) apiKey = data.apiKey;
  });

  it("POST /login returns a token", async () => {
    const { status, data } = await api("POST", "/login", {
      username: "testuser",
      password: "testpass123",
    });
    assert.equal(status, 200);
    assert.ok(data.token, "Should return a JWT token");
    token = data.token;
  });

  it("POST /user/:userId/createRoot creates a tree", async () => {
    const { status, data } = await api(
      "POST",
      `/user/${userId}/createRoot`,
      { name: "Test Tree" },
      auth(),
    );
    assert.ok([200, 201].includes(status), `Expected 200/201, got ${status}: ${JSON.stringify(data)}`);
    rootId = data.root?._id || data.rootId || data._id;
    assert.ok(rootId, "Should return a root ID");
  });

  it("POST /node/:id/createChild creates a child node", async () => {
    const { status, data } = await api(
      "POST",
      `/node/${rootId}/createChild`,
      { name: "Child Node" },
      auth(),
    );
    assert.ok([200, 201].includes(status), `Expected 200/201, got ${status}: ${JSON.stringify(data)}`);
    childNodeId = data.childId || data.child?._id;
    assert.ok(childNodeId, "Should return a node ID");
  });

  it("POST /node/:id/notes adds a note", async () => {
    const { status } = await api(
      "POST",
      `/node/${childNodeId}/notes`,
      { content: "Test note content", contentType: "text" },
      auth(),
    );
    assert.ok([200, 201].includes(status), `Expected 200/201, got ${status}`);
  });

  it("POST /node/:id/editStatus changes status", async () => {
    const { status } = await api(
      "POST",
      `/node/${childNodeId}/editStatus`,
      { status: "trimmed" },
      auth(),
    );
    assert.equal(status, 200);
  });

  it("GET /node/:id returns the node", async () => {
    const { status, data } = await api("GET", `/node/${childNodeId}`, null, auth());
    assert.equal(status, 200);
    const node = data.node || data;
    assert.equal(node.name, "Child Node");
    assert.equal(node.status, "trimmed");
  });

  it("GET /root/:id/holdings returns empty", async () => {
    const { status, data } = await api("GET", `/root/${rootId}/holdings`, null, auth());
    assert.equal(status, 200);
    if (Array.isArray(data)) {
      assert.equal(data.length, 0);
    } else {
      assert.ok(data.answer, "Should return a message when empty");
    }
  });

  it("GET /protocol shows extensions with CLI declarations", async () => {
    const { status, data } = await api("GET", "/protocol");
    assert.equal(status, 200);
    assert.ok(data.cli, "Should have CLI declarations");
    assert.ok(Object.keys(data.cli).length > 0);
  });
});
