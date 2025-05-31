/**
 * /api/v1/chat – Conversational interface to personal finance data
 */
const express = require('express');
const axios = require('axios');
const router = express.Router();
const { extractIntent, generateResponse, generateMultiResponse } = require('../services/chatService');

// POST / - Handle chat messages
router.post('/', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    console.log(`Chat request received: "${message}"`);

    // 1. Extract intent(s) using LLM
    const intentData = await extractIntent(message);
    console.log(`Extracted ${intentData.intents.length} intent(s)`);

    // Check if we have any valid intents
    if (intentData.intents.length === 0 ||
        (intentData.intents.length === 1 && intentData.intents[0].intent === "unknown")) {
      return res.status(400).json({
        error: 'No valid intent could be determined from your question',
        reply: "I don't understand that question. You can ask me about your own financial data, such as 'What did I spend on groceries last month?', 'How much is my budget for this month?', or 'Show me my savings for this year.'"
      });
    }

    // 2. Call appropriate API endpoints based on intent(s)
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const results = [];
    const authHeader = { Authorization: req.headers.authorization };

    // Process all intents in parallel
    try {
      await Promise.all(intentData.intents.map(async (intent) => {
        try {
          let responseData;

          switch (intent.intent) {
            case 'getSpending': {
              const { category, month } = intent.parameters;
              // Enhanced handling of getSpending without category parameter
              // If no category is provided, we'll get all entries for that month
              responseData = await axios.get(`${baseUrl}/api/v1/entries`, {
                params: {
                  category: category || undefined, // Only include if defined
                  month
                },
                headers: authHeader
              });
              break;
            }

            case 'getBudget': {
              const { month } = intent.parameters;
              responseData = await axios.get(`${baseUrl}/api/v1/budgets/${month}`, {
                headers: authHeader
              });
              break;
            }

            case 'getRemainingBudget': {
              const { month } = intent.parameters;
              responseData = await axios.get(`${baseUrl}/api/v1/budgets/${month}/remaining`, {
                headers: authHeader
              });
              break;
            }

            case 'getSavings': {
              const { month } = intent.parameters;
              responseData = await axios.get(`${baseUrl}/api/v1/savings/${month}/monthly`, {
                headers: authHeader
              });
              break;
            }

            case 'getYearlySavings': {
              const { year } = intent.parameters;
              responseData = await axios.get(`${baseUrl}/api/v1/savings/${year}/yearly`, {
                headers: authHeader
              });
              break;
            }

            case 'getSavingsSummary': {
              const { year } = intent.parameters;
              responseData = await axios.get(`${baseUrl}/api/v1/savings/summary/${year}`, {
                headers: authHeader
              });
              break;
            }

            case 'getIncome': {
              const { month } = intent.parameters;
              responseData = await axios.get(`${baseUrl}/api/v1/income/${month}`, {
                headers: authHeader
              });
              break;
            }

            case 'getAllIncome': {
              responseData = await axios.get(`${baseUrl}/api/v1/income`, {
                headers: authHeader
              });
              break;
            }

            case 'getAllBudgets': {
              responseData = await axios.get(`${baseUrl}/api/v1/budgets`, {
                headers: authHeader
              });
              break;
            }

            case 'addEntries': {
              const { date, entries } = intent.parameters;
              responseData = await axios.post(
                `${baseUrl}/api/v1/entries/add-user-entries`,
                { date, entries },
                { headers: authHeader }
              );
              break;
            }

            case 'createBudget': {
              const { month, total, categories } = intent.parameters;
              responseData = await axios.post(
                `${baseUrl}/api/v1/budgets`,
                { month, total, categories },
                { headers: authHeader }
              );
              break;
            }

            case 'setIncome': {
              const { month, total, sources } = intent.parameters;
              responseData = await axios.post(
                `${baseUrl}/api/v1/income`,
                { month, total, sources },
                { headers: authHeader }
              );
              break;
            }

            case 'updateIncome': {
              const { month, total, sources } = intent.parameters;
              const payload = {};
              if (total !== undefined) payload.total = total;
              if (sources !== undefined) payload.sources = sources;

              responseData = await axios.put(
                `${baseUrl}/api/v1/income/${month}`,
                payload,
                { headers: authHeader }
              );
              break;
            }

            case 'deleteIncome': {
              const { month } = intent.parameters;
              responseData = await axios.delete(
                `${baseUrl}/api/v1/income/${month}`,
                { headers: authHeader }
              );
              break;
            }

            case 'reassignBudget': {
              const { month, entryId, fromCategory, toCategory, amount } = intent.parameters;
              responseData = await axios.post(
                `${baseUrl}/api/v1/budgets/${month}/reassign`,
                { entryId, fromCategory, toCategory, amount },
                { headers: authHeader }
              );
              break;
            }

            case 'deleteBudget': {
              const { month } = intent.parameters;
              responseData = await axios.delete(
                `${baseUrl}/api/v1/budgets/${month}`,
                { headers: authHeader }
              );
              break;
            }

            case 'deleteEntries': {
              const { date } = intent.parameters;
              responseData = await axios.delete(
                `${baseUrl}/api/v1/entries/${date}`,
                { headers: authHeader }
              );
              break;
            }

            case 'deleteEntry': {
              const { date, entryId } = intent.parameters;
              responseData = await axios.delete(
                `${baseUrl}/api/v1/entries/${date}/${entryId}`,
                { headers: authHeader }
              );
              break;
            }

            default:
              throw new Error('Unsupported intent');
          }

          results.push({
            intent,
            data: responseData.data,
            success: true
          });

        } catch (error) {
          results.push({
            intent,
            data: { error: true, message: error.message },
            success: false
          });
        }
      }));

      // 3. Generate natural language response based on all results
      let reply;
      let combinedData = {};

      if (results.length === 1) {
        // If there's only one intent, use the simpler response generator
        reply = await generateResponse(message, results[0].data);
        combinedData = results[0].data;
      } else {
        // If there are multiple intents, use the multi-response generator
        reply = await generateMultiResponse(message, results);
        // Combine all data for the response
        results.forEach((result, index) => {
          combinedData[`result${index + 1}`] = {
            intent: result.intent.intent,
            data: result.data
          };
        });
      }

      res.json({
        reply,
        intents: intentData.intents,
        data: combinedData
      });

    } catch (apiError) {
      console.error('API calls failed:', apiError.message);

      // Generate a friendly error response
      const errorReply = await generateResponse(
        message,
        { error: true, message: apiError.message }
      );

      // Return 400 for API errors as the question was understood but we couldn't fulfill it
      res.status(400).json({
        reply: errorReply || "I couldn't find that information. Can you try again?",
        error: apiError.message,
        intents: intentData.intents
      });
    }
  } catch (err) {
    console.error('Chat processing failed:', err);
    res.status(500).json({
      error: 'Failed to process chat request',
      message: err.message,
      reply: "I'm having trouble processing requests right now. Please try again later."
    });
  }
});

module.exports = router;
