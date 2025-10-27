import OpenAI from "openai/index.js";
import { z } from "zod";

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama",
});

const NodeSchema = z.object({
  name: z.string(),
  schedule: z.string().datetime().nullable(),
  reeffectTime: z.number().nullable(),
  values: z.record(z.number()).nullable(),
  goals: z.record(z.number()).nullable(),

  children: z.array(z.lazy(() => NodeSchema)).nullable(),
});

const extractJsonBlock = (text) => {
  const regex = /```json\s*([\s\S]+?)```/;
  const match = regex.exec(text);
  if (match) return match[1].trim();
  return text.trim(); // fallback to raw text
};

export const getAiResponse = async (req, res) => {
  const { treeBranchString, planDescription, depth, presentMoment } = req.body;

  if (!treeBranchString || !planDescription || !depth || !presentMoment) {
    return res.status(400).json({
      success: false,
      error:
        "Missing required fields: treeBranchString, planDescription, depth, presentMoment",
    });
  }

  const messages = [
    {
      role: "system",
      content: `
    You must understand the users request, and then generate
    a hierarchical nested node tree using the NodeSchema
    json structure to fulfill it:

    The json tree branch you generate will be placed onto an existing tree.
    Here is the parents data (to the root) from the current node to orient
    your generated json tree and gather context to help complete the users request.`,
    },
    {
      role: "system",
      content: `
      Previous nodes for context. You are building off of the deepest child that has
      no children in its array.
      Parent branches: ${treeBranchString}`,
    },
    {
      role: "user",
      content: `
    Request:
    ${planDescription}.
    
     
    `,
    },
    {
      role: "system",
      content: `
    Now use this NodeSchema JSON structure to generate the new tree branch:

    Quick rules for nodes:

    Schedule is only needed if a node requires timing,
    and if schedule =  null = reeffectTime.
    Present moment = $${presentMoment}



    Goals are linked to values and can not exist on their own.
    If a value has a goal, the keys must match.
    Typically, a value would be 0 if it has a goal.
    Create values carefully!

    Set the number of children and sub-children proportionally to ${depth}/100 to scale detail.

    const NodeSchema = z.object({
      name: z.string(),
      schedule: z.string().datetime().nullable(),
      reeffectTime: z.number(), //time in hrs ahead that schedule is set to once completed from current schedule 
      values: z.record(z.number()).nullable(),
      goals: z.record(z.number()).nullable(),

      children: z.array(z.lazy(() => NodeSchema)),
    });

  ONLY output a single JSON block wrapped in triple backticks with 'json'.`,
    },
  ];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-oss:20b",
      messages,
    });

    const rawContent = response.choices[0].message.content;
    console.log("Raw AI Response:", rawContent);

    const jsonString = extractJsonBlock(rawContent);
    console.log("Extracted JSON:", jsonString);

    try {
      const parsed = NodeSchema.parse(JSON.parse(jsonString));
      res.json({ success: true, data: parsed });
    } catch (parseError) {
      console.error(
        "JSON Parsing or Schema Validation Error:",
        parseError.message
      );
      res.status(500).json({
        success: false,
        error: "Failed to parse or validate JSON",
        rawContent,
        extractedContent: jsonString,
      });
    }
  } catch (error) {
    console.error("API Error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};
