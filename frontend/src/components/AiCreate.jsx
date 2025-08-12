import React, { useState } from "react";
import AiTreeView from "./AiTreeView";

const jsonExample = JSON.stringify({
  "name": "Brush Teeth Routine",
  "schedule": "2024-12-01T07:00:00Z",
  "reeffectTime": 0,  // in hours
  "values": { "brushingTimeMinutes": 0 }, // Example key-value
  "goals": { "brushingTimeMinutes": 2 },  // Example key-value
  "children": []
}, null, 2); // Pretty-print JSON

const presentMoment = new Date().toISOString();


const AiCreate = ({ nodeSelected }) => {
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [planDescription, setPlanDescription] = useState("");
  const [depth, setDepth] = useState(50); // Default slider value
  const [treeBranch, setTreeBranch] = useState([]);
  const [explanation, setExplanation] = useState("");
  const [jsonObject, setJsonObject] = useState(null);
  const apiUrl = import.meta.env.VITE_API_URL;

  const fetchFromServer = async () => {
    setLoading(true);

    // Fetch the tree branch data before sending AI request
    await fetchTreeBranch();

    // Convert treeBranch into a JSON string before inserting it into the content field
    const treeBranchString = JSON.stringify(treeBranch);

    const payload = {
      messages: [
        {
          role: "user",
          content: `create branches off of this branch  ${treeBranchString}  to make this plan " ${planDescription} ". and Please output a strict JSON object with the same exact same keys and structure of object ${jsonExample}. each node name must be unique. make the branching intracy and planning from ${depth} out of 100 in detail. Ensure the response is in valid JSON format only (no additional text or explanation). Each node should have name, versions array (with just 1 object with needed keys: values (only number, name represents the value associated, and default to 0) and used to track a quantifiable number in node step (not required), goals(only numbers) used to track completetion of values and not required (but correspond to an already made value), schedule, reeffect time (in hrs)), children,. no adding keys to object, , and dont include the parent. only start with new branches, and not every object needs a schedule, and if it does have one give it reeffecttime in hours if it is repeated and also schedule from the current moment forward(${presentMoment}). you can have multiple children on one layer and split the goal/plan up as needed with detail level. do not have redundent steps, they should all be categorized and make sense from parent to child in order breaking steps into details. they can have more than one value, and every value doesnt need a goal but it is more ideal. keep reeffecttime set to null if it doesnt need to repeat. keep all time spent values in hrs and all money in usd $xx.xx`,
        },
      ],
      temperature: 1,
      max_tokens: 5000,
      top_p: 1,
      stop: null,
    };

    try {
      const serverResponse = await fetch(`${apiUrl}/AiResponse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await serverResponse.json();
      console.log(result);
      if (result.success && result.data) {
        const data = JSON.parse(result.data);

        if (Array.isArray(data.choices) && data.choices.length > 0) {
          const content = data.choices[0].message.content;

          // Split the explanation and JSON using regex
          const regex = /```json([\s\S]+?)```/;
          const match = regex.exec(content);

          if (match) {
            const explanationText = content.split(match[0])[0].trim(); // Text before JSON
            const jsonText = match[1].trim(); // JSON within the code block

            setExplanation(explanationText);

            try {
              setJsonObject(JSON.parse(jsonText)); // Parse JSON
            } catch (err) {
              console.error("Error parsing JSON:", err);
              setJsonObject("Invalid JSON");
            }
          } else {
            setExplanation(content);
            setJsonObject("No JSON object found.");
          }
        } else {
          console.error("No choices found in the response.");
          setResponse("Error: No choices found.");
        }
      } else {
        console.error("Invalid response format: result.data is undefined");
        setResponse("Error: Invalid response format.");
      }
    } catch (error) {
      console.error("Error:", error);
      setResponse("Error communicating with the server.");
    } finally {
      setLoading(false);
    }
  };

  const fetchTreeBranch = async () => {
    setLoading(true);
    setTreeBranch([]); // Clear previous treeBranch data

    try {
      const serverResponse = await fetch(`${apiUrl}/get-parents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ childId: nodeSelected._id }),
      });

      const result = await serverResponse.json();
      console.log(result);
      if (serverResponse.ok) {
        setTreeBranch(result); // Update treeBranch state with the result
      } else {
        console.error(result.message || "Error fetching tree branch.");
        setTreeBranch([]);
      }
    } catch (error) {
      console.error(error);
      setTreeBranch([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>AI Creation</h1>

      {/* Plan Description Input */}
      <div>
        <label htmlFor="plan-description">Plan Description:</label>
        <textarea
          id="plan-description"
          value={planDescription}
          onChange={(e) => setPlanDescription(e.target.value)}
          placeholder="Describe your plan..."
          rows="4"
          style={{ width: "100%" }}
        />
      </div>

      {/* Depth of Planning Slider */}
      <div>
        <label htmlFor="depth-slider">Depth of Planning: {depth}</label>
        <input
          id="depth-slider"
          type="range"
          min="1"
          max="100"
          value={depth}
          onChange={(e) => setDepth(e.target.value)}
        />
      </div>

      {/* AI Response Section */}
      <div>
        <h2>AI Response</h2>
        <button onClick={fetchFromServer} disabled={loading}>
          {loading ? "Loading..." : "Generate AI Response"}
        </button>

        {/* Show the AiTreeView only after loading is done */}
        {!loading && jsonObject && <AiTreeView jsonObject={jsonObject} nodeSelected={nodeSelected} fetchFromServer={fetchFromServer}/>}
      </div>
    </div>
  );
};

export default AiCreate;
