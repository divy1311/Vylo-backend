/**
 * Chat service for intent extraction and response generation using Together AI
 */
const Together = require('together-ai');
const INTENT_PROMPT = require('../prompts/chatIntentPrompt');

// Initialize Together AI client
const together = new Together({ apiKey: process.env.TOGETHER_API_KEY });

/**
 * Extracts and parses the first JSON object found in a string.
 * @param {string} content - The string to search for JSON.
 * @returns {object} The parsed JSON object.
 * @throws {Error} If no valid JSON is found.
 */
function extractAndParseJson(content) {
  // Remove any <think> tags and their contents that might be in the LLM output
  const cleanedContent = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Look for JSON blocks with proper formatting
  const jsonRegexPatterns = [
    /```json\s*([\s\S]*?)\s*```/,  // Match ```json ... ``` blocks
    /```\s*([\s\S]*?)\s*```/,      // Match ``` ... ``` blocks (without json tag)
    /{[\s\S]*}/                    // Match any JSON object as fallback
  ];

  for (const pattern of jsonRegexPatterns) {
    const match = cleanedContent.match(pattern);
    if (match) {
      try {
        // For code blocks, use the captured group, otherwise use the full match
        const jsonContent = match[1] || match[0];
        return JSON.parse(jsonContent);
      } catch (e) {
        // Continue to next pattern if this one fails
      }
    }
  }

  throw new Error('No valid JSON found in LLM response');
}

/**
 * Removes thinking tags and their contents from text
 * @param {string} text - Text that may contain thinking tags
 * @returns {string} Cleaned text without thinking sections
 */
function cleanThinkingTags(text) {
  if (!text) return '';
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/**
 * Extracts intent from user message using Together AI
 * @param {string} message - User's message
 * @returns {Promise<object>} - Object containing array of intent data with parameters
 */
async function extractIntent(message) {
  try {
    const currentDate = new Date();
    const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    const currentYear = String(currentDate.getFullYear());

    // Add current date context to help with relative date references
    const contextMessage = `Today is ${currentDate.toISOString().split('T')[0]}. Current month is ${currentMonth}. Current year is ${currentYear}.
User message: ${message}`;

    const completion = await together.chat.completions.create({
      model: 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free',
      temperature: 0,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: INTENT_PROMPT + "\nIMPORTANT: Output JSON only. Do not include any explanation text or markdown code block markers." },
        { role: 'user', content: contextMessage }
      ]
    });

    const content = completion.choices[0].message.content;
    // We'll log this with less verbosity
    console.log('LLM intent response received');

    try {
      const parsedData = extractAndParseJson(content);

      // Check if the response follows the new format with intents array
      if (Array.isArray(parsedData.intents)) {
        return parsedData;
      }

      // Handle backward compatibility (for old format with single intent)
      if (parsedData.intent) {
        return {
          intents: [
            {
              intent: parsedData.intent,
              parameters: parsedData.parameters || {}
            }
          ],
          originalQuery: message
        };
      }

      // Handle empty or invalid response
      return {
        intents: [
          {
            intent: "unknown",
            parameters: {}
          }
        ],
        originalQuery: message
      };

    } catch (e) {
      console.error('JSON parsing failed:', e.message);

      // Try a more aggressive JSON extraction as fallback
      try {
        // Look for anything that remotely looks like JSON
        const possibleJson = content.match(/\{[\s\S]*?\}/g);
        if (possibleJson && possibleJson.length > 0) {
          for (const jsonCandidate of possibleJson) {
            try {
              const parsed = JSON.parse(jsonCandidate);
              console.log('Fallback JSON extraction succeeded');

              // Check if the JSON has the expected structure
              if (parsed.intents) {
                return parsed;
              } else if (parsed.intent) {
                return {
                  intents: [
                    {
                      intent: parsed.intent,
                      parameters: parsed.parameters || {}
                    }
                  ],
                  originalQuery: message
                };
              }
            } catch (innerError) {
              // Continue trying other candidates
            }
          }
        }
      } catch (fallbackError) {
        // If all extraction attempts fail, continue to the default fallback
      }

      // Fallback to unknown intent
      return {
        intents: [
          {
            intent: "unknown",
            parameters: {}
          }
        ],
        originalQuery: message
      };
    }
  } catch (error) {
    console.error("Intent extraction failed:", error);
    // Provide a fallback intent for error cases
    return {
      intents: [
        {
          intent: "unknown",
          parameters: {}
        }
      ],
      error: error.message,
      originalQuery: message
    };
  }
}

/**
 * Generates a natural language response based on multiple data sources using Together AI
 * @param {string} userMessage - Original user message
 * @param {Array} results - Array of data objects retrieved from APIs
 * @returns {Promise<string>} - Natural language response
 */
async function generateMultiResponse(userMessage, results) {
  try {
    const prompt = `
Given the user asked: "${userMessage}"

And the system retrieved this data from multiple sources:
${results.map((item, index) => `
SOURCE ${index + 1}: ${JSON.stringify(item.data, null, 2)}
FROM API: ${item.intent.intent} with parameters: ${JSON.stringify(item.intent.parameters)}
`).join("\n")}

Generate a concise, helpful reply that addresses ALL parts of the user's question.
Focus on answering the question directly with relevant numbers and context.
If there are multiple data points, organize them clearly in your response.
If any part has an error or no data, politely explain what went wrong.
DO NOT include any <think> tags or internal reasoning in your response.
`;

    const completion = await together.chat.completions.create({
      model: 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free',
      temperature: 0.7,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: "You are a helpful personal finance assistant." },
        { role: 'user', content: prompt }
      ]
    });

    return cleanThinkingTags(completion.choices[0].message.content.trim());
  } catch (error) {
    console.error("Multi-response generation failed:", error);
    return "I'm sorry, I couldn't process that information right now.";
  }
}

/**
 * Generates a natural language response based on the data using Together AI
 * @param {string} userMessage - Original user message
 * @param {object} data - Data retrieved from API
 * @returns {Promise<string>} - Natural language response
 */
async function generateResponse(userMessage, data) {
  try {
    const prompt = `
Given the user asked: "${userMessage}"

And the system retrieved this data: ${JSON.stringify(data, null, 2)}

Generate a concise, helpful reply (1-2 sentences maximum).
Focus on answering the question directly with relevant numbers and context.
If there's an error or no data, politely explain what went wrong.
DO NOT include any <think> tags or internal reasoning in your response.
`;

    const completion = await together.chat.completions.create({
      model: 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free',
      temperature: 0.7,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: "You are a helpful personal finance assistant." },
        { role: 'user', content: prompt }
      ]
    });

    return cleanThinkingTags(completion.choices[0].message.content.trim());
  } catch (error) {
    console.error("Response generation failed:", error);
    return "I'm sorry, I couldn't process that information right now.";
  }
}

module.exports = {
  extractIntent,
  generateResponse,
  generateMultiResponse
};
