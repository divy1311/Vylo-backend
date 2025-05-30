const express  = require('express');
const axios    = require('axios');
const Together = require('together-ai');
const { randomUUID } = require('crypto');
const router   = express.Router();
const requireAuth = require('../middlewares/requireAuth');

const SYSTEM_PROMPT = require('../prompts/deepseekClassifierPrompt');
const VISION_URL = `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_KEY}`;
const together = new Together({ apiKey: process.env.TOGETHER_API_KEY });

// Apply requireAuth to all routes in this router
router.use(requireAuth);

/**
 * Extracts text from Google Vision API response.
 * @param {object} data - The response data from Google Vision API.
 * @returns {string} The extracted text or empty string.
 */
function extractTextFromVisionResponse(data) {
  return data.responses?.[0]?.fullTextAnnotation?.text
      || data.responses?.[0]?.textAnnotations?.[0]?.description
      || '';
}

/**
 * Sends an OCR request to Google Vision API and returns extracted text.
 * @param {string} image_b64 - Base64 encoded image.
 * @returns {Promise<string>} The extracted text.
 */
async function getTextFromImage(image_b64) {
  const payload = {
    requests: [{
      image: { content: image_b64 },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
    }]
  };
  const { data } = await axios.post(VISION_URL, payload);
  return extractTextFromVisionResponse(data);
}

/**
 * Extracts and parses the first JSON object found in a string.
 * @param {string} content - The string to search for JSON.
 * @returns {object} The parsed JSON object.
 * @throws {Error} If no valid JSON is found.
 */
function extractAndParseJson(content) {
  const jsonMatch = content.match(/{[\s\S]*}/);
  if (!jsonMatch) throw new Error('No JSON found in LLM response');
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Invalid JSON from LLM');
  }
}

/* POST /parse  – Google Vision */
router.post('/parse', async (req, res) => {
  try {
    const { image_b64 } = req.body;
    if (!image_b64) return res.status(400).json({ error: 'image_b64 missing' });
    const text = await getTextFromImage(image_b64);
    res.json({ text });
  } catch (err) {
    console.error(err.response?.data || err);
    res.status(500).json({ error: 'OCR failed' });
  }
});

/* POST /classify  – DeepSeek-R1 via Together */
router.post('/classify', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text missing' });

    console.log('Classifying text:', text + '...' + SYSTEM_PROMPT);

    const completion = await together.chat.completions.create({
      model: 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free',
      temperature: 0,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: text }
      ]
    });
    const content = completion.choices[0].message.content;
    let json;
    try {
      json = extractAndParseJson(content);
    } catch (e) {
      return res.status(500).json({ error: e.message, raw: content });
    }
    if (!json || typeof json !== 'object') {
      return res.status(500).json({ error: 'invalid response from LLM' });
    }

    // Generate unique IDs for each entry
    if (Array.isArray(json.entries)) {
      json.entries = json.entries.map(entry => ({
        ...entry,
        id: randomUUID()
      }));
    }

    res.json(json);
  } catch (err) {
    console.error(err.response?.data || err);
    res.status(500).json({ error: 'LLM classify failed' });
  }
});

module.exports = router;
