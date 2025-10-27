import Node from "../../db/models/node.js";
import { findNodeById, logContribution } from "../../db/utils.js";
import User from "../../db/models/user.js";
import { createNoteHelper } from "./notesHelper.js"


export async function createNewNode(
    name,
    schedule,
    reeffectTime,
    parentNodeID,
    isRoot = false,
    userId,
    values = {},
    goals = {},
    note = null
) {

    values = values && typeof values === "object" ? values : {};
    goals = goals && typeof goals === "object" ? goals : {};
    const newNode = new Node({
        name,
        prestige: 0,
        versions: [
            {
                prestige: 0,
                values,
                status: "active",
                dateCreated: new Date(),
                schedule: schedule ? new Date(schedule) : null,
                reeffectTime: reeffectTime || 0,
                goals,
            },
        ],
        children: [],
        parent: parentNodeID && parentNodeID !== null ? parentNodeID : null,
        rootOwner: isRoot ? userId : null,
        contributors: [],
    });

    await newNode.save();

    if (isRoot) {
        const user = await User.findById(userId);
        if (!user) throw new Error("User not found");
        user.roots.push(newNode._id);
        await user.save();
    } else if (parentNodeID) {
        const parentNode = await Node.findById(parentNodeID);
        if (!parentNode) throw new Error("Parent node not found");
        parentNode.children.push(newNode._id);
        await parentNode.save();
    }
    await logContribution({
        userId,
        nodeId: newNode._id,
        action: "create",
        nodeVersion: "0",
    });
    if (note && note.trim().length > 0) {
        await createNoteHelper({
            contentType: "text",
            content: note,
            userId,
            nodeId: newNode._id,
            version: 0,
            isReflection: false,
        });
    }

    return newNode;
}

export async function createNodesRecursive(nodeData, parentId, userId) {
    const {
        name,
        schedule,
        values,
        goals,
        children = [],
        reeffectTime,
        effectTime,
        note,
    } = nodeData;

    const timeToUse = reeffectTime ?? effectTime;

    // 1️⃣ Create this node and link it to the parent
    const newNode = await createNewNode(
        name,
        schedule,
        timeToUse,
        parentId,
        false,
        userId,
        values || {},
        goals || {},
        note || null
    );


    // 3️⃣ Recursively create all children
    const childIds = [];
    for (const childData of children) {
        const childId = await createNodesRecursive(childData, newNode._id, userId);
        childIds.push(childId);
    }





    // 6️⃣ Return this node’s id so parent can link it later
    return newNode._id;
}



export async function deleteNodeBranch(nodeId, userId) {
    const nodeToDelete = await Node.findById(nodeId);
    if (!nodeToDelete) throw new Error("Node not found");

    nodeToDelete.parent = "deleted";
    await nodeToDelete.save();

    const allNodes = await Node.find();
    for (const node of allNodes) {
        if (node.children && node.children.includes(nodeId)) {
            node.children = node.children.filter(
                (childId) => childId.toString() !== nodeId.toString()
            );
            await node.save();
        }
    }

    /*    await logContribution({
            userId,
            nodeId,
            action: "delete",
        });*/

    return nodeToDelete;
}

export async function updateParentRelationship(nodeChildId, nodeNewParentId, userId) {
    const nodeChild = await Node.findById(nodeChildId);
    if (!nodeChild) throw new Error("Child node not found");
    if (nodeChild.parent == null) throw new Error("Cannot change root's parent");

    const nodeNewParent = await Node.findById(nodeNewParentId);
    if (!nodeNewParent) throw new Error("New parent node not found");

    if (nodeChild.parent) {
        const oldParent = await Node.findById(nodeChild.parent);
        if (oldParent) {
            oldParent.children = oldParent.children.filter(
                (childId) => childId.toString() !== nodeChildId
            );
            await oldParent.save();
        }
    }

    nodeChild.parent = nodeNewParentId;
    await nodeChild.save();

    nodeNewParent.children.push(nodeChildId);
    await nodeNewParent.save();

    /*
        await logContribution({
            userId,
            nodeId: nodeChildId,
            action: "update-parent",
        });*/

    return { nodeChild, nodeNewParent };
}
