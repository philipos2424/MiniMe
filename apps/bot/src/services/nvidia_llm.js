const axios = require('axios');

/**
 * NVIDIA LLM Service for minime
 * Specifically configured for google/gemma-4-31b-it with Thinking enabled.
 */
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

async function callNvidia(messages, options = {}) {
  const {
    temperature = 1,
    maxTokens = 16384,
    stream = false,
    enableThinking = true,
    topP = 0.95
  } = options;

  try {
    const response = await axios.post(
      NVIDIA_URL,
      {
        model: "google/gemma-4-31b-it",
        messages: messages,
        temperature: temperature,
        top_p: topP,
        max_tokens: maxTokens,
        stream: stream,
        chat_template_kwargs: {
          enable_thinking: enableThinking
        }
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.NVIDIA_API_KEY}`,
          "Accept": stream ? "text/event-stream" : "application/json",
          "Content-Type": "application/json"
        },
        timeout: 60000
      }
    );

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('[NvidiaLLMService Error]:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = { callNvidia };
