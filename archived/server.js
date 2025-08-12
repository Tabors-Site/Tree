const express = require("express");
const https = require("https");
const bodyParser = require("body-parser");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt"); // To securely hash passwords
const mongoose = require("mongoose");

require("dotenv").config();

const app = express();
const port = 442; //https
const host = '0.0.0.0';
console.log("Current Working Directory:", process.cwd());

const privateKey = fs.readFileSync("./serverkeys/voteonsol.com-key.pem", "utf8");
const certificate = fs.readFileSync("./serverkeys/voteonsol.com-crt.pem", "utf8");
const credentials = { key: privateKey, cert: certificate };



const cors = require('cors');
app.use(cors({
  origin: 'http://localhost:5173',  // Allow only this origin
  methods: ['GET', 'POST', 'OPTIONS'],    // Allow GET, POST, and OPTIONS methods
  allowedHeaders: ['Content-Type', 'Authorization'],       // Allow Content-Type header
  credentials: true,                      // Allow credentials if needed
}));
app.options('*', cors());
app.use(express.static("public"));
app.use(bodyParser.json({ limit: "50mb" })); // Increase the limit to 50MB
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

// Secret key for JWT signing
const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

/*DB connection*/
const mongooseUri = process.env.MONGODB_URI;

const Node = require("./db/models/node");
const Transaction = require("./db/models/transaction");
const User = require("./db/models/user");
const Contribution = require("./db/models/contribution");
const Note = require("./db/models/notes");
const Invite = require("./db/models/invite");

mongoose
  .connect(mongooseUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

/*AI*/
// Endpoint for Groq API
app.post("/AiResponse", async (req, res) => {
  const { messages, model, temperature, max_tokens, top_p, stop } = req.body;

  const payload = {
    messages,
    model: model || "llama3-8b-8192", // Default values
    temperature: temperature || 1,
    max_tokens: max_tokens || 1024,
    top_p: top_p || 1,
    stop: stop || null,
  };

  try {
    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!groqResponse.ok) {
      throw new Error(`Groq API error: ${groqResponse.statusText}`);
    }

    const reader = groqResponse.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let content = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      content += decoder.decode(value, { stream: true });
    }

    res.json({ success: true, data: content });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/*user functions and ednpoints*/
// Middleware to verify the JWT token and extract user info
const authenticate = (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res
      .status(401)
      .json({ message: "Access denied. No token provided." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId; // Attach userId to the request object
    next(); // Call the next middleware or route handler
  } catch (error) {
    res.status(400).json({ message: "Invalid token." });
  }
};

// Endpoint to register a new user
app.post("/register", async (req, res) => {
  console.log("someone")
  try {
    const { username, password } = req.body;

    // Validate request body
    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username and password are required" });
    }

    // Check if username is already taken
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: "Username already taken" });
    }

    // Create a new user
    const newUser = new User({
      username,
      password, // Password will be hashed by the pre-save hook in the model
    });

    await newUser.save();
    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
// Endpoint to log in
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username and password are required" });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Create JWT token
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });

    res.cookie('token', token, {
      httpOnly: true,   // Makes cookie accessible only via HTTP(S) requests
      secure: true,     // Only send cookie over HTTPS connections
      sameSite: 'None', // Required for cross-site cookies
      maxAge: 604800000, // 7 days in milliseconds
    });

    // Send token as a response
    res
      .status(200)
      .json({ message: "Login successful", token, userId: user.id });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

async function getRootNodes(userId) {
  try {
    const user = await User.findById(userId); // No need to populate roots
    if (!user) {
      return null; // If the user is not found
    }
    return user.roots; // Return the roots array, which contains just the node IDs
  } catch (error) {
    throw error; // Handle the error if needed
  }
}

//gets root node id's from user db
app.get("/get-root-nodes", authenticate, async (req, res) => {
  // Debug log to check user ID
  const userId = req.userId;
  try {
    const rootNodes = await getRootNodes(userId);
    if (!rootNodes || rootNodes.length === 0) {
      return res.json({ roots: [] });
    }
    res.json({ roots: rootNodes });
  } catch (error) {
    console.error("Error fetching root nodes:", error);
    res.status(500).json({ message: "Server error" });
  }
});

//for getting owner and contributors of roots from node db
app.post("/get-root-details", async (req, res) => {
  const { id } = req.body;

  try {
    // Find the node by ID and only return rootOwner and contributors
    const node = await Node.findById(id, "rootOwner contributors")
      .populate("rootOwner", "_id username") // Populates rootOwner details (like username)
      .populate("contributors", "_id username"); // Populates contributors details (like usernames)

    if (!node) {
      return res.status(404).json({ error: "Node not found" });
    }

    // Respond with the data
    res.json({
      rootOwner: node.rootOwner,
      contributors: node.contributors,
    });
  } catch (error) {
    console.error("Error fetching node details:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const logContribution = async ({
  userId,
  nodeId,
  action,
  statusEdited,
  valueEdited,
  nodeVersion,
  tradeId,
  goalEdited,
  scheduleEdited,
  inviteAction,
}) => {
  // Default handling for optional fields
  statusEdited = statusEdited || null; // Set status to null if it's undefined or null
  goalEdited = goalEdited || null;
  scheduleEdited = scheduleEdited || null;
  inviteAction = inviteAction || null;
  valueEdited = valueEdited || null; // Set valueEdited to an empty Map if undefined or null
  tradeId = tradeId || null; // Set tradeId to null if undefined or null
  // Validate 'action' field against allowed actions
 
  const validActions = [
    "create",
    "editStatus",
    "editValue",
    "prestige",
    "trade",
    "delete",
    "invite",
    "editSchedule",
    "editGoal",
  ];
  if (!validActions.includes(action)) {
    throw new Error("Invalid action type");
  }
 

  try {
    // Validate required fields (userId, nodeId, action, and nodeVersion are required)
    if (!userId || !nodeId || !action || nodeVersion === undefined) {
      throw new Error("Missing required fields");
    }

    // Create a new contribution document
    const newContribution = new Contribution({
      userId: userId,
      nodeId: nodeId,
      action: action,
      statusEdited: statusEdited,
      valueEdited: valueEdited,
      tradeId: tradeId,
      nodeVersion: nodeVersion,
      goalEdited: goalEdited,
      scheduleEdited: scheduleEdited,
      inviteAction: inviteAction,
      date: new Date(),
    });

    // Save the new contribution to the database
    await newContribution.save();
  } catch (error) {
    console.error("Error logging contribution:", error);
    throw new Error(error.message || "Internal server error");
  }
};

async function findNodeById(nodeId) {
  try {
    const node = await Node.findOne({ _id: nodeId }).populate("children");
    if (!node) {
      return null; // Return null if the node is not found
    }
    return node;
  } catch (error) {
    console.error("Error finding node by UUID:", error);
    throw error; // Re-throw for unexpected errors
  }
}
app.post("/get-contributions", authenticate, async (req, res) => {
  const { nodeId } = req.body;

  try {
    // Fetch contributions for the node and populate userId (to get the user name) and nodeId (to get the full node details)
    const contributions = await Contribution.find({ nodeId })
      .populate("userId", "username") // Populate only the 'username' field from the User model
      .populate("nodeId") // Populate the entire node object
      .populate("inviteAction.receivingId", "username") // Populate receivingId in inviteAction
      .sort({ date: -1 }); // Sort by date in descending order

    // Modify the contributions to add more details based on the action
    const enhancedContributions = contributions.map((contribution) => {
      let additionalInfo = null;

      // Determine additional information based on the action
      switch (contribution.action) {
        case "editValue":
          additionalInfo = { valueEdited: contribution.valueEdited };
          break;
        case "editStatus":
          additionalInfo = { statusEdited: contribution.statusEdited };
          break;
        case "trade":
          additionalInfo = { tradeId: contribution.tradeId };
          break;
        case "invite":
          additionalInfo = {
            inviteAction: contribution.inviteAction
              ? {
                  action: contribution.inviteAction.action,
                  receivingUsername: contribution.inviteAction.receivingId
                    ? contribution.inviteAction.receivingId.username
                    : null,
                }
              : null,
          };
          break;
        case "editSchedule":
          additionalInfo = { scheduleEdited: contribution.scheduleEdited };
          break;
        case "editGoal":
          additionalInfo = { goalEdited: contribution.goalEdited };
          break;
        default:
          additionalInfo = null;
      }

      return {
        ...contribution.toObject(),
        username: contribution.userId.username, // Add the username to the contribution object
        additionalInfo, // Add the conditional info based on the action type
        nodeVersion: contribution.nodeVersion, // Add the node version
      };
    });

    res.status(200).json({ success: true, contributions: enhancedContributions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});


async function setValueForNode(nodeId, key, value, userId, versionIndex) {
  const node = await findNodeById(nodeId);

  try {
    if (!node) {
      throw new Error("Node not found");
    }

    // Check if the versionIndex exists in the versions array
    if (node.versions[versionIndex] === undefined) {
      throw new Error("Version index does not exist");
    }

    const currentVersion = node.versions[versionIndex];

    // Ensure that the 'values' map is updated properly
    if (currentVersion) {
      currentVersion.values.set(key, value);
    } else {
      // If there are no existing values, create a new Map
      currentVersion.values = new Map();
      currentVersion.values.set(key, value);
    }

    // Optionally save the node after modification if your system supports persistence
    await node.save();
    await logContribution({
      userId: userId,
      nodeId,
      action: "editValue",
      status: null,
      valueEdited: { [key]: value },
      nodeVersion: versionIndex,
      tradeId: null,
    });



    return currentVersion;
  } catch (error) {
    console.error("Error setting value for node:", error);
  }
}

app.post("/edit-value", authenticate, async (req, res) => {
  const { nodeId, key, value, version } = req.body;
  const userId = req.userId;
  const versionIndex = version.toString();
  const numericValue = Number(value);

  // Check if the conversion was successful and that it's a number
  if (isNaN(numericValue)) {
    return res.status(400).json({ error: "Value must be a valid number" });
  }
  try {
    await setValueForNode(nodeId, key, value, userId, versionIndex);
    return res.status(200).json({ message: "Value updated successfully." });
  } catch {
    console.log("value update was not full of success");
  }
  
});

async function setGoalForNode(nodeId, key, goal, userId, versionIndex) {
  const node = await findNodeById(nodeId);

  try {
    if (!node) {
      throw new Error("Node not found");
    }

    // Check if the versionIndex exists in the versions array
    if (node.versions[versionIndex] === undefined) {
      throw new Error("Version index does not exist");
    }

    const currentVersion = node.versions[versionIndex];

    // Ensure that the 'values' map is updated properly
    if (currentVersion) {
      currentVersion.goals.set(key, goal);
    } else {
      // If there are no existing values, create a new Map
      currentVersion.values = new Map();
      currentVersion.goals.set(key, goal);
    }

    // Optionally save the node after modification if your system supports persistence
    await node.save();
    await logContribution({
      userId: userId,
      nodeId,
      action: "editGoal",
      status: null,
      goalEdited: { [key]: goal },
      nodeVersion: versionIndex,
      tradeId: null,
    });

   

    return currentVersion;
  } catch (error) {
    console.error("Error setting goal for node:", error);
  }
}

app.post("/edit-goal", authenticate, async (req, res) => {
  const { nodeId, key, goal, version } = req.body;
  const userId = req.userId;
  const versionIndex = version.toString();
  const numericValue = Number(goal);

  if (isNaN(numericValue)) {
    return res.status(400).json({ error: "Goal must be a valid number" });
  }

  try {
    await setGoalForNode(nodeId, key, goal, userId, versionIndex);
    return res.status(200).json({ message: "Goal updated successfully." });
  } catch (error) {
    console.error("Error updating goal:", error);
    return res.status(500).json({ error: "Failed to update goal" });
  }
});

// POST /get-tree - Returns the entire tree starting from a specified root node (rootId in body)
app.post("/get-tree", async (req, res) => {
  try {
    // Get the root node ID from the JSON body
    const { rootId } = req.body;

    // If no rootId is provided in the body, return an error message
    if (!rootId) {
      return res.status(400).json({ message: "Root node ID is required" });
    }

    // Find the specified root node by ID
    const rootNode = await Node.findById(rootId)
      .populate("children") // Populate direct children of the root
      .exec();

    // If no node with the specified ID exists
    if (!rootNode) {
      return res.status(404).json({ message: "Node not found" });
    }

    // Recursively populate all children of each node
    const populateChildrenRecursive = async (node) => {
      if (node.children && node.children.length > 0) {
        // Recursively populate the children of each child
        node.children = await Node.populate(node.children, {
          path: "children",
        });

        // Recursively populate each of the child nodes
        for (const child of node.children) {
          await populateChildrenRecursive(child);
        }
      }
    };

    // Start with the specified root node and populate recursively
    await populateChildrenRecursive(rootNode);

    // Send the complete tree back as a JSON response
    res.json(rootNode);
  } catch (error) {
    console.error("Error fetching tree:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /get-parents - Returns all parent nodes up to the root for a given child node
app.post("/get-parents", async (req, res) => {
  try {
    const { childId } = req.body;

    // If no childId is provided, return an error
    if (!childId) {
      return res.status(400).json({ message: "Child node ID is required" });
    }

    // Function to recursively find all parents
    const getParentsRecursive = async (nodeId, parents = []) => {
      // Find the current node by ID
      const currentNode = await Node.findById(nodeId).exec();

      // If node doesn't exist, return the collected parents so far
      if (!currentNode) {
        return parents;
      }

      // Add the current node to the parents list
      parents.push(currentNode);

      // If the node has a parent, continue upwards
      if (currentNode.parent) {
        return await getParentsRecursive(currentNode.parent, parents);
      }

      // If no parent, return the collected parents
      return parents;
    };

    // Start the recursive function with the child node
    const parentNodes = await getParentsRecursive(childId);

    // Return the list of parent nodes as a JSON response
    res.json(parentNodes);
  } catch (error) {
    console.error("Error fetching parents:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Endpoint to fetch all transactions
app.get("/get-transactions", async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate("nodeAId") // Populate nodeAId to get its data
      .populate("nodeBId")
      // Populate nodeBId to get its data
      .exec();

    res.json(transactions); // Return the transactions as JSON response
  } catch (error) {
    console.error("Error fetching transactions:", error);
    res.status(500).json({ message: "Server error" });
  }
});

async function createNewNode(
  name,
  schedule,
  reeffectTime,
  parentNodeID,
  isRoot = false,
  userId
) {
  const newNode = new Node({
    name,
    prestige: 0,
    versions: [
      {
        prestige: 0,
        values: {},
        status: "active",
        dateCreated: new Date(),
        schedule: schedule ? new Date(schedule) : null,
        reeffectTime: reeffectTime || 0,
        goals: [],
      },
    ],
    children: [],
    parent: parentNodeID && parentNodeID !== null ? parentNodeID : null,
    rootOwner: isRoot ? userId : null, // Assign owner if it's a root node
    contributors: [],
  });

  await newNode.save();
  return newNode;
}

app.post("/add-node", authenticate, async (req, res) => {
  const { parentId, name, schedule, reeffectTime, isRoot } = req.body; // Include isRoot in request
  const userId = req.userId;
  try {
    // Check if the parentId is valid only if it's not a root node
    if (isRoot) {
      try {
        if (parentId !== null) {
          const parentNode = await findNodeById(parentId);
          if (!parentNode) {
            return res
              .status(404)
              .json({ success: false, message: "Parent node not found" });
          }
        }
      } catch (error) {
        return res.status(500).json({
          success: false,
          message: "Error finding parent node",
          error: error.message,
        });
      }
    }

    // Create the new node
    const newNode = await createNewNode(
      name,
      schedule,
      reeffectTime,
      parentId,
      isRoot,
      userId
    );

    // If the node is a root, add it to the user's roots array
    if (isRoot) {
      try {
        const user = await User.findById(userId);
        if (!user) {
          return res
            .status(404)
            .json({ success: false, message: "User not found" });
        }

        user.roots.push(newNode._id); // Add the new node to the user's roots array
        await user.save();
      } catch (error) {
        return res.status(500).json({
          success: false,
          message: "Error updating user's roots",
          error: error.message,
        });
      }
    }

    // If it's not a root, add the new node's ID to the parent's children array
    if (parentId !== null) {
      try {
        const parentNode = await findNodeById(parentId);
        if (!parentNode) {
          return res
            .status(404)
            .json({ success: false, message: "Parent node not found" });
        }
        parentNode.children.push(newNode._id);
        await parentNode.save();
      } catch (error) {
        return res.status(500).json({
          success: false,
          message: "Error adding child node to parent",
          error: error.message,
        });
      }
    }

    // Log the user's contribution
    try {
      await logContribution({
        userId: userId,
        nodeId: newNode._id,
        action: "create",
        nodeVersion: "0",
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Error logging contribution",
        error: error.message,
      });
    }

    // Return the newly created node as a response
    res.json({ success: true, newNode });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error adding node",
      error: err.message,
    });
  }
});

app.post("/add-nodes-tree", async (req, res) => {
  const { parentId, nodeTree } = req.body;

  if (!parentId || !nodeTree) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid request data" });
  }

  try {
    // Ensure the parent node exists
    const parentNode = await findNodeById(parentId);
    if (!parentNode) {
      return res
        .status(404)
        .json({ success: false, message: "Parent node not found" });
    }

    // Recursive function to create nodes and collect their IDs
    async function createNodesRecursive(nodeData, parentId) {
      const { name, schedule, reeffectTime, children = [] } = nodeData;

      // Create a new node
      const newNode = await createNewNode(
        name,
        schedule,
        reeffectTime,
        parentId
      );

      // Process children recursively and update their IDs in the new node
      for (const childData of children) {
        const childId = await createNodesRecursive(childData, newNode._id);
        newNode.children.push(childId); // Update the children array of the current node
      }

      await newNode.save(); // Save the node with its updated children

      return newNode._id; // Return the new node's ID
    }

    // Create the tree starting from the provided parent ID
    const newChildId = await createNodesRecursive(nodeTree, parentId);

    // Update the parent node with the new child reference
    parentNode.children.push(newChildId);
    await parentNode.save();

    res.json({ success: true, message: "Nodes added successfully" });
  } catch (err) {
    console.error("Error adding nodes tree:", err);
    res.status(500).json({
      success: false,
      message: "Error adding nodes tree",
      error: err.message,
    });
  }
});

// POST /edit-status - Edits the status of a specific version of a node and all its child nodes
app.post("/edit-status", authenticate, async (req, res) => {
  const { nodeId, status, version, isInherited } = req.body;
  const userId = req.userId;

  try {
    const node = await findNodeById(nodeId);
    if (!node) {
      return res
        .status(404)
        .json({ success: false, message: "Node not found" });
    }

    // Find the specific version of the node based on the version provided
    const targetVersion = node.versions.find((v) => v.prestige === version);
    if (!targetVersion) {
      return res
        .status(404)
        .json({ success: false, message: "Version not found" });
    }

    // Update the status of the specific version of the node
    targetVersion.status = status;
    await node.save(); // Save the updated node

    try {
      await logContribution({
        userId: userId,
        nodeId: nodeId,
        action: "editStatus",
        statusEdited: status,
        nodeVersion: version,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Error logging contribution",
        error: error.message,
      });
    }

    if (isInherited){
      await updateNodeStatusRecursively(node, status, version, userId);
    }


    // Return success message
    res.json({
      success: true,
      message: `Status updated to ${status} for node version ${version} and its children`,
    });
  } catch (error) {
    console.error("Error updating node status:", error);
    res
      .status(500)
      .json({ success: false, message: "Error updating node status" });
  }
});

async function updateNodeStatusRecursively(node, status, version, userId) {

  // If the status is "divider", update the parent node and skip child updates
  if (status === "divider") {
    // Update the parent node status without modifying the children
    const targetVersionIndex = node.versions.findIndex(
      (v) => v.prestige === version
    );
    if (targetVersionIndex !== -1) {
      // Update the version status by index
      node.versions[targetVersionIndex].status = status;
      await node.save(); // Save the updated node
    }
  } else {
    // If the status is "active", "trimmed", or "completed", process children
    if (["active", "trimmed", "completed"].includes(status)) {
      // Iterate over children nodes and update them
      for (const childId of node.children) {
        const childNode = await findNodeById(childId);

        // Find the index of the version that matches the child's prestige
        const targetChildVersionIndex = childNode.versions.findIndex(
          (v) => v.prestige === childNode.prestige
        );

        // If a matching version is found, update its status
        if (targetChildVersionIndex !== -1) {
          childNode.versions[targetChildVersionIndex].status = status;
          await childNode.save(); // Save the updated child node

        
          try {
            await logContribution({
              userId: userId,
              nodeId: childNode._id,
              action: "editStatus",
              statusEdited: status,
              nodeVersion: targetChildVersionIndex,
            });
          } catch (error) {
            console.log({
              userId: userId,
              nodeId: childNode._id,
              action: "editStatus",
              statusEdited: status,
              nodeVersion: childNode.versions[targetChildVersionIndex].prestige,
            });
            return res.status(500).json({
              success: false,
              message: "Error logging contribution",
              error: error.message,
            });
          }
          await updateNodeStatusRecursively(childNode, status, version, userId); // Recursive call for child node
        } else {
          console.log(`Version not found for child node ${childNode._id}`);
        }
      }
    }
  }
}

function handleSchedule(nodeVersion) {
  // Check if the node is floating or has a set date
  if (nodeVersion.schedule === null) {
    // Floating schedule, no change needed
    return nodeVersion.schedule;
  } else {
    // If schedule is set, update it with the reeffect time in hours
    const currentSchedule = new Date(nodeVersion.schedule);
    const updatedSchedule = new Date(
      currentSchedule.getTime() + nodeVersion.reeffectTime * 60 * 60 * 1000
    );
    return updatedSchedule.toISOString();
  }
}

app.post("/update-schedule", authenticate, async (req, res) => {
  const { nodeId, versionIndex, newSchedule, reeffectTime } = req.body;
  const userId = req.userId;
  // Validate inputs
  if (
    !nodeId ||
    versionIndex === undefined ||
    !newSchedule ||
    reeffectTime === undefined
  ) {
    return res
      .status(400)
      .json({
        message:
          "nodeId, versionIndex, newSchedule, and reEffectTime are required.",
      });
  }

  if (reeffectTime > 1000000) {
    return res
      .status(400)
      .json({ message: "reeffect time must be below 1,000,000 hrs" });
  }
  try {
    // Find the node by ID
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ message: "Node not found." });
    }

    // Validate version index
    if (versionIndex < 0 || versionIndex >= node.versions.length) {
      return res.status(400).json({ message: "Invalid version index." });
    }

    let formattedDate = new Date(newSchedule);;
    // Update the schedule and reEffectTime for the specified version
    node.versions[versionIndex].schedule = formattedDate;
    node.versions[versionIndex].reeffectTime = reeffectTime;

    // Save the updated node
    await node.save();

   
    const scheduleEdited = {
        date: formattedDate,
        
        reeffectTime: reeffectTime,
        }
 

    await logContribution({
      userId: userId,
      nodeId: nodeId,
      action: "editSchedule",
      nodeVersion: versionIndex, // Index of the version with prestige
      scheduleEdited: scheduleEdited,
    });
    return res
      .status(200)
      .json({
        message: "Schedule and re-effect time updated successfully.",
        node,
      });
  } catch (error) {
    console.error("Error updating schedule:", error);
    return res
      .status(500)
      .json({ message: "Server error, could not update schedule." });
  }
});

async function addPrestige(node) {
  const currentVersion = node.versions.find(
    (v) => v.prestige === node.prestige
  );

  if (!currentVersion) {
    console.error("No version found for the current prestige level.");
    return;
  }

  currentVersion.status = "completed";

  // Ensure currentVersion.values is a Map, or convert it if it's an object
  const valuesMap =
    currentVersion.values instanceof Map
      ? currentVersion.values
      : new Map(Object.entries(currentVersion.values));

  const newValues = new Map(); // Create a Map for new version's values

  // Update globalValues and reset newValues
  for (const [key, value] of valuesMap) {
    node.globalValues[key] = (node.globalValues[key] || 0) + value;
    newValues.set(key, 0); // Reset the value to 0 for the new version
  }

  const newVersion = {
    prestige: node.prestige + 1,
    values: newValues, // Store as Map
    status: "active",
    dateCreated: new Date().toISOString(),
    schedule: handleSchedule(currentVersion), // Update schedule or keep floating
    reeffectTime: currentVersion.reeffectTime, // Inherit from previous version
  };

  node.prestige++;
  node.versions.push(newVersion);

  await node
    .save()
    .then()
    .catch((err) => console.error("Error saving node:", err));

  
}

app.post("/add-prestige", authenticate, async (req, res) => {
  const { nodeId } = req.body;
  const userId  = req.userId; // Assuming req.userId exists and contains userId


  try {
    const node = await findNodeById(nodeId);

    if (node) {
      // Assume `node.versions` is an array containing version information
      const targetNodeIndex = node.prestige;

    

      await addPrestige(node);
     
      await logContribution({
        userId: userId,
        nodeId: nodeId,
        action: "prestige",
        nodeVersion: targetNodeIndex, // Index of the version with prestige
      });

      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, message: "Node not found" });
    }
  } catch (error) {
    console.error("Error processing prestige:", error);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
});


async function tradeValuesBetweenNodes(
  nodeAId,
  versionAIndex,
  valuesA,
  nodeBId,
  versionBIndex,
  valuesB
) {
  const Node = mongoose.model("Node");
  const Transaction = mongoose.model("Transaction");

  // Fetch nodes
  const nodeA = await Node.findById(nodeAId);
  const nodeB = await Node.findById(nodeBId);

  if (!nodeA || !nodeB) {
    throw new Error(`One or both nodes not found.`);
  }

  // Ensure versions exist
  const versionA = nodeA.versions[versionAIndex];
  const versionB = nodeB.versions[versionBIndex];

  if (!versionA || !versionB) {
    throw new Error(`One or both versions not found.`);
  }

  // Perform trade
  for (const [key, value] of Object.entries(valuesA)) {
    if ((versionA.values.get(key) || 0) < value) {
      throw new Error(
        `Node A's version ${versionAIndex} has insufficient ${key}.`
      );
    }
    versionA.values.set(key, (versionA.values.get(key) || 0) - value);
    versionB.values.set(key, (versionB.values.get(key) || 0) + value);
  }

  for (const [key, value] of Object.entries(valuesB)) {
    if ((versionB.values.get(key) || 0) < value) {
      throw new Error(
        `Node B's version ${versionBIndex} has insufficient ${key}.`
      );
    }
    versionB.values.set(key, (versionB.values.get(key) || 0) - value);
    versionA.values.set(key, (versionA.values.get(key) || 0) + value);
  }

  // Save the nodes
  await nodeA.save();
  await nodeB.save();

  // Log the transaction
  const transaction = new Transaction({
    nodeAId: nodeAId,
    nodeBId: nodeBId,
    versionAIndex: versionAIndex,
    versionBIndex: versionBIndex,
    valuesTraded: {
      nodeA: valuesA,
      nodeB: valuesB,
    },
  });

  await transaction.save();

}

// Trade values between two nodes
app.post("/trade-values", async (req, res) => {
  const { nodeAId, versionAIndex, valuesA, nodeBId, versionBIndex, valuesB } =
    req.body;

  if (
    nodeAId === undefined ||
    versionAIndex === undefined ||
    valuesA === undefined ||
    nodeBId === undefined ||
    versionBIndex === undefined ||
    valuesB === undefined
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid request body. Ensure all required fields are provided.",
    });
  }

  try {
    await tradeValuesBetweenNodes(
      nodeAId,
      versionAIndex,
      valuesA,
      nodeBId,
      versionBIndex,
      valuesB
    );
    res.json({ success: true, message: "Trade completed successfully." });
  } catch (error) {
    console.error("Error during trade:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/delete-node", async (req, res) => {
  const { nodeId } = req.body; // Get the node ID from the URL

  try {
    const nodeToDelete = await Node.findById(nodeId);

    if (!nodeToDelete) {
      return res
        .status(404)
        .json({ success: false, message: "Node not found" });
    }

    // Delete the node from the database
    await Node.findByIdAndDelete(nodeId);

    res.json({ success: true, message: "Node deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
});

/*Notes Management*/
// Folder to store uploaded files
const uploadsFolder = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsFolder)) {
  fs.mkdirSync(uploadsFolder);
}

// Generate a unique ID for file names
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsFolder);
  },
  filename: (req, file, cb) => {
    const uniqueId = generateId();
    const extension = path.extname(file.originalname);
    const fileName = `${uniqueId}${extension}`;
    cb(null, fileName);
  },
});

const upload = multer({ storage });

app.post(
  "/create-Note",
  authenticate,
  upload.single("file"),
  async (req, res) => {
 
    try {
      const { contentType, content, userId, nodeId, version, isReflection } =
        req.body;

      // Validation
      if (!contentType || !["file", "text"].includes(contentType)) {
        return res.status(400).json({ message: "Invalid content type" });
      }
      if (!userId || !nodeId) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      let filePath = null;

      if (contentType === "file") {
        // Ensure file is uploaded
        if (!req.file) {
          return res
            .status(400)
            .json({ message: "File is required for file content type" });
        }
        filePath = req.file.filename; // Save the file name (or path) to the database
      }

      // Convert isReflection to a boolean if it is sent as a string
      const isReflectionBool = isReflection === "true" || isReflection === true;

      // Create Note entry
      const newNote = new Note({
        contentType,
        content: contentType === "file" ? filePath : content,
        userId,
        nodeId,
        version,
        isReflection: isReflectionBool, // Save the boolean value
      });

      await newNote.save();
      res.status(201).json({
        message: "Note created successfully",
        Note: newNote,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error creating Note" });
    }
  }
);

// Example endpoint to serve uploaded files
app.get("/uploads/:fileName", (req, res) => {
  const filePath = path.join(uploadsFolder, req.params.fileName);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ message: "File not found" });
  }
});

// Endpoint to retrieve Notes for a specific Node, optionally filtered by version
app.post("/get-Notes", async (req, res) => {
  try {
    const { nodeId, version } = req.body;

    // Build query filter
    let query = { nodeId };

    if (version && version !== "all") {
      query.version = version; // Only fetch notes for the specific version if it's not "all"
    }

    // Find notes with the constructed query, populate the userId with username
    const notes = await Note.find(query)
      .populate("userId", "username") // Only populate the username field
      .populate("nodeId"); // Optionally populate the nodeId if needed

    if (!notes || notes.length === 0) {
      return res.status(404).json({ message: "No notes found for this node" });
    }

    // Map through the notes to send back only the username and other necessary data
    const notesWithUsername = notes.map((note) => {
      return {
        _id: note._id,
        contentType: note.contentType,
        content: note.content, // Could be filename for file content
        username: note.userId ? note.userId.username : null, // Attach username instead of userId
        nodeId: note.nodeId._id, // If nodeId needs to be included
        version: note.version,
        isReflection: note.isReflection,
        createdAt: note.createdAt,
      };
    });

    // Return the list of notes with the username included
    res.status(200).json({
      message: "Notes retrieved successfully",
      notes: notesWithUsername,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error retrieving notes" });
  }
});

/*INVITING*/

app.post("/invite", authenticate, async (req, res) => {
  const { userReceiving, isToBeOwner, isUninviting, rootId } = req.body;
  const userId = req.userId; // User ID of the person sending the invite

  try {
    const node = await Node.findById(rootId).populate("rootOwner contributors");
    if (!node)
      return res
        .status(404)
        .json({ status: 404, message: "Root node not found" });

    const invitingUser = await User.findById(userId);
    if (!invitingUser)
      return res
        .status(404)
        .json({ status: 404, message: "Inviting user not found" });

    let receivingUser = null;

    // Regular expression for validating UUID (v4)
    const isValidUUID = (id) =>
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        id
      );

    if (isValidUUID(userReceiving)) {
      receivingUser = await User.findById(userReceiving);
    }

    // If it's not a valid UUID, try to find by username
    if (!receivingUser) {
      receivingUser = await User.findOne({ username: userReceiving });
    }

    if (!receivingUser)
      return res
        .status(404)
        .json({ status: 404, message: "Receiving user not found" });

    if (!isUninviting && userId === receivingUser._id) {
      return res
        .status(400)
        .json({ status: 400, message: "You cannot invite yourself" });
    }

    // Log the invite for every action
    const invite = new Invite({
      userInviting: userId,
      userReceiving: receivingUser._id, // Use the user ID of the receiving user
      isToBeOwner,
      isUninviting,
      rootId,
      status: "pending", // Default status; will be updated below if action is immediate
    });

    const inviteAction = {
      receivingId: receivingUser._id}
    

   

    

    const isOwner = node.rootOwner._id.toString() === userId;

    // Contributor invitation which only owner can do
    if (!isToBeOwner && !isUninviting) {
      if (!isOwner) {
        return res.status(403).json({
          status: 403,
          message: "Only the current owner can invite a new contributor",
        });
      }
      inviteAction.action="invite"
    
      await logContribution({
        userId: userId,
        nodeId: node.id,
        action: "invite",
        inviteAction: inviteAction,
        nodeVersion: node.prestige, // Index of the version with prestige
      });
      await invite.save();
      return res.status(200).json({
        status: 200,
        message: "Contributor invite created and logged",
      });
    }

    // Ownership transfer
    if (isToBeOwner) {
      if (!isOwner) {
        return res.status(403).json({
          status: 403,
          message: "Only the current owner can invite a new owner",
        });
      }

      // Update ownership
      node.rootOwner = receivingUser._id;
      node.contributors = node.contributors.filter(
        (u) => u._id.toString() !== receivingUser._id
      );
      node.contributors.push(invitingUser);

      await node.save();

      // Log invite as accepted
      invite.status = "accepted";
      await invite.save();

      inviteAction.action="switchOwner"
    
      await logContribution({
        userId: userId,
        nodeId: node.id,
        action: "invite",
        inviteAction: inviteAction,
        nodeVersion: node.prestige, // Index of the version with prestige
      });

      return res.status(200).json({
        status: 200,
        message: "Ownership transferred and invite logged",
      });
    }

    // self-removal
    if (!isToBeOwner && isUninviting) {
      // Case 1: Owner tries to remove themselves but contributors exist
      if (
        isOwner &&
        receivingUser._id.toString() === userId &&
        node.contributors.length > 0
      ) {
        return res.status(400).json({
          status: 400,
          message: "Owner cannot remove themselves when contributors exist",
        });
      }

      // Case 2: Owner removes a contributor
      if (isOwner && receivingUser._id.toString() !== userId) {
        node.contributors = node.contributors.filter(
          (u) => u._id.toString() !== receivingUser._id
        );

        await node.save();

        invite.status = "accepted";
        await invite.save();

        await User.findByIdAndUpdate(receivingUser._id, {
          $pull: { roots: rootId }, // Remove rootId from the user's roots
        });
        inviteAction.action="removeContributor"
    
        await logContribution({
          userId: userId,
          nodeId: node.id,
          action: "invite",
          inviteAction: inviteAction,
          nodeVersion: node.prestige, // Index of the version with prestige
        });
        

        return res.status(200).json({
          status: 200,
          message: "Contributor removed by owner and invite logged",
        });
      }

      // Case 3: Owner removes themselves when there are no contributors
      if (
        isOwner &&
        receivingUser._id.toString() === userId &&
        node.contributors.length === 0
      ) {
        node.rootOwner = null; // Remove owner
        await node.save();

        await User.findByIdAndUpdate(userId, {
          $pull: { roots: rootId }, // Remove rootId from the user's roots
        });
        inviteAction.action="removeContributor"
    
        await logContribution({
          userId: userId,
          nodeId: node.id,
          action: "invite",
          inviteAction: inviteAction,
          nodeVersion: node.prestige, // Index of the version with prestige
        });
        return res.status(200).json({
          status: 200,
          message: "Owner removed themselves and root ownership cleared",
        });
      }

      // Case 4: Contributor removes themselves
      if (!isOwner && receivingUser._id.toString() === userId) {
        // Check if the user is in the contributors array
        const isContributor = node.contributors.some(
          (u) => u._id.toString() === userId
        );

        if (!isContributor) {
          return res.status(400).json({
            status: 400,
            message: "You are not a contributor and cannot remove yourself.",
          });
        }
        node.contributors = node.contributors.filter(
          (u) => u._id.toString() !== userId
        );

        await node.save();

        invite.status = "accepted";
        await invite.save();

        await User.findByIdAndUpdate(userId, {
          $pull: { roots: rootId }, // Remove rootId from the user's roots
        });
        inviteAction.action="removeContributor"
    
        await logContribution({
          userId: userId,
          nodeId: node.id,
          action: "invite",
          inviteAction: inviteAction,
          nodeVersion: node.prestige, // Index of the version with prestige
        });
        return res.status(200).json({
          status: 200,
          message: "Contributor removed themselves and invite logged",
        });
      }

      // Case 5: Invalid request
      return res.status(400).json({
        status: 400,
        message: "Invalid uninviting request",
      });
    }

    res.status(400).json({ status: 400, message: "Invalid invite operation" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 500, message: "Server error" });
  }
});

app.post("/invite/accept", authenticate, async (req, res) => {
  const { inviteId, acceptInvite } = req.body;
  const userReceiving = req.userId;
  const inviteAction = {
    receivingId: userReceiving}
  

  try {
    // Find the invite by ID
    const invite = await Invite.findById(inviteId);

    if (!invite) return res.status(404).send("Invite not found");

    // Ensure the invite is for the correct user
    if (invite.userReceiving.toString() !== userReceiving)
      return res.status(403).send("This invite is not for the specified user");

    // Find the node associated with the invite
    const node = await Node.findById(invite.rootId).populate(
      "rootOwner contributors"
    );
    if (!node) return res.status(404).send("Node not found");

    // If accepting the invite
    if (acceptInvite) {
      // Add the user as a contributor to the node
      node.contributors.push(userReceiving);
      await node.save();

      // Update the user's roots field
      await User.findByIdAndUpdate(userReceiving, {
        $addToSet: { roots: invite.rootId }, // Add the rootId to the user's roots
      });

      // Update the invite status to 'accepted'
      invite.status = "accepted";
      await invite.save();
      inviteAction.action="acceptInvite"

      await logContribution({
        userId: userReceiving,
        nodeId: node.id,
        action: "invite",
        inviteAction: inviteAction,
        nodeVersion: node.prestige, // Index of the version with prestige
      });
      // Return a JSON response with success
      return res.status(200).json({
        success: true,
        message:
          "Invite accepted, user added as contributor, and roots updated",
      });
    }

    // If declining the invite
    else {
      // Update the invite status to 'declined'
      invite.status = "declined";
      await invite.save();
      inviteAction.action="denyInvite"
    
      await logContribution({
        userId: userReceiving,
        nodeId: node.id,
        action: "invite",
        inviteAction: inviteAction,
        nodeVersion: node.prestige, // Index of the version with prestige
      });

      // Return a JSON response with success
      return res.status(200).json({
        success: true,
        message: "Invite declined",
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// Endpoint to get all pending invites for a user
app.post("/pending-invites", authenticate, async (req, res) => {
  const userId = req.userId; // Expect userId to be sent in the request body

  if (!userId) {
    return res.status(400).json({ message: "User ID is required" });
  }

  try {
    // Fetch all pending invites where the user is either the inviter or the receiver
    const pendingInvites = await Invite.find({
      userReceiving: userId,
      status: "pending",
    })
      .populate("userInviting", "username")
      .populate("rootId", "name"); // Populate the username field for userReceiving

    // Return the found invites
    return res.status(200).json({ invites: pendingInvites });
  } catch (error) {
    console.error("Error fetching pending invites:", error);
    return res
      .status(500)
      .json({ message: "Server error, could not fetch pending invites" });
  }
});

// Start the HTTP server
https.createServer(credentials, app).listen(port, host, () => {
  console.log(`Tree app server running at https://${host}:${port}`);
});
