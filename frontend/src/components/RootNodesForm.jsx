import React, { useState, useEffect } from 'react';
import Cookies from 'js-cookie';

const RootNodesForm = ({ setRootSelected, rootSelected, rootNodes, setRootNodes, userId }) => {
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('');
  const [reeffectTime, setReeffectTime] = useState('');
  const [nodeDetails, setNodeDetails] = useState(null); // Holds rootOwner and contributors
  const [username, setUsername] = useState('');
  const [responseMessage, setResponseMessage] = useState(''); // State to hold the response message
  const [loading, setLoading] = useState(false); // Loading state for async operations
  const token = Cookies.get('token');
  const apiUrl = import.meta.env.VITE_API_URL;
  // Helper function to handle errors and display messages
  const handleError = (error, actionType) => {
    setResponseMessage(`Error during ${actionType}: ${error.message || error}`);
  };

  // Fetch root node details
  const fetchNodeDetails = async (nodeId) => {
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/get-root-details`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: nodeId }),
        credentials: 'include',
      });
      const data = await response.json();

      if (response.ok) {
        setNodeDetails(data);
      } else {
        setResponseMessage(`Failed to fetch node details: ${data.message}`);
      }
    } catch (error) {
      handleError(error, 'fetching node details');
    } finally {
      setLoading(false);
    }
  };

  // Fetch root node id's for user
  useEffect(() => {
    if (!token) return;

    const fetchRootNodes = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${apiUrl}/get-root-nodes`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
        });
        const data = await response.json();

        if (response.ok) {
          if (Array.isArray(data.roots)) {
            setRootNodes(data.roots);
          }
        } else {
          setResponseMessage(`Failed to fetch root nodes: ${data.message}`);
        }
      } catch (error) {
        handleError(error, 'fetching root nodes');
      } finally {
        setLoading(false);
      }
    };

    fetchRootNodes();
  }, [token, setRootNodes]);

  useEffect(() => {
    if (rootSelected) {
      fetchNodeDetails(rootSelected);
    }
  }, [rootSelected]);

  // Common invite handler
  const handleInviteAction = async (actionType, payload) => {
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        credentials: 'include',
      });

      const data = await response.json();

      if (response.ok) {
        setResponseMessage(data.message || 'Action completed successfully');
        fetchNodeDetails(rootSelected); // Refresh details
        if (actionType === 'invite') setUsername(''); // Clear username input after invite
      } else {
        setResponseMessage(`Failed to ${actionType}: ${data.message}`);
      }
    } catch (error) {
      handleError(error, actionType);
    } finally {
      setLoading(false);
    }
  };

  // Handle inviting a contributor
  const handleInvite = () => {
    if (nodeDetails) {
      handleInviteAction('invite', {
        userReceiving: username,
        isToBeOwner: false,
        isUninviting: false,
        rootId: rootSelected,
      });
    }
  };

  // Handle removing a contributor
  const handleRemove = (contributorId) => {
    if (nodeDetails) {
      handleInviteAction('remove', {
        userReceiving: contributorId,
        isToBeOwner: false,
        isUninviting: true,
        rootId: rootSelected,
      });
    }
  };

  // Handle transferring ownership
  const handleTransferOwnership = (newOwnerId) => {
    if (nodeDetails) {
      handleInviteAction('transfer-ownership', {
        userReceiving: newOwnerId,
        isToBeOwner: true,
        isUninviting: false,
        rootId: rootSelected,
      });
    }
  };

  const handleLeave = () => {
    if (nodeDetails) {
      const isOwner = nodeDetails.rootOwner._id === userId;
  
      // If the current user is the owner
      if (isOwner) {
        // Show alert for owners with contributors
        if (nodeDetails.contributors.length > 0) {
          alert('Your tree has contributors. Please assign a new owner before leaving.');
        } else {
          // Proceed to leave if no contributors
          handleInviteAction('leave', {
            userReceiving: userId,
            isToBeOwner: false,
            isUninviting: true,
            rootId: rootSelected,
          }).then(() => {
            // Remove the node from the root nodes list after leaving
            setRootNodes((prev) => prev.filter((rootNode) => rootNode !== rootSelected));
            setRootSelected(null); // Reset the selected root node
            setNodeDetails(null);  // Clear the root node details
          });
        }
      } else {
        // If the current user is not the owner, just leave
        handleInviteAction('leave', {
          userReceiving: userId,
          isToBeOwner: false,
          isUninviting: true,
          rootId: rootSelected,
        }).then(() => {
          // Remove the node from the root nodes list after leaving
          setRootNodes((prev) => prev.filter((rootNode) => rootNode !== rootSelected));
          setRootSelected(null); // Reset the selected root node
          setNodeDetails(null);  // Clear the root node details
        });
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
  
    if (!token) {
      setResponseMessage('No JWT token found!');
      return;
    }
  
    const parentIdValue = null;
    setLoading(true);
  
    try {
      const response = await fetch(`${apiUrl}/add-node`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          parentId: parentIdValue,
          name,
          schedule,
          reeffectTime,
          isRoot: true,
        }),
        credentials: 'include',
      });
      const data = await response.json();
  
      if (!response.ok) {
        setResponseMessage(`Error creating node: ${data.message}`);
        throw new Error('Failed to create node');
      }
  
      setResponseMessage('Node created successfully!');
      setRootNodes((prev) => [...prev, data.newNode._id]);
      setRootSelected(data.newNode._id); // Sync with App
  
      // Fetch details of the newly created node
      await fetchNodeDetails(data.newNode._id);
  
      setName('');
      setSchedule('');
      setReeffectTime('');
    } catch (error) {
      setResponseMessage(`Error creating node: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };
  

  return (
    <div className='rootNodeForm'>
      <div>
        <h3>Existing Root Nodes</h3>
        <select
          value={rootSelected || ''}
          onChange={(e) => setRootSelected(e.target.value)}
          style={{ width: '100%', padding: '8px' }}
        >
          <option value="" disabled>Select a root node</option>
          {rootNodes.map((rootNode) => (
            <option key={rootNode} value={rootNode}>
              {rootNode}
            </option>
          ))}
        </select>
      </div>
      <div>
        <h3>Create a New Root Node</h3>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Enter root node name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Creating...' : 'Create Root Node'}
          </button>
        </form>
      </div>

      {nodeDetails && (
        <div>
          <h3>Selected Root Details</h3>
          <p>Root Owner: {nodeDetails.rootOwner.username}</p>

          <h4>Contributors:</h4>
          <ul>
            {nodeDetails.contributors.map((contributor) => (
              <li key={contributor._id}>
                {contributor.username}{' '}
                {nodeDetails.rootOwner._id === userId && (
                  <>
                    <button onClick={() => handleRemove(contributor._id)}>Remove</button>
                    <button onClick={() => handleTransferOwnership(contributor._id)}>Transfer Ownership</button>
                  </>
                )}
              </li>
            ))}
          </ul>

          {nodeDetails.rootOwner._id === userId ? (
            <>
              <h4>Invite Contributor</h4>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
              />
              <button onClick={handleInvite}>Invite</button>
              {responseMessage && <div>{responseMessage}</div>}
              <button onClick={handleLeave}>Leave Node</button>
            </>
          ) : (
            <button onClick={handleLeave}>Leave Node</button>
          )}
        </div>
      )}

      
    </div>
  );
};

export default RootNodesForm;
