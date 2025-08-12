const getAiResponse = async (req, res) => {
  const { messages, model, temperature, max_tokens, top_p, stop } = req.body;

  const payload = {
    messages,
    model: model || "deepseek-r1-distill-llama-70b", // Default values
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
};

module.exports = {
  getAiResponse,
};
