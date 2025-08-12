async function loadNodes() {
    const parentId = document.getElementById("parentId").value || "Root";
    const statusFilter = document.getElementById("statusFilter").value;

    try {
        const response = await fetch(`/get-tree`);
        const data = await response.json();

        const parentNode = findNodeById(data, parentId);
        if (!parentNode) {
            alert("Parent node not found!");
            return;
        }

        const descendants = collectAllDescendants(parentNode);

        const scheduledNodes = [];
        const floatingNodes = [];

        descendants.forEach(child => {
            const childVersion = child.versions[child.prestige];
            
            // Apply the status filter
            if (statusFilter !== "all" && childVersion.status !== statusFilter) {
                return; // Skip nodes that don't match the filter
            }

            if (childVersion.schedule) {
                scheduledNodes.push({
                    name: child.name,
                    schedule: new Date(childVersion.schedule)
                });
            } else {
                floatingNodes.push({
                    name: child.name,
                    dateCreated: new Date(childVersion.dateCreated)
                });
            }
        });

        scheduledNodes.sort((a, b) => a.schedule - b.schedule);
        floatingNodes.sort((a, b) => a.dateCreated - b.dateCreated);

        displayNodes(scheduledNodes, floatingNodes);
    } catch (error) {
        console.error("Error loading nodes:", error);
    }
}

function displayNodes(scheduledNodes, floatingNodes) {
    const scheduledList = document.getElementById("scheduledNodes");
    const floatingList = document.getElementById("floatingNodes");

    scheduledList.innerHTML = "";
    floatingList.innerHTML = "";

    scheduledNodes.forEach(node => {
        const listItem = document.createElement("li");
        listItem.textContent = `${node.name} - Scheduled for ${node.schedule.toDateString()}`;
        scheduledList.appendChild(listItem);
    });

    floatingNodes.forEach(node => {
        const listItem = document.createElement("li");
        listItem.textContent = `${node.name} - Created on ${node.dateCreated.toDateString()}`;
        floatingList.appendChild(listItem);
    });
}

// Helper functions remain the same
function findNodeById(node, nodeId) {
    if (node.id === nodeId) return node;
    for (let child of node.children) {
        const found = findNodeById(child, nodeId);
        if (found) return found;
    }
    return null;
}

function collectAllDescendants(node) {
    const descendants = [];
    function traverse(currentNode) {
        if (currentNode.children && currentNode.children.length > 0) {
            currentNode.children.forEach(child => {
                descendants.push(child);
                traverse(child); // Recursive call for deeper children
            });
        }
    }
    traverse(node); // Start the traversal from the given node
    return descendants;
}
